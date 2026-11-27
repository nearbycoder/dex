// Which letters spell which phoneme (dizione's align.py, the run-time half).

const MAX_RUN = 4
const UNSEEN = -14.0

/** An ARPABET symbol without its stress digit. */
export const base = (symbol: string) => symbol.replace(/[012]+$/, "")

/** Splits a word into one run of letters per phoneme, from align.json's log probabilities. */
export class Aligner {
  private readonly table: Map<string, Map<string, number>>

  constructor(table: Readonly<Record<string, Readonly<Record<string, number>>>>) {
    this.table = new Map(Object.entries(table).map(([phone, runs]) => [phone, new Map(Object.entries(runs))]))
  }

  score(phone: string, run: string): number {
    const value = this.table.get(phone)?.get(run)
    return value ?? UNSEEN - 2.0 * Math.abs(run.length - 1)
  }

  /** One run of letters per phoneme of ``phones`` (stress digits allowed), or null when the word is too long for it. */
  align(word: string, phones: readonly string[]): string[] | null {
    const count = phones.length
    const letters = word.length
    if (!count || letters > MAX_RUN * count) return null
    const stride = letters + 1
    const low = -1e18
    const best = new Float64Array((count + 1) * stride)
    best.fill(low)
    const step = new Uint8Array((count + 1) * stride)
    best[0] = 0.0
    for (let j = 1; j <= count; j++) {
      const phoneMap = this.table.get(base(phones[j - 1]!))
      const prevRow = (j - 1) * stride
      const curRow = j * stride
      for (let i = 0; i <= letters; i++) {
        let bestVal = low
        let bestK = 0
        const maxK = i < MAX_RUN ? i : MAX_RUN
        for (let k = 0; k <= maxK; k++) {
          const prev = best[prevRow + i - k]!
          if (prev > low) {
            const run = word.slice(i - k, i)
            const s = phoneMap?.get(run) ?? (UNSEEN - 2.0 * Math.abs(k - 1))
            const value = prev + s
            if (value > bestVal) {
              bestVal = value
              bestK = k
            }
          }
        }
        best[curRow + i] = bestVal
        step[curRow + i] = bestK
      }
    }
    if (best[count * stride + letters]! <= low) return null
    const runs = new Array<string>(count)
    let i = letters
    for (let j = count; j > 0; j--) {
      const k = step[j * stride + i]!
      runs[j - 1] = word.slice(i - k, i)
      i -= k
    }
    return runs
  }
}
