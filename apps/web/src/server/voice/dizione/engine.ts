// The phonemizer: text -> spoken words of phones, clause by clause (dizione's engine.py). For one word: a
// pronunciation written inline, the built-in exceptions (and names of several words), function words and phrases,
// the dictionary, regular endings and compounds of dictionary words, "-leigh" and "-virus" words, then the model.

import { Aligner } from "./align.ts"
import { convert, fromLexiconText, fromText, settleStress } from "./convert.ts"
import { TABLES } from "./data.ts"
import { Model } from "./g2p.ts"
import { Homographs } from "./homographs.ts"
import { compound, derive, plural } from "./morphology.ts"
import { Normalizer, type Token, type Word } from "./normalize.ts"
import { end, re } from "./py.ts"
import { groups, joinClause, promote, stressClause, type Unit, unit } from "./sentence.ts"
import type { Phones, Piece } from "./symbols.ts"
import { type Entry, entryPhones, functionWords, mapping, names, phrases, pronunciations } from "./tables.ts"



const LEIGH = re(`(?<=[a-z]{2})leigh(?=s?${end})`)
const VIRUS = ["viruses", "virus"]
// Bound the per-word cache so a long-lived Worker isolate cannot grow without limit.
const WORD_CACHE_LIMIT = 10_000

/** The built files, already read. */
export interface Built {
  readonly lexicon: string
  readonly align: Readonly<Record<string, Readonly<Record<string, number>>>>
  readonly model: Model | null
  readonly homographs: Homographs | null
}

export class Phonemizer {
  private readonly lexicon = new Map<string, string>()
  private readonly aligner: Aligner
  private readonly model: Model | null
  private readonly homographs: Homographs | null
  private readonly functions = functionWords(TABLES["function_words.txt"])
  private readonly phrases = phrases(TABLES["phrases.txt"])
  private readonly phraseStarts: Set<string>
  private readonly phraseLength: number
  private readonly exceptions = pronunciations(TABLES["exceptions.txt"])
  private readonly names = names(TABLES["exceptions.txt"])
  private readonly nameStarts: Set<string>
  private readonly nameLength: number
  private readonly letterNames = new Map(Array.from(mapping(TABLES["letters.txt"]), ([key, value]) => [key, fromText(value)]))
  private readonly normalizer: Normalizer
  private readonly cache = new Map<string, readonly [Phones, string]>()

  constructor(built: Built) {
    // Scan lines directly rather than allocating a 100k+ element array via splitlines().
    const lexicon = built.lexicon
    let start = 0
    while (start < lexicon.length) {
      let nl = lexicon.indexOf("\n", start)
      if (nl < 0) nl = lexicon.length
      const lineEnd = nl > start && lexicon.charCodeAt(nl - 1) === 13 ? nl - 1 : nl
      if (lineEnd > start) {
        const tab = lexicon.indexOf("\t", start)
        if (tab < 0 || tab >= lineEnd) throw new Error("lexicon.tsv: a line without a tab")
        this.lexicon.set(lexicon.slice(start, tab), lexicon.slice(tab + 1, lineEnd))
      }
      start = nl + 1
    }
    this.aligner = new Aligner(built.align)
    this.model = built.model
    this.homographs = built.homographs
    this.phraseStarts = new Set(Array.from(this.phrases.keys(), (key) => key.split(" ")[0]!))
    this.phraseLength = Math.max(1, ...Array.from(this.phrases.keys(), (key) => key.split(" ").length))
    this.nameStarts = new Set(Array.from(this.names.keys(), (key) => key.split(" ")[0]!))
    this.nameLength = Math.max(1, ...Array.from(this.names.keys(), (key) => key.split(" ").length))
    this.normalizer = new Normalizer({ abbreviations: TABLES["abbreviations.txt"], units: TABLES["units.txt"], chat: TABLES["chat.txt"],
      endings: TABLES["endings.txt"] }, (word) => this.isWord(word))
  }

  // ---- single words ----

