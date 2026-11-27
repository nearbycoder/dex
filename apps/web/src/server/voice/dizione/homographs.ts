// Words spelled alike and pronounced differently: which reading is meant, from hand rules and small linear
// classifiers over the neighbouring words (dizione's homographs.py).

import { charAt, chars, compare, isalpha, isascii, isdigit, isupper } from "./py.ts"
import { rows } from "./tables.ts"

const CLASSES: readonly (readonly [string, string])[] = [
  ["TO", "to"],
  ["DET", "the a an this that these those every each no some any another such what which whose"],
  ["POSS", "my your his her its our their"],
  ["SUBJ", "i you he she it we they who"],
  ["OBJ", "me him us them"],
  ["MODAL", "will would shall should can could may might must 'll 'd won't can't cannot couldn't shouldn't wouldn't let's please"],
  ["DO", "do does did don't doesn't didn't"],
  ["BE", "am is are was were be been being isn't aren't wasn't weren't i'm you're we're they're he's she's it's that's there's"],
  ["HAVE", "have has had having haven't hasn't hadn't i've you've we've they've"],
  ["NEG", "not never"],
  ["PREP", "of in on at by for from with into onto over under about after before between through during without within "
    + "against among around across behind beside near upon toward towards as than like"],
  ["CONJ", "and or but nor so yet if because although though while when where unless until since whether"],
  ["ADV", "very too quite rather more most less least also just only even still always often sometimes usually again "
    + "now then here there soon already almost"]
]
const TAG = new Map(CLASSES.flatMap(([name, words]) => words.split(" ").map((word) => [word, name] as const)))
const SENTENCE_END = new Set([".", "?", "!"])
const WINDOW = 6

const first = (token: string) => charAt(token, 0)
const lower = (token: string) => token.toLowerCase()

/** Coarse grammatical class of a neighbouring token, from closed lists and endings. */
function tag(token: string): string {
  if (token === "<s>" || token === "</s>") return token
  if (!isalpha(first(token))) return isdigit(first(token)) ? "NUM" : "PUNCT"
  const word = lower(token)
  const known = TAG.get(word)
  if (known) return known
  const charLen = isascii(word) ? word.length : chars(word).length
  for (const [ending, name] of [["'s", "POS"], ["ly", "LY"], ["ing", "ING"], ["ed", "ED"]] as const) {
    if (word.endsWith(ending) && charLen > ending.length + 1) return name
  }
  if (word.endsWith("s") && !word.endsWith("ss") && charLen > 3) return "S"
  return isupper(first(token)) ? "CAP" : "W"
}

/** Names of the features that are on for ``tokens[index]`` (one sentence). */
function features(tokens: readonly string[], index: number): string[] {
  const at = (offset: number) => {
    const position = index + offset
    return position >= 0 && position < tokens.length ? tokens[position]! : offset < 0 ? "<s>" : "</s>"
  }
  const [p2, p1, n1, n2] = [at(-2), at(-1), at(1), at(2)]
  const [tp2, tp1, tn1, tn2] = [tag(p2), tag(p1), tag(n1), tag(n2)]
  const out = ["tp1=" + tp1, "tp2=" + tp2, "tn1=" + tn1, "tn2=" + tn2, "tp2p1=" + tp2 + "+" + tp1, "tp1n1=" + tp1 + "+" + tn1,
    "tn1n2=" + tn1 + "+" + tn2]
  if (index === 0) out.push("first")
  else if (isupper(first(tokens[index]!))) out.push("cap")
  out.push("p1=" + lower(p1), "p2=" + lower(p2), "n1=" + lower(n1), "n2=" + lower(n2))
  const target = lower(tokens[index]!)
  const nearby = new Set(tokens.slice(Math.max(0, index - WINDOW), index + WINDOW + 1).filter((t) => isalpha(first(t))).map(lower))
  nearby.delete(target)
  out.push(...[...nearby].sort(compare).map((word) => "w=" + word))
  return out
}

/** The features of the noun-or-verb model that all its words share. */
const shared = (names: readonly string[]) => names.filter((name) => name[0] === "t" || name === "first" || name === "cap")

/** The sentence around ``tokens[index]`` and the index inside it. */
function sentenceOf(tokens: readonly string[], index: number): [string[], number] {
  let start = index
  while (start > 0 && !SENTENCE_END.has(tokens[start - 1]!)) start--
  let end = index
  while (end < tokens.length && !SENTENCE_END.has(tokens[end]!)) end++
  return [tokens.slice(start, end + 1), index - start]
}

const SKIP_FOR_BEFORE = new Set(["ADV", "NEG", "LY"])
const SKIP_FOR_AUX = new Set([...SKIP_FOR_BEFORE, "SUBJ", "OBJ", "DET", "POSS"])

/** The nearest token to the left not of a skipped class, in lower case, with "'ll" and "'ve" read as "will" and "have". */
function left(tokens: readonly string[], index: number, skip: ReadonlySet<string>): string {
  for (let position = index - 1; position > Math.max(index - 6, -1); position--) {
    const token = tokens[position]!
    if (skip.has(tag(token))) continue
    const word = lower(token)
    return word.endsWith("'ll") ? "will" : word.endsWith("'ve") ? "have" : word
  }
  return "<s>"
}

type Condition = readonly [name: string, words: ReadonlySet<string>]
type Rules = Map<string, (readonly [sense: string, conditions: Condition[]])[]>

