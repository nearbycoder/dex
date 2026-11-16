// A TypeScript port of dizione (https://github.com/n4ze3m/dizione, Apache-2.0), the English phonemizer tiny-voca was
// trained with: text -> the model's phoneme ids and stress, exactly as the Python package gives them. The tables
// are embedded (data.ts); the built files (dictionary, alignment, the unknown-word model, the homograph weights)
// come from the caller, so the Worker can fetch them from tiny-voca's repository at the pinned revision.

import { DIZIONE_COMMIT, TABLES } from "./data.ts"
import { Phonemizer } from "./engine.ts"
import { Model, readNpz } from "./g2p.ts"
import { Homographs, readRules } from "./homographs.ts"
import { asPythonSees, strip, ValueError } from "./py.ts"
import { tokenize, tokensText } from "./symbols.ts"

export { DIZIONE_COMMIT }
export { SYMBOLS } from "./symbols.ts"

/** The model's input for one text: token ids, the stress of each (0 none, 1 primary, 2 secondary), and the
 * symbols with their stress marks as dizione prints them. */
export interface Phonemized {
  readonly ids: number[]
  readonly stress: number[]
  readonly text: string
}

export interface Dizione {
  /** `dizione.phonemize(text)`; null when the text has nothing to pronounce (only marks, emoji, other scripts).
   * Throws only where the Python package raises for real. */
  phonemize(text: string): Phonemized | null
}

/** The files of tiny-voca's `phonemizer/` folder the phonemizer reads. */
export const DIZIONE_FILES: readonly string[] = ["lexicon.tsv", "align.json", "g2p.json", "g2p.npz", "homographs.json"]

/** The phonemizer over the built files ``read`` returns by name (from `DIZIONE_FILES`). Load it once and keep it. */
export async function loadDizione(read: (name: string) => Promise<Uint8Array>): Promise<Dizione> {
  const [lexicon, align, settings, weights, homographs] = await Promise.all(DIZIONE_FILES.map(read))
  // As Python reads them: UTF-8, a byte order mark kept.
  const text = (bytes: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
  const phonemizer = new Phonemizer({
    lexicon: text(lexicon!),
    align: JSON.parse(text(align!)),
    model: new Model(JSON.parse(text(settings!)), await readNpz(weights!)),
    homographs: new Homographs(JSON.parse(text(homographs!)), readRules(TABLES["homograph_rules.txt"]))
  })
  return {
    phonemize(original) {
      const input = asPythonSees(original)
      try {
        if (!strip(input)) throw new ValueError("text must not be empty")
        const tokens = tokenize(phonemizer.pieces(input))
        return { ids: tokens.ids, stress: tokens.stress, text: tokensText(tokens) }
      } catch (error) {
        // As tiny-voca's web demo does: nothing to pronounce is no failure, anything else is.
        if (!(error instanceof ValueError)) throw error
        if (phonemizer.pieces(input).some((piece) => !piece[0] && piece[1].length > 0)) throw error
        return null
      }
    }
  }
}
