// Words the dictionary lacks but can be built from words it has: regular endings, prefixes, compounds and British
// spellings (dizione's morphology.py).

import { end, re } from "./py.ts"
import { type Phone, type Phones, VOWEL_SET } from "./symbols.ts"

const SHORT_STEM = re(`(?:^|[^aeiou])[aeiou](?:[bcdfgklmnprstvz]|th)${end}`)
const SIBILANT = new Set(["s", "z", "ʃ", "ʒ", "tʃ", "dʒ"])
const VOICELESS = new Set(["p", "t", "k", "f", "θ", "ʔ"])
const SPLIT: Readonly<Record<string, string>> = { "ɑːɹ": "ɑː", "ɔːɹ": "ɔː", "oːɹ": "oː", "ɪɹ": "ɪ", "ɛɹ": "ɛ" }
const RHOTIC = new Set(["ɚ", "ɜː", "aɪɚ", "ʊɹ"])
const CONSONANT_LETTERS = new Set("bcdfghjklmnpqrstvwxz")
const P = (...phones: string[]): Phones => phones.map((phone) => [phone, 0] as const)

const ENDINGS: readonly (readonly [string, Phones])[] = [
  ["fully", P("f", "əl", "i")], ["lessly", P("l", "ə", "s", "l", "i")], ["ness", P("n", "ə", "s")],
  ["less", P("l", "ə", "s")], ["ments", P("m", "ə", "n", "t", "s")], ["ment", P("m", "ə", "n", "t")],
  ["ful", P("f", "əl")], ["ship", [["ʃ", 0], ["ɪ", 2], ["p", 0]]], ["hood", [["h", 0], ["ʊ", 2], ["d", 0]]],
  ["like", [["l", 0], ["aɪ", 2], ["k", 0]]], ["dom", P("d", "ə", "m")], ["ish", P("ɪ", "ʃ")],
  ["able", P("ə", "b", "əl")], ["ism", P("ɪ", "z", "ə", "m")], ["ist", P("ɪ", "s", "t")],
  ["wards", P("w", "ɚ", "d", "z")], ["ward", P("w", "ɚ", "d")], ["age", P("ɪ", "dʒ")],
  ["ers", P("ɚ", "z")], ["er", P("ɚ")], ["est", P("ɪ", "s", "t")], ["y", P("i")]
]
const twice = (form: Phones): readonly [Phones, Phones] => [form, form]
const PREFIXES: readonly (readonly [string, readonly [Phones, Phones]])[] = [
  ["under", twice([["ʌ", 2], ["n", 0], ["d", 0], ["ɚ", 0]])], ["over", twice([["oʊ", 2], ["v", 0], ["ɚ", 0]])],
  ["anti", twice([["æ", 2], ["n", 0], ["t", 0], ["i", 0]])], ["semi", twice([["s", 0], ["ɛ", 2], ["m", 0], ["i", 0]])],
  ["non", twice([["n", 0], ["ɑː", 2], ["n", 0]])], ["out", twice([["aʊ", 2], ["t", 0]])],
  ["dis", [P("d", "ɪ", "s"), [["d", 0], ["ɪ", 2], ["s", 0]]]], ["mis", [P("m", "ɪ", "s"), [["m", 0], ["ɪ", 2], ["s", 0]]]],
  ["un", [P("ʌ", "n"), [["ʌ", 2], ["n", 0]]]], ["in", [P("ɪ", "n"), [["ɪ", 2], ["n", 0]]]],
  ["re", [P("ɹ", "ᵻ"), [["ɹ", 0], ["iː", 2]]]], ["pre", twice([["p", 0], ["ɹ", 0], ["iː", 2]])]
]
const BRITISH: readonly (readonly [string, string])[] = [
  ["isation", "ization"], ["ising", "izing"], ["ised", "ized"], ["ises", "izes"], ["ise", "ize"], ["yse", "yze"],
  ["our", "or"], ["ourable", "orable"], ["ours", "ors"], ["oured", "ored"], ["ouring", "oring"],
  ["tre", "ter"], ["tres", "ters"], ["bre", "ber"], ["ence", "ense"], ["ogue", "og"], ["mme", "m"],
  ["lled", "led"], ["lling", "ling"], ["ller", "ler"], ["oul", "ol"], ["ae", "e"], ["enqui", "inqui"]
]

