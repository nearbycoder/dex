// Sentence rules: what a word's pronunciation owes to its neighbours in a clause (dizione's sentence.py).

import { type Phones, VOWEL_SET } from "./symbols.ts"

const SPLIT: Readonly<Record<string, string>> = { "ɑːɹ": "ɑː", "ɔːɹ": "ɔː", "oːɹ": "oː", "ɪɹ": "ɪ", "ɛɹ": "ɛ", "ʊɹ": "ʊ" }
const RHOTIC = new Set(["ɚ", "ɜː", "aɪɚ"])
const NO_LINK_BEFORE = new Set(["and", "or", "if"])
const FLAP_BEFORE_VOWEL = new Set(["it", "at"])

/** One word (or joined group of words) of a clause and where its pronunciation came from. */
export interface Unit {
  word: string
  phones: Phones
  kind: string
  final: Phones | null
  attach: boolean
  source: string
}

export const unit = (word: string, phones: Phones, kind = "c", final: Phones | null = null, attach = false, source = ""): Unit =>
  ({ word, phones, kind, final, attach, source })

const lastWord = (unit: Unit) => unit.word.slice(unit.word.lastIndexOf(" ") + 1)
const firstWord = (unit: Unit) => unit.word.split(" ", 1)[0]!

const unstress = (phones: Phones): Phones => phones.map(([phone]) => [phone, 0] as const)

/** Give the word a primary stress: on its marked vowel, else on the first vowel. */
export function promote(phones: Phones): Phones {
  const marks = phones.map(([, stress]) => stress)
  if (marks.includes(1)) return phones
  const target = marks.includes(2) ? marks.lastIndexOf(2) : phones.findIndex(([phone]) => VOWEL_SET.has(phone))
  return phones.map(([phone, stress], i) => [phone, i === target ? 1 : stress] as const)
}

/** Resolve the stress class of every unit of a clause, right to left. */
export function stressClause(units: Unit[]) {
  let primaryFollows = false
  for (let index = units.length - 1; index >= 0; index--) {
    const unit = units[index]!
    const promoted = () => (unit.final !== null ? unit.final : promote(unit.phones))
    const last = index === units.length - 1
    let phones: Phones
    if (unit.kind === "u") phones = unstress(unit.phones)
    else if (unit.kind === "uf") phones = last ? promoted() : unstress(unit.phones)
    else if (unit.kind === "ur") phones = primaryFollows ? unstress(unit.phones) : promoted()
    else if (unit.kind === "s") phones = primaryFollows ? unit.phones : promoted()
    else if (unit.kind === "si") phones = !primaryFollows ? promoted() : index === 0 ? unit.phones : unstress(unit.phones)
    else if (unit.kind === "pf") phones = last ? promoted() : unit.phones
    else phones = unit.phones
    unit.phones = phones
    primaryFollows = primaryFollows || unit.phones.some(([, stress]) => stress === 1)
  }
  if (units.length && !units.some((unit) => unit.phones.some(([, stress]) => stress))) {
    for (const unit of [...units].reverse()) {
      if (unit.phones.some(([phone]) => VOWEL_SET.has(phone))) {
        unit.phones = promote(unit.phones)
        break
      }
    }
  }
}

/** Adjust the end of each word to the beginning of the next. */
export function joinClause(units: Unit[]) {
  for (let k = 0; k + 1 < units.length; k++) {
    const unit = units[k]!
    const following = units[k + 1]!
    if (!unit.phones.length || !following.phones.length || !VOWEL_SET.has(following.phones[0]![0])) continue
    const [last, stress] = unit.phones[unit.phones.length - 1]!
    const head = unit.phones.slice(0, -1)
    if (lastWord(unit) === "the" && last === "ə") unit.phones = [...head, ["ɪ", stress]]
    else if (lastWord(unit) === "to" && last === "ə") unit.phones = [...head, ["ʊ", stress]]
    else if (NO_LINK_BEFORE.has(firstWord(following))) continue
    else if (Object.prototype.hasOwnProperty.call(SPLIT, last)) unit.phones = [...head, [SPLIT[last]!, stress], ["ɹ", 0]]
    else if (RHOTIC.has(last)) unit.phones = [...unit.phones, ["ɹ", 0]]
    else if (last === "t" && FLAP_BEFORE_VOWEL.has(unit.word) && unit.phones.length > 1 && VOWEL_SET.has(unit.phones[unit.phones.length - 2]![0])) {
      unit.phones = [...head, ["ɾ", 0]]
    }
  }
}

/** Units of a clause as spoken words: an attached unit continues the one before. */
export function groups(units: readonly Unit[]): Phones[] {
  const out: Phones[] = []
  for (const unit of units) {
    if (unit.attach && out.length) out[out.length - 1] = [...out[out.length - 1]!, ...unit.phones]
    else out.push([...unit.phones])
  }
  return out.filter((group) => group.length)
}