  private entry(word: string, entry: Entry): Phones {
    return entryPhones(word, entry, (spelling, symbols) => this.aligner.align(spelling, symbols))
  }

  /** Pronunciation from the exceptions or the dictionary. */
  private known(word: string): Phones | null {
    const exception = this.exceptions.get(word)
    if (exception) return this.entry(word, exception)
    const text = this.lexicon.get(word)
    return text !== undefined ? fromLexiconText(text) : null
  }

  /** A dictionary word that may be half of a compound: one also listed with a regular ending. */
  private ordinary(word: string): Phones | null {
    if (word.length < 3 || !["s", "es", "ed", "ing"].some((ending) => this.lexicon.has(word + ending))) return null
    return this.known(word)
  }

  /** The unknown-word model, then the conversion rules, on one spelling. */
  private guess(word: string): Phones {
    if (this.model === null) return this.spell(word)
    const spelling = this.model.spellable(word)
    const symbols = this.model.predict(spelling, true)
    // An r with no vowel beside it is a syllable: write it as one ("okafor").
    const stressed = (symbol: string | undefined) => symbol !== undefined && "012".includes(symbol[symbol.length - 1]!) && symbol !== ""
    symbols.forEach((symbol, k) => {
      if (symbol === "R" && ![k - 1, k + 1].some((j) => j >= 0 && j < symbols.length && stressed(symbols[j]))) symbols[k] = "ER0"
    })
    if (!symbols.some(stressed)) return this.spell(word)
    return promote(convert(spelling, symbols, this.aligner.align(spelling, symbols)))
  }

  /** Letter names, joined: the last letter carries the main stress. */
  private spell(letters: string): Phones {
    const possessive = letters.toLowerCase().endsWith("'s")
    const named = [...(possessive ? letters.slice(0, -2) : letters).toLowerCase()].flatMap((c) => {
      const name = this.letterNames.get(c)
      return name ? [name] : []
    })
    const out = named.flatMap((name, index) => name.map(([phone, stress]) => [phone, stress && index < named.length - 1 ? 2 : stress] as const))
    return possessive && out.length ? plural(out) : out
  }

  /** True for a spelling the tables or the dictionary know. */
  isWord(word: string): boolean {
    return this.lexicon.has(word) || this.functions.has(word) || this.exceptions.has(word)
  }

  /** Names in "-leigh" said like "-ley", words in "-virus" put together from their parts. */
  private fromParts(word: string): readonly [Phones, string] | null {
    if (word.endsWith("'s") && word.length > 3) {
      const found = this.fromParts(word.slice(0, -2))
      return found && [plural(found[0]), found[1]]
    }
    if (LEIGH.search(word)) return this.word(LEIGH.sub(word, "ley"))
    for (const tail of VIRUS) {
      const second = word.endsWith(tail) && word.length - tail.length > 2 ? this.known(tail) : null
      if (second !== null) {
        const [first, source] = this.word(word.slice(0, -tail.length))
        return [promote(settleStress(compound(first, second))), source === "model" ? "model" : "ending"]
      }
    }
    return null
  }