/** word -> [(sense, conditions)] from homograph_rules.txt. */
export function readRules(text: string): Rules {
  const rules: Rules = new Map()
  for (const [number, columns] of rows(text)) {
    if (columns.length !== 3) throw new Error(`homograph_rules.txt line ${number}: expected word, sense, conditions`)
    const conditions: Condition[] = []
    for (const part of columns[2]!.split(";")) {
      const trimmed = part.trim()
      const colon = trimmed.indexOf(":")
      const name = colon < 0 ? trimmed : trimmed.slice(0, colon)
      const words = colon < 0 ? "" : trimmed.slice(colon + 1)
      if (!["aux", "before", "next", "near", "first", "joined"].includes(name) || (name === "first") === Boolean(words.trim())) {
        throw new Error(`homograph_rules.txt line ${number}: bad condition ${trimmed}`)
      }
      conditions.push([name, new Set(words.split(/\s+/).filter(Boolean))])
    }
    const list = rules.get(columns[0]!) ?? []
    list.push([columns[1]!, conditions])
    rules.set(columns[0]!, list)
  }
  return rules
}

function holds(condition: string, words: ReadonlySet<string>, tokens: readonly string[], index: number, joined: boolean): boolean {
  if (condition === "first") return index === 0
  if (condition === "joined") return joined && index > 0 && words.has(lower(tokens[index - 1]!))
  if (condition === "aux") return words.has(left(tokens, index, SKIP_FOR_AUX))
  if (condition === "before") return words.has(left(tokens, index, SKIP_FOR_BEFORE))
  if (condition === "next") return words.has(index + 1 < tokens.length ? lower(tokens[index + 1]!) : "</s>")
  return tokens.slice(Math.max(0, index - WINDOW), index + WINDOW + 1).some((token) => words.has(lower(token)))
}

interface Sense {
  readonly id: string
  readonly role: string
  readonly phones: string
}

type WordModel =
  | { readonly kind: "noun-verb"; readonly bias: number; readonly weights: Readonly<Record<string, number>> }
  | { readonly kind: string; readonly bias: readonly number[]; readonly weights: readonly Readonly<Record<string, number>>[] }

interface Data {
  readonly words: Readonly<Record<string, { readonly senses: readonly Sense[]; readonly model: WordModel }>>
  readonly pooled: { readonly bias: number; readonly weights: Readonly<Record<string, number>> }
  readonly plural_bases?: readonly string[]
}

const weight = (weights: Readonly<Record<string, number>>, name: string) =>
  Object.prototype.hasOwnProperty.call(weights, name) ? weights[name]! : 0.0

/** Python's `sum`: left to right from 0. */
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

export class Homographs {
  private readonly words: Data["words"]
  private readonly pooled: Data["pooled"]
  private readonly pluralBases: ReadonlySet<string>
  private readonly rules: Rules

  constructor(data: Data, rules: Rules) {
    this.words = data.words
    this.pooled = data.pooled
    this.pluralBases = new Set(data.plural_bases ?? [])
    this.rules = rules
    for (const [word, wordRules] of rules) {
      const known = new Set(this.has(word) ? this.words[word]!.senses.map((sense) => sense.id) : [])
      for (const [sense] of wordRules) {
        if (!known.has(sense)) throw new Error(`homograph rule for '${word}' names the unknown sense '${sense}'`)
      }
    }
  }

  private has(word: string) {
    return Object.prototype.hasOwnProperty.call(this.words, word)
  }

  /** True for a homograph and for the regular -s form of a noun-or-verb one. */
  covers(word: string): boolean {
    return this.has(word) || (word.endsWith("s") && this.pluralBases.has(word.slice(0, -1)))
  }

  /** The phones (as text) for ``tokens[index]`` and whether the -s ending must be added. */
  pronounce(word: string, tokens: readonly string[], index: number, joined = false): [string, boolean] {
    if (this.has(word)) return [this.choose(word, tokens, index, joined).phones, false]
    const entry = this.words[word.slice(0, -1)]!
    const adjective = entry.senses.find((sense) => sense.role === "n")
    if (adjective && adjective.id === "adj") return [entry.senses.find((sense) => sense.role === "v")!.phones, true]
    return [this.choose(word.slice(0, -1), tokens, index, joined).phones, true]
  }

  private scores(word: string, sentence: readonly string[], position: number): number[] {
    const entry = this.words[word]!
    const names = features(sentence, position)
    const model = entry.model
    if (model.kind === "noun-verb") {
      const { bias, weights } = model as { bias: number; weights: Readonly<Record<string, number>> }
      let verb = this.pooled.bias + sum(shared(names).map((name) => weight(this.pooled.weights, name)))
      verb += bias + sum(names.map((name) => weight(weights, name)))
      return entry.senses.map((sense) => (sense.role === "v" ? verb : -verb))
    }
    const { bias, weights } = model as { bias: readonly number[]; weights: readonly Readonly<Record<string, number>>[] }
    return bias.slice(0, weights.length).map((b, k) => b + sum(names.map((name) => weight(weights[k]!, name))))
  }

  /** The sense meant by ``tokens[index]``: hand rules first, then the classifier. */
  private choose(word: string, tokens: readonly string[], index: number, joined: boolean): Sense {
    const entry = this.words[word]!
    const [sentence, position] = sentenceOf(tokens, index)
    for (const [sense, conditions] of this.rules.get(word) ?? []) {
      if (conditions.every(([name, words]) => holds(name, words, sentence, position, joined))) {
        return entry.senses.find((s) => s.id === sense)!
      }
    }
    const scores = this.scores(word, sentence, position)
    let best = 0
    for (let k = 1; k < scores.length; k++) if (scores[k]! > scores[best]!) best = k
    return entry.senses[best]!
  }
}
