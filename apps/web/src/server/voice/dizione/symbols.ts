// The phone inventory and the token sequence built from it (dizione's symbols.py). The order is the model's ids.

import { ValueError } from "./py.ts"

/** A phone and its stress: 0 none, 1 primary, 2 secondary. */
export type Phone = readonly [phone: string, stress: number]
export type Phones = readonly Phone[]

export const PAD = "<pad>"
export const BOS = "<bos>"
export const EOS = "<eos>"
export const SP = "<sp>"
export const UNK = "<unk>"
export const PUNCTUATION = [",", ".", "?", "!", ";", ":", '"', "'", "(", ")", "—", "…"] as const
const CONSONANTS = ["p", "b", "t", "d", "k", "ɡ", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "h",
  "m", "n", "ŋ", "l", "ɹ", "j", "w", "tʃ", "dʒ", "ɾ", "ʔ"]
const VOWELS = ["ə", "ɐ", "ɚ", "ᵻ", "ɪ", "i", "iː", "ɛ", "æ", "ʌ", "ɑː", "ɔ", "ɔː", "ʊ", "uː", "ɜː",
  "eɪ", "aɪ", "ɔɪ", "oʊ", "aʊ", "iə", "oː",
  "ɑːɹ", "ɔːɹ", "oːɹ", "ɪɹ", "ɛɹ", "ʊɹ", "aɪɚ", "aɪə", "əl", "n̩"]
/** Every token of the model, in id order. */
export const SYMBOLS: readonly string[] = [PAD, BOS, EOS, SP, UNK, ...PUNCTUATION, ...CONSONANTS, ...VOWELS]
const SYMBOL_TO_ID = new Map(SYMBOLS.map((symbol, index) => [symbol, index]))
export const PHONE_SET: ReadonlySet<string> = new Set([...CONSONANTS, ...VOWELS])
export const VOWEL_SET: ReadonlySet<string> = new Set(VOWELS)
export const STRESS_MARKS: Readonly<Record<number, string>> = { 1: "ˈ", 2: "ˌ" }

/** `(true, mark)` for punctuation, `(false, words)` for text; a word is a list of phones. */
export type Piece = readonly [true, string] | readonly [false, Phones[]]

export interface Tokens {
  readonly symbols: string[]
  readonly ids: number[]
  readonly stress: number[]
}

/** The token sequence of the pieces: `<sp>` between words, repeated punctuation collapsed. Raises when there is
 * nothing to pronounce. */
export function tokenize(pieces: readonly Piece[]): Tokens {
  const symbols = [BOS]
  const stress = [0]
  for (const piece of pieces) {
    if (piece[0]) {
      if (symbols[symbols.length - 1] !== piece[1]) {
        symbols.push(piece[1])
        stress.push(0)
      }
      continue
    }
    for (const word of piece[1]) {
      const last = symbols[symbols.length - 1]!
      if (PHONE_SET.has(last) || last === UNK) {
        symbols.push(SP)
        stress.push(0)
      }
      for (const [phone, level] of word) {
        if (PHONE_SET.has(phone)) {
          symbols.push(phone)
          stress.push(level)
        } else {
          symbols.push(UNK)
          stress.push(0)
        }
      }
    }
  }
  symbols.push(EOS)
  stress.push(0)
  if (!symbols.some((symbol) => PHONE_SET.has(symbol) || symbol === UNK)) throw new ValueError("the text has nothing to pronounce")
  return { symbols, ids: symbols.map((symbol) => SYMBOL_TO_ID.get(symbol)!), stress }
}

/** `str(Phonemized)`: each symbol with its stress mark, separated by spaces. */
export const tokensText = (tokens: Tokens) =>
  tokens.symbols.map((symbol, index) => (STRESS_MARKS[tokens.stress[index]!] ?? "") + symbol).join(" ")