  /** The pronunciation of one spelling in lower case and where it came from. */
  private word(word: string): readonly [Phones, string] {
    const cached = this.cache.get(word)
    if (cached) {
      // Refresh recency for LRU eviction.
      this.cache.delete(word)
      this.cache.set(word, cached)
      return cached
    }
    let phones = this.known(word)
    let source = "dictionary"
    if (phones === null) {
      phones = derive(word, (w) => this.known(w), (w) => this.ordinary(w))
      source = "ending"
      if (phones !== null) phones = settleStress(phones)
    }
    if (phones === null) {
      const found = this.fromParts(word)
      if (found) [phones, source] = found
    }
    if (phones === null && word.endsWith("'s") && word.length > 3) {
      phones = plural(this.guess(word.slice(0, -2)))
      source = "model"
    }
    if (phones === null) {
      phones = this.guess(word)
      source = "model"
    }
    const result = [phones, source] as const
    if (this.cache.size >= WORD_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    this.cache.set(word, result)
    return result
  }

  // ---- sentences ----

  private units(words: readonly Word[], places: readonly number[], written: readonly string[]): Unit[] {
    const units: Unit[] = []
    let index = 0
    while (index < words.length) {
      const token = words[index]!
      if (token.phones !== null) {
        units.push(unit(token.text, token.phones, "p", null, token.attach, "inline"))
      } else if (token.spell) {
        units.push(unit(token.text, this.spell(token.text), "p", null, token.attach, "letters"))
      } else {
        let size = this.nameStarts.has(token.text) ? this.name(words, index) : 0
        if (size) {
          const key = words.slice(index, index + size).map((w) => w.text)
          const entries = this.names.get(key.join(" "))!
          key.forEach((text, position) => units.push(unit(text, this.entry(text, entries[position]!), "p", null, token.attach && position === 0, "name")))
          index += size
          continue
        }
        size = this.phraseStarts.has(token.text) ? this.phrase(words, index) : 0
        if (size) {
          const key = words.slice(index, index + size).map((w) => w.text)
          const [kind, forms, final] = this.phrases.get(key.join(" "))!
          if (forms.length === 1) units.push(unit(key.join(" "), forms[0]!, kind, final, token.attach, "phrase"))
          else key.forEach((text, position) => units.push(unit(text, forms[position]!, kind, null, token.attach && position === 0, "phrase")))
          index += size
          continue
        }
        if (this.homographs && written.length && this.homographs.covers(token.text) && !this.exceptions.has(token.text)) {
          const [text, ending] = this.homographs.pronounce(token.text, written, places[index]!, token.attach)
          units.push(unit(token.text, ending ? plural(fromText(text)) : fromText(text), "c", null, token.attach, "homograph"))
        } else if (this.functions.has(token.text)) {
          const [kind, form, final] = this.functions.get(token.text)!
          units.push(unit(token.text, form, kind, final, token.attach, "function"))
        } else {
          const [phones, source] = this.word(token.text)
          units.push(unit(token.text, phones, "c", null, token.attach, source))
        }
      }
      index += 1
    }
    return units
  }

  private name(words: readonly Word[], index: number): number {
    if (words[index]!.phones !== null || words[index]!.spell) return 0
    for (let size = Math.min(this.nameLength, words.length - index); size > 1; size--) {
      let ok = true
      let key = words[index]!.text
      for (let k = 1; k < size; k++) {
        const w = words[index + k]!
        if (w.phones !== null || w.spell || w.attach) {
          ok = false
          break
        }
        key += " " + w.text
      }
      if (ok && this.names.has(key)) return size
    }
    return 0
  }

  private phrase(words: readonly Word[], index: number): number {
    if (words[index]!.phones !== null || words[index]!.spell) return 0
    for (let size = Math.min(this.phraseLength, words.length - index); size > 1; size--) {
      let ok = true
      let key = words[index]!.text
      for (let k = 1; k < size; k++) {
        const w = words[index + k]!
        if (w.phones !== null || w.spell || w.attach) {
          ok = false
          break
        }
        key += " " + w.text
      }
      if (ok && this.phrases.has(key)) return size
    }
    return 0
  }

  /** `(true, mark)` for punctuation, `(false, words)` for a run of words. */
  pieces(text: string): Piece[] {
    const stream: Token[] = this.normalizer.tokens(text)
    // The text as the homograph rules see it; a word given only as phones stands as "x".
    const written = stream.map((token) => (token.kind === "punct" ? token.mark : token.raw || token.text || "x"))
    const out: Piece[] = []
    const words: Word[] = []
    const places: number[] = []
    const flush = () => {
      if (!words.length) return
      const units = this.units(words, places, written)
      stressClause(units)
      joinClause(units)
      out.push([false, groups(units)])
      words.length = 0
      places.length = 0
    }
    stream.forEach((token, place) => {
      if (token.kind === "punct") {
        flush()
        out.push([true, token.mark])
      } else {
        words.push(token)
        places.push(place)
      }
    })
    flush()
    return out
  }
}
