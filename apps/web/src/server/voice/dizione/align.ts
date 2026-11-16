// Which letters spell which phoneme (dizione's align.py, the run-time half).

const MAX_RUN = 4
const UNSEEN = -14.0

/** An ARPABET symbol without its stress digit. */
export const base = (symbol: string) => symbol.replace(/[012]+$/, "")

/** Splits a word into one run of letters per phoneme, from align.json's log probabilities. */
export class Aligner {
  private readonly table: Readonly<Record<string, Readonly<Record<string, number>>>>

  constructor(table: Readonly<Record<string, Readonly<Record<string, number>>>>) {
    this.table = table
  }

  score(phone: string, run: string): number {
    const known = Object.prototype.hasOwnProperty.call(this.table, phone) ? this.table[phone] : undefined
    const value = known && Object.prototype.hasOwnProperty.call(known, run) ? known[run] : undefined
    return value ?? UNSEEN - 2.0 * Math.abs(run.length - 1)
  }

  /** One run of letters per phoneme of ``phones`` (stress digits allowed), or null when the word is too long for it. */
  align(word: string, phones: readonly string[]): string[] | null {
    const bases = phones.map(base)
    const letters = word.length
    const count = bases.length
    if (!count || letters > MAX_RUN * count) return null
    const low = -1e18
    const best = Array.from({ length: count + 1 }, () => new Array<number>(letters + 1).fill(low))
    const step = Array.from({ length: count + 1 }, () => new Array<number>(letters + 1).fill(0))
    best[0]![0] = 0.0
    for (let j = 1; j <= count; j++) {
      const phone = bases[j - 1]!
      const previous = best[j - 1]!
      const row = best[j]!
      const trace = step[j]!
      for (let i = 0; i <= letters; i++) {
        for (let k = 0; k <= Math.min(MAX_RUN, i); k++) {
          if (previous[i - k]! > low) {
            const value = previous[i - k]! + this.score(phone, word.slice(i - k, i))
            if (value > row[i]!) {
              row[i] = value
              trace[i] = k
            }
          }
        }
      }
    }
    if (best[count]![letters]! <= low) return null
    const runs: string[] = []
    let i = letters
    for (let j = count; j > 0; j--) {
      const k = step[j]![i]!
      runs.push(word.slice(i - k, i))
      i -= k
    }
    return runs.reverse()
  }
}
