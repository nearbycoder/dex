// The hand-written tables that ship with dizione's source (data/*.txt, embedded in data.ts): one entry per line,
// columns separated by tabs or two or more spaces, "#" starts a comment (dizione's tables.py).

import { convert, fromText, isArpabet } from "./convert.ts"
import { split, splitlines, strip } from "./py.ts"
import type { Phones } from "./symbols.ts"

const COLUMNS = /\t+| {2,}/
const STRESS_CLASSES = new Set(["u", "uf", "ur", "s", "ss", "si", "pf", "p"])

/** `[line number, columns]` for every entry of a table's text. */
export function* rows(text: string): Generator<[number, string[]]> {
  let number = 0
  for (const raw of splitlines(text)) {
    number++
    const line = strip(raw)
    if (line && !line.startsWith("#")) yield [number, line.split(COLUMNS).map((column) => strip(column))]
  }
}

/** word -> [class, form, final form or null]. */
export function functionWords(text: string): Map<string, readonly [string, Phones, Phones | null]> {
  const table = new Map<string, readonly [string, Phones, Phones | null]>()
  for (const [number, columns] of rows(text)) {
    if ((columns.length !== 3 && columns.length !== 4) || !STRESS_CLASSES.has(columns[1]!)) {
      throw new Error(`function_words.txt line ${number}: expected word, class, form[, final form]`)
    }
    table.set(columns[0]!, [columns[1]!, fromText(columns[2]!), columns.length === 4 ? fromText(columns[3]!) : null])
  }
  return table
}

/** Phrases keyed by their words joined with a space: [class, one form per spoken word, final form or null]. */
export function phrases(text: string): Map<string, readonly [string, Phones[], Phones | null]> {
  const table = new Map<string, readonly [string, Phones[], Phones | null]>()
  for (const [number, columns] of rows(text)) {
    if ((columns.length !== 3 && columns.length !== 4) || !STRESS_CLASSES.has(columns[1]!)) {
      throw new Error(`phrases.txt line ${number}: expected words, class, form[, final form]`)
    }
    const forms = columns[2]!.split("|").map(fromText)
    if (forms.length > 1 && (columns[1] !== "p" || forms.length !== split(columns[0]!).length)) {
      throw new Error(`phrases.txt line ${number}: a form with boundaries needs class p and one part per word`)
    }
    table.set(split(columns[0]!).join(" "), [columns[1]!, forms, columns.length === 4 ? fromText(columns[3]!) : null])
  }
  return table
}

/** A pronunciation as written in a table: CMUdict notation or phones with stress marks. */
export type Entry = readonly ["arpabet", string[]] | readonly ["phones", Phones]

const pronunciation = (text: string): Entry => {
  const symbols = split(text)
  return isArpabet(symbols) ? ["arpabet", symbols] : ["phones", fromText(text)]
}

/** Single words of a pronunciation table, keyed in lower case. */
export function pronunciations(text: string): Map<string, Entry> {
  const table = new Map<string, Entry>()
  for (const [number, columns] of rows(text)) {
    if (columns.length !== 2) throw new Error(`line ${number}: expected a word and its pronunciation, separated by a tab or two spaces`)
    if (split(columns[0]!).length === 1) table.set(columns[0]!.toLowerCase(), pronunciation(columns[1]!))
  }
  return table
}

/** Names of several words, keyed by their words joined with a space: one pronunciation per word. */
export function names(text: string): Map<string, Entry[]> {
  const table = new Map<string, Entry[]>()
  for (const [number, columns] of rows(text)) {
    const words = split(columns[0]!.toLowerCase())
    if (columns.length !== 2 || words.length < 2) continue
    const parts = columns[1]!.split("|").map((part) => strip(part))
    if (parts.length !== words.length) throw new Error(`line ${number}: '${columns[0]}' has ${words.length} words and ${parts.length} pronunciations`)
    table.set(words.join(" "), parts.map(pronunciation))
  }
  return table
}

/** Two-column table as a map (second column may be empty). */
export function mapping(text: string): Map<string, string> {
  return new Map(Array.from(rows(text), ([, columns]) => [columns[0]!, columns.length > 1 ? columns[1]! : ""]))
}

/** Phones of a table entry for ``word``. */
export function entryPhones(word: string, entry: Entry, align: (word: string, symbols: string[]) => string[] | null): Phones {
  return entry[0] === "phones" ? entry[1] : convert(word, entry[1], align(word, entry[1]))
}