/** Stem + ending, adjusted at the seam. */
export function join(stemPhones: Phones, ending: Phones): Phones {
  const stem: Phone[] = [...stemPhones]
  if (!stem.length || !ending.length) return [...stem, ...ending]
  const [last, stress] = stem[stem.length - 1]!
  const [first, firstStress] = ending[0]!
  if (VOWEL_SET.has(first)) {
    if (Object.prototype.hasOwnProperty.call(SPLIT, last)) stem.splice(-1, 1, [SPLIT[last]!, stress], ["ɹ", 0])
    else if (RHOTIC.has(last)) stem.push(["ɹ", 0])
    else if (last === "t" && stem.length > 1 && (VOWEL_SET.has(stem[stem.length - 2]![0]) || stem[stem.length - 2]![0] === "ɹ") && !firstStress
        && !(first === "ə" && ending.length > 1 && ending[1]![0] === "n")) stem[stem.length - 1] = ["ɾ", 0]
    else if (last === "i") stem[stem.length - 1] = first !== "ɪ" ? ["ɪ", stress] : ["i", stress]
  } else if (last === "i" && (first === "n" || first === "l" || first === "f" || first === "m")) {
    stem[stem.length - 1] = ["ɪ", stress]
  } else if (last === "n" && (first === "k" || first === "ɡ")) {
    stem[stem.length - 1] = ["ŋ", 0]
  }
  return [...stem, ...ending]
}

const lastPhone = (stem: Phones) => {
  if (!stem.length) throw new RangeError("tuple index out of range")
  return stem[stem.length - 1]![0]
}

export function plural(stem: Phones): Phones {
  const last = lastPhone(stem)
  return join(stem, SIBILANT.has(last) ? P("ᵻ", "z") : VOICELESS.has(last) ? P("s") : P("z"))
}

function past(stem: Phones): Phones {
  const last = lastPhone(stem)
  if (last === "t" || last === "d" || last === "ɾ") return join(stem, P("ᵻ", "d"))
  return join(stem, VOICELESS.has(last) || last === "s" || last === "ʃ" || last === "tʃ" ? P("t") : P("d"))
}

function adverb(stem: Phones): Phones {
  const last = lastPhone(stem)
  return join(stem, last === "əl" || last === "l" ? P("i") : P("l", "i"))
}

/** Spellings the stem may have had before an ending starting with a vowel. */
function stems(body: string): string[] {
  const out = [body]
  if (body.length > 2 && body[body.length - 1] === body[body.length - 2] && CONSONANT_LETTERS.has(body[body.length - 1]!)) out.push(body.slice(0, -1))
  if (body && (CONSONANT_LETTERS.has(body[body.length - 1]!) || body[body.length - 1] === "u")) {
    const single = SHORT_STEM.search(body) !== null
    out.splice(single ? 0 : out.length, 0, body + "e")
  }
  if (body.endsWith("i") && body.length > 2) out.push(body.slice(0, -1) + "y")
  return out
}

const secondary = (phones: Phones): Phones => phones.map(([phone, stress]) => [phone, stress === 1 ? 2 : stress] as const)

/** Two words said as one: the second keeps only a lesser stress ("sandpiper"). */
export const compound = (first: Phones, second: Phones) => join(first, secondary(second))

type Lookup = (spelling: string) => Phones | null
// Python's truthiness: an empty pronunciation counts as none.
const found = (phones: Phones | null | undefined): phones is Phones => !!phones && phones.length > 0

/** Pronunciation of ``word`` from a shorter dictionary word, or null. ``part`` looks up a word that may be half of a
 * compound (by default any dictionary word). */
