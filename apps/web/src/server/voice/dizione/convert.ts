// One word: CMUdict pronunciation -> phones of the inventory, by rule (dizione's convert.py).

import { base } from "./align.ts"
import { ValueError } from "./py.ts"
import { PHONE_SET, type Phones, VOWEL_SET } from "./symbols.ts"

const ARPA_VOWELS = new Set("AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW".split(" "))
const CONSONANTS: Readonly<Record<string, string>> = {
  B: "b", CH: "tʃ", D: "d", DH: "ð", F: "f", G: "ɡ", HH: "h", JH: "dʒ", K: "k", L: "l",
  M: "m", N: "n", NG: "ŋ", P: "p", R: "ɹ", S: "s", SH: "ʃ", T: "t", TH: "θ", V: "v",
  W: "w", Y: "j", Z: "z", ZH: "ʒ"
}
const FULL_VOWELS: Readonly<Record<string, string>> = {
  AA: "ɑː", AE: "æ", AH: "ʌ", AO: "ɔː", AW: "aʊ", AY: "aɪ", EH: "ɛ", ER: "ɜː", EY: "eɪ",
  IH: "ɪ", IY: "iː", OW: "oʊ", OY: "ɔɪ", UH: "ʊ", UW: "uː"
}
const ARPABET = new Set([...Object.keys(CONSONANTS), ...[...ARPA_VOWELS].flatMap((v) => [v + "0", v + "1", v + "2"])])
const SIBILANTS = new Set(["S", "Z", "SH", "ZH", "CH", "JH"])
const VOWEL_LETTERS = new Set("aeiouy")
const FORCE_SPELLINGS = ["forc", "ford", "sword", "worn", "torn", "sworn", "borne", "shorn", "pork", "divorc"]
const PREFIXES = new Set(["dis", "mis", "un", "in", "re", "non", "over", "pre"])
const WEAK_PREFIXES = ["be", "de", "re", "pre"]
const IRE_ENDINGS = new Set(["ing", "ings", "ingly", "able", "y", "er", "ers", "est"])

const has = (map: object, key: string) => Object.prototype.hasOwnProperty.call(map, key)

export const isArpabet = (symbols: readonly string[]) => symbols.length > 0 && symbols.every((symbol) => ARPABET.has(symbol))

const vowelLetters = (run: string) => [...run].filter((c) => VOWEL_LETTERS.has(c)).join("")