export function derive(word: string, lookup: Lookup, part?: Lookup | null, depth = 0): Phones | null {
  const half = part ?? lookup

  const stem = (spelling: string): Phones | null => {
    if (spelling.length < 2) return null
    const known = lookup(spelling)
    if (found(known)) return known
    return depth < 2 ? derive(spelling, lookup, half, depth + 1) : null
  }

  const first = (candidates: readonly string[], build: (phones: Phones) => Phones | null): Phones | null => {
    for (const spelling of candidates) {
      const phones = stem(spelling)
      if (found(phones)) return build(phones)
    }
    return null
  }

  if (word.endsWith("'s")) return first([word.slice(0, -2)], plural)
  if (word.endsWith("s'")) return first([word.slice(0, -1)], (phones) => phones)
  let result: Phones | null
  if (word.endsWith("ies") && word.length > 4) {
    result = first([word.slice(0, -3) + "y"], plural)
    if (found(result)) return result
  }
  if (word.endsWith("ves") && word.length > 4) {
    result = first([word.slice(0, -3) + "f", word.slice(0, -3) + "fe"],
      (f) => (f[f.length - 1]![0] === "f" ? join([...f.slice(0, -1), ["v", 0]], P("z")) : null))
    if (found(result)) return result
  }
  if (word.endsWith("es") && word.length > 3) {
    result = first("sxzh".includes(word[word.length - 3]!) ? [word.slice(0, -2)] : [], plural)
    if (found(result)) return result
  }
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is") && word.length > 3) {
    result = first([word.slice(0, -1)], plural)
    if (found(result)) return result
  }
  if (word.endsWith("ied") && word.length > 4) {
    result = first([word.slice(0, -3) + "y"], past)
    if (found(result)) return result
  }
  if (word.endsWith("ed") && word.length > 3) {
    result = first(stems(word.slice(0, -2)), past)
    if (found(result)) return result
  }
  if (word.endsWith("ing") && word.length > 4) {
    result = first(stems(word.slice(0, -3)), (f) => join(f, P("ɪ", "ŋ")))
    if (found(result)) return result
  }
  if (word.endsWith("ily") && word.length > 4) {
    result = first([word.slice(0, -3) + "y"], adverb)
    if (found(result)) return result
  }
  if (word.endsWith("ly") && word.length > 3) {
    result = first(word.endsWith("bly") || word.endsWith("ply") ? [word.slice(0, -2), word.slice(0, -2) + "le", word.slice(0, -1) + "e"]
      : [word.slice(0, -2)], adverb)
    if (found(result)) return result
  }
  for (const [spelling, phones] of ENDINGS) {
    if (word.endsWith(spelling) && word.length - spelling.length > 2) {
      const body = word.slice(0, -spelling.length)
      if (spelling === "y" && !CONSONANT_LETTERS.has(body[body.length - 1]!)) continue
      const vowelFirst = VOWEL_SET.has(phones[0]![0])
      result = first(vowelFirst ? stems(body) : body.endsWith("i") ? [body.slice(0, -1) + "y", body] : [body], (f) => join(f, phones))
      if (found(result)) return result
    }
  }
  for (const [spelling, [plain, stressed]] of PREFIXES) {
    if (word.startsWith(spelling) && word.length - spelling.length > 2) {
      const phones = stem(word.slice(spelling.length))
      if (found(phones)) {
        const vowels = phones.filter(([phone]) => VOWEL_SET.has(phone)).map(([, stress]) => stress)
        const head = vowels.length && vowels[0] === 1 ? plain : stressed
        return join(head, phones)
      }
    }
  }
  for (const [old, replacement] of BRITISH) {
    if (word.includes(old)) {
      const phones = stem(word.replace(old, replacement))
      if (found(phones)) return phones
    }
  }
  if (depth === 0) {
    let best: [number, Phones, Phones] | null = null
    for (let cut = 4; cut < word.length - 3; cut++) {
      const left = half(word.slice(0, cut))
      const right = half(word.slice(cut))
      if (found(left) && found(right)) {
        const score = Math.min(cut, word.length - cut)
        if (best === null || score > best[0]) best = [score, left, right]
      }
    }
    if (best) return compound(best[1], best[2])
  }
  return null
}