const FROM_TEXT_WS = /[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/u

/** Fast path for pre-validated single-space lexicon entries (e.g. `"h ə l ˈoʊ"`). */
export function fromLexiconText(text: string): Phones {
  const phones: [string, number][] = []
  let start = 0
  const n = text.length
  while (start < n) {
    let end = text.indexOf(" ", start)
    if (end < 0) end = n
    if (end > start) {
      const ch = text[start]!
      const stress = ch === "ˈ" ? 1 : ch === "ˌ" ? 2 : 0
      phones.push([stress ? text.slice(start + 1, end) : text.slice(start, end), stress])
    }
    start = end + 1
  }
  return phones
}

/** `"h ə l ˈoʊ"` -> phones; raises on a symbol outside the inventory. */
export function fromText(text: string): Phones {
  const phones: [string, number][] = []
  for (const unit of text.split(FROM_TEXT_WS)) {
    if (!unit) continue
    const stress = unit[0] === "ˈ" ? 1 : unit[0] === "ˌ" ? 2 : 0
    const phone = stress ? unit.slice(1) : unit
    if (!PHONE_SET.has(phone)) throw new ValueError(`'${phone}' is not a phone of the inventory`)
    if (stress && !VOWEL_SET.has(phone)) throw new ValueError(`stress mark on the consonant '${phone}'`)
    phones.push([phone, stress])
  }
  return phones
}

/** The aligned pronunciation of one word and the questions the rules ask of it. */
class Word {
  readonly word: string
  readonly bases: string[]
  readonly stress: (number | null)[]
  readonly aligned: boolean
  readonly runs: string[]
  readonly starts: number[] = []
  readonly count: number

  constructor(word: string, arpabet: readonly string[], runs: readonly string[] | null) {
    this.word = word
    this.bases = arpabet.map(base)
    this.stress = arpabet.map((symbol) => ("012".includes(symbol[symbol.length - 1] ?? "") && symbol ? Number(symbol[symbol.length - 1]) : null))
    arpabet.forEach((symbol, index) => {
      const name = this.bases[index]!
      if (!has(CONSONANTS, name) && !ARPA_VOWELS.has(name)) throw new ValueError(`'${symbol}' is not an ARPABET symbol`)
    })
    this.aligned = runs !== null
    this.runs = runs !== null ? [...runs] : arpabet.map(() => "")
    let position = 0
    for (const run of this.runs) {
      this.starts.push(position)
      position += run.length
    }
    this.count = this.bases.length
  }

  base(i: number) {
    return i >= 0 && i < this.count ? this.bases[i]! : null
  }

  vowel(i: number) {
    return i >= 0 && i < this.count && ARPA_VOWELS.has(this.bases[i]!)
  }

  unstressed(i: number) {
    return this.vowel(i) && !this.stress[i]
  }

  letters(i: number) {
    return vowelLetters(this.runs[i]!)
  }

  before(i: number) {
    return this.aligned ? this.word.slice(0, this.starts[i]!) : ""
  }

  after(i: number) {
    return this.aligned ? this.word.slice(this.starts[i]! + this.runs[i]!.length) : ""
  }

  endsWith(i: number, ...symbols: string[]) {
    const rest = this.bases.slice(i + 1)
    return rest.length === symbols.length && rest.every((symbol, k) => symbol === symbols[k])
  }

  firstVowel(i: number) {
    return !this.bases.slice(0, Math.max(i, 0)).some((b) => ARPA_VOWELS.has(b))
  }

  nextVowelStress(i: number) {
    for (let j = i + 1; j < this.count; j++) if (ARPA_VOWELS.has(this.bases[j]!)) return this.stress[j]!
    return null
  }

  weakPrefix(i: number) {
    return this.aligned && this.firstVowel(i) && this.letters(i) === "e" && WEAK_PREFIXES.some((p) => this.word.startsWith(p))
      && ["b", "d", "r", "pr"].includes(this.before(i))
  }
}

function northOrForce(w: Word, i: number, beforeVowel: boolean): string {
  if (!w.aligned) return "ɔː"
  const spelled = w.letters(i)
  if (spelled === "oa" || spelled === "oo" || spelled === "ou") return "oː"
  if (spelled !== "o") return "ɔː"
  const run = w.runs[i]!
  const tail = run.slice(run.indexOf("o") + 1) + w.after(i)
  const rest = tail.slice(1)
  if (!beforeVowel) {
    if (rest.startsWith("e")) return "oː"
    if (w.before(i).endsWith("p") && rest.startsWith("t")) return "oː"
    return FORCE_SPELLINGS.some((s) => w.word.includes(s)) ? "oː" : "ɔː"
  }
  if (rest.startsWith("r")) return "ɔː"
  if (["y", "ies", "ied", "a", "as", "ah", "er", "ers"].includes(rest) || ["ia", "io", "iu", "ing", "age"].some((p) => rest.startsWith(p))) return "oː"
  return "ɔː"
}

function weakI(w: Word, i: number): string {
  const nxt = w.base(i + 1)
  const nxt2 = w.base(i + 2)
  if (nxt === "F" && nxt2 === "AH" && w.base(i + 3) === "L") return "i"
  if ((nxt === "T" && nxt2 === "IY") || (nxt === "B" && (nxt2 === "AH" || nxt2 === "L")) || (nxt === "F" && nxt2 === "AY")) return "ᵻ"
  if (nxt === "T" && w.endsWith(i, "T") && (w.base(i - 1) === "R" || w.base(i - 1) === "ER") && w.word.endsWith("ite")) return "ᵻ"
  return "ɪ"
}

function weakE(w: Word, i: number): string {
  const nxt = w.base(i + 1)
  const prev = w.base(i - 1)
  if (nxt === "T" && (w.endsWith(i, "T") || w.endsWith(i, "T", "S"))) return prev === "L" ? "ə" : prev === "R" ? "ᵻ" : "ɪ"
  if (nxt === "S" && (w.endsWith(i, "S", "T") || w.endsWith(i, "S", "T", "L", "IY"))) return "ɪ"
  if (nxt === "JH") return "ɪ"
  if (nxt === "K" && w.base(i + 2) === "T") return "ɛ"
  if (nxt === "D" && w.endsWith(i, "D")) return "ɪ"
  return "ə"
}

function inflection(w: Word, i: number): boolean {
  if (i + 1 >= w.count || (w.aligned && !(w.runs[i]! + w.runs[i + 1]!).includes("e"))) return false
  const nxt = w.base(i + 1)
  const prev = w.base(i - 1)
  if (nxt === "D" && (prev === "T" || prev === "D") && (w.endsWith(i, "D") || w.endsWith(i, "D", "L", "IY"))) return true
  return nxt === "Z" && prev !== null && SIBILANTS.has(prev) && w.endsWith(i, "Z")
}

function firstSyllable(w: Word, i: number): string | null {
  if (!w.aligned || !w.firstVowel(i) || !w.nextVowelStress(i)) return null
  const word = w.word
  if (i === 0 && word.startsWith("e")) {
    if (word.startsWith("ex")) return "ɛ"
    const second = word.slice(1, 2)
    const third = word.slice(2, 3)
    if ((second === "n" || second === "m" || second === "s") && third && !VOWEL_LETTERS.has(word[2]!) && word[2] !== word[1]) return "ɛ"
    return "ɪ"
  }
  if (w.weakPrefix(i)) {
    const third = word.slice(2, 3)
    if (word.startsWith("pre") || (word.startsWith("be") && (third === "c" || third === "g"))) return "ɪ"
    return "ᵻ"
  }
  if (w.letters(i) === "i" && word.startsWith("di") && word.length > 3 && !VOWEL_LETTERS.has(word[2]!)
      && word[2] !== "s" && VOWEL_LETTERS.has(word[3]!)) return "ᵻ"
  return null
}

function reduced(w: Word, i: number): string {
  const name = w.bases[i]!
  const spelled = w.letters(i)
  const nxt = w.base(i + 1)
  const prev = w.base(i - 1)
  if (name === "IH" && nxt === "NG") return "ɪ"
  if (inflection(w, i)) return "ᵻ"
  if (name === "AH") {
    if (prev === "Y" && (w.runs[i - 1]! + w.runs[i]!).includes("u")) return "ʊ"
    if (i === 0 && w.word.startsWith("a")) return "ɐ"
    if (i === 0 && nxt === "N" && w.word.startsWith("un")) return "ʌ"
    if (spelled === "a" && PREFIXES.has(w.before(i)) && w.runs[i]!.startsWith("a")) return "ɐ"
  }
  const prefix = firstSyllable(w, i)
  if (prefix) return prefix
  if (spelled === "e" && (nxt === "K" || nxt === "G") && w.runs[i + 1]!.startsWith("x") && w.nextVowelStress(i)) return "ɛ"
  if (spelled === "i" || spelled === "ai" || spelled === "ui" || spelled === "y") return weakI(w, i)
  if (spelled === "e") return weakE(w, i)
  if (spelled === "a") {
    if (nxt === "JH" || (nxt === "N" && w.base(i + 2) === "JH")) return "ɪ"
    if (nxt === "S" && w.endsWith(i, "S") && w.word.endsWith("ace")) return "ɪ"
    if (name === "IH" && !(nxt === "T" && w.endsWith(i, "T"))) return "ɪ"
    return "ə"
  }
  if (name === "AH" && nxt === "M" && w.endsWith(i, "M") && w.word.endsWith("ome")) return "ʌ"
  return name === "IH" && spelled !== "o" && spelled !== "u" && spelled !== "ou" ? "ɪ" : "ə"
}

function unstressedIy(w: Word, i: number): [string, number] {
  const nxt = w.base(i + 1)
  if (nxt === null || w.endsWith(i, "Z") || w.endsWith(i, "D")) return ["i", 0]
  if (w.vowel(i + 1)) return [nxt === "IH" && w.base(i + 2) === "NG" ? "i" : "ɪ", 0]
  if (w.weakPrefix(i)) return w.nextVowelStress(i) === 1 ? ["ᵻ", 0] : ["iː", 2]
  return ["ɪ", 0]
}

/** Citation form of ``word`` from its CMUdict pronunciation and the letters aligned to each symbol (or null). */
export function convert(word: string, arpabet: readonly string[], runs: readonly string[] | null = null): Phones {
  const w = new Word(word, arpabet, runs)
  const out: [string, number][] = []
  const emit = (phone: string, stress: number | null = 0) => out.push([phone, stress || 0])
  let i = 0
  while (i < w.count) {
    const name = w.bases[i]!
    const stress = w.stress[i] || 0
    const nxt = w.base(i + 1)
    if (!ARPA_VOWELS.has(name)) {
      if (name === "Y" && nxt === "AH" && w.unstressed(i + 1) && (w.base(i - 1) === "N" || w.base(i - 1) === "L") && w.base(i + 2) !== "L"
          && (!w.aligned || (w.runs[i]! + w.runs[i + 1]!).includes("i"))) {
        emit("iə")
        i += 2
        continue
      }
      emit(CONSONANTS[name]!)
      i += 1
      continue
    }
    const beforeVowel = w.vowel(i + 2)
    if (name === "ER") {
      emit(stress ? "ɜː" : "ɚ", stress)
      if (nxt === "R") i += 1
      if (w.vowel(i + 1)) emit("ɹ")
    } else if (nxt === "R" && name === "AW") {
      emit("aʊ", stress)
      emit("ɚ")
      if (beforeVowel) emit("ɹ")
      i += 1
    } else if (nxt === "R" && ["AA", "AO", "IH", "IY", "EH", "UH", "UW", "AY"].includes(name)) {
      let quality: string
      let single: string
      if (name === "AA") {
        quality = "ɑː"
        single = "ɑːɹ"
      } else if (name === "AO") {
        quality = northOrForce(w, i, beforeVowel)
        single = quality + "ɹ"
      } else if (name === "IH" || name === "IY") {
        quality = stress && (w.letters(i) === "e" || w.letters(i) === "eo") ? "iə" : "ɪ"
        single = "ɪɹ"
      } else if (name === "EH") {
        const doubled = (w.runs[i + 1]! + w.after(i + 1)).startsWith("rr") || (w.runs[i]!.endsWith("r") && w.runs[i + 1]!.startsWith("r"))
        quality = w.letters(i) === "a" && doubled ? "æ" : "ɛ"
        single = "ɛɹ"
      } else if (name === "UH" || name === "UW") {
        quality = single = "ʊɹ"
      } else {
        quality = !w.aligned || IRE_ENDINGS.has(w.after(i + 1)) ? "aɪɚ" : "aɪ"
        single = "aɪɚ"
      }
      if (beforeVowel) {
        emit(quality, stress)
        emit("ɹ")
      } else {
        emit(single, stress)
      }
      i += 1
    } else if (name === "AY" && nxt === "ER" && w.unstressed(i + 1) && w.runs[i + 1] === "er" && w.runs[i] !== "i") {
      emit("aɪ", stress)
    } else if (name === "AY" && nxt === "ER" && w.unstressed(i + 1)) {
      emit("aɪɚ", stress)
      i += 1
      if (w.vowel(i + 1)) emit("ɹ")
    } else if (name === "AY" && nxt === "AH" && w.unstressed(i + 1)) {
      emit("aɪə", stress)
      i += 1
    } else if (name === "IY" && nxt === "AH" && w.unstressed(i + 1) && !w.weakPrefix(i)) {
      const after = w.base(i + 2)
      if (stress !== 1 && (after === "L" || after === "D" || after === "T" || (after === "N" && w.base(i + 3) === "S"))) {
        emit("ɪ")
      } else {
        emit("iə", stress)
        i += 1
      }
    } else if (!stress && name === "AH" && nxt === "N" && w.base(i - 1) === "T" && w.base(i + 2) !== "T"
        && out.length >= 2 && out[out.length - 1]![0] === "t" && VOWEL_SET.has(out[out.length - 2]![0]) && out[out.length - 2]![1]) {
      out[out.length - 1]![0] = "ʔ"
      emit("n̩")
      i += 1
    } else if (!stress && name === "AH" && nxt === "W" && w.base(i + 2) === "AH" && w.unstressed(i + 2)
        && (w.runs[i]! + w.runs[i + 1]!).includes("u")) {
      emit("uː")
      i += 1
    } else if (!stress && name === "AH" && nxt === "L" && i > 0 && !(w.vowel(i + 2) && w.stress[i + 2])) {
      if (w.letters(i) === "i" && w.vowel(i + 2)) {
        emit("ɪ")
      } else if (w.base(i - 1) === "Y" && (w.runs[i - 1]! + w.runs[i]!).includes("u")) {
        emit("ʊ")
      } else {
        emit("əl")
        i += 1
      }
    } else if (!stress && (name === "AH" || name === "IH")) {
      emit(reduced(w, i))
    } else if (name === "IY" && (!stress || (stress === 2 && nxt === null))) {
      emit(...unstressedIy(w, i))
    } else if (!stress && name === "AE" && i === 0 && (w.word.startsWith("ad") || w.word.startsWith("acc")) && (nxt === "D" || nxt === "K")) {
      emit("ɐ")
    } else if (!stress && name === "ER") {
      emit("ɚ")
    } else if ((name === "AA" || name === "AO") && w.letters(i) === "a" && (w.before(i).endsWith("w") || w.before(i).endsWith("qu")) && nxt === "N") {
      emit("ɔ", stress)
    } else if (name === "AO" && w.letters(i) === "o") {
      emit("ɔ", stress)
    } else {
      emit(FULL_VOWELS[name]!, stress)
    }
    i += 1
  }
  flap(out)
  for (let k = 0; k < out.length - 1; k++) {
    if (out[k]![0] === "n" && (out[k + 1]![0] === "k" || out[k + 1]![0] === "ɡ")) out[k]![0] = "ŋ"
  }
  settle(out)
  return out.map(([phone, stress]) => [phone, stress] as const)
}

/** t between a vowel (or r) and an unstressed vowel: water, city, party. */
function flap(out: [string, number][]) {
  for (let k = 1; k < out.length - 1; k++) {
    if (out[k]![0] !== "t") continue
    const before = out[k - 1]![0]
    const [after, stress] = out[k + 1]!
    if ((!VOWEL_SET.has(before) && before !== "ɹ") || before === "n̩" || before === "əl" || !VOWEL_SET.has(after) || after === "n̩") continue
    const finalO = after === "oʊ" && (k + 2 === out.length || (k + 3 === out.length && out[k + 2]![0] === "z"))
    if (stress && !finalO) continue
    if ((after === "ə" || after === "ɚ") && k + 2 < out.length && out[k + 2]![0] === "n") continue
    out[k]![0] = "ɾ"
  }
}

/** One primary stress per word, and no secondary stress next to it, on a finished pronunciation. */
export function settleStress(phones: Phones): Phones {
  const out = phones.map(([phone, stress]): [string, number] => [phone, stress])
  settle(out)
  return out.map(([phone, stress]) => [phone, stress] as const)
}

function settle(out: [string, number][]) {
  const vowels = out.flatMap(([phone], k) => (VOWEL_SET.has(phone) ? [k] : []))
  const primaries = vowels.filter((k) => out[k]![1] === 1)
  for (const k of primaries.slice(0, -1)) out[k]![1] = 2
  vowels.forEach((k, position) => {
    if (out[k]![1] !== 2) return
    const neighbours = [position - 1, position + 1].filter((p) => p >= 0 && p < vowels.length).map((p) => vowels[p]!)
    if (neighbours.some((n) => out[n]![1] === 1)) out[k]![1] = 0
  })
}
