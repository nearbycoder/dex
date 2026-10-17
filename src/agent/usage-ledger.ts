import type { AssistantMessage, Usage } from "@earendil-works/pi-ai"
import { BOAT_HOURLY, type BoatUsage, type ClineUsage } from "~/shared/usage"

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

interface LlmRow {
  at: number
  session_id: string
  model: string
  input: number
  output: number
  cache_read: number
  total_tokens: number
  cost: number
  [key: string]: SqlStorageValue
}

interface RunRow {
  id: number
  sandbox_id: string
  size: string
  started_at: number
  ended_at: number | null
  [key: string]: SqlStorageValue
}

export const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Every UTC date from `since` to `until`, inclusive. */
export const datesBetween = (since: number, until: number) => {
  const dates: string[] = []
  for (let day = Date.parse(utcDate(since)); day <= until; day += DAY_MS) dates.push(utcDate(day))
  return dates
}

/**
 * What Dex has used: one row per model response (tokens and their list-price
 * cost) and one row per VM run. Cloudflare usage is read from its analytics
 * API instead, since Cloudflare measures it.
 */
export class UsageLedger {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS dex_usage_llm (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, session_id TEXT NOT NULL, model TEXT NOT NULL,
      input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL, cost REAL NOT NULL, dedupe TEXT UNIQUE)`)
    sql.exec(`CREATE INDEX IF NOT EXISTS dex_usage_llm_at ON dex_usage_llm (at)`)
    sql.exec(`CREATE TABLE IF NOT EXISTS dex_vm_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sandbox_id TEXT NOT NULL, size TEXT NOT NULL,
      started_at INTEGER NOT NULL, ended_at INTEGER)`)
  }

  // ── Model responses ───────────────────────────────────────────────────────

  private insertUsage(at: number, sessionId: string, model: string, usage: Usage, dedupe: string) {
    if (!usage.totalTokens) return
    this.sql.exec(
      `INSERT OR IGNORE INTO dex_usage_llm (at, session_id, model, input, output, cache_read, cache_write, total_tokens, cost, dedupe)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      at, sessionId, model, usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens, usage.cost.total, dedupe
    )
  }

  /** Called for every model response; replays after a restart are deduplicated. */
  recordResponse(sessionId: string, message: AssistantMessage) {
    this.insertUsage(
      message.timestamp || Date.now(),
      sessionId,
      message.model,
      message.usage,
      `${sessionId}:${message.timestamp}:${message.responseId ?? ""}`
    )
  }

  /** One-time import of usage recorded before the ledger existed, dated at the chat's last activity. */
  backfill(sessionId: string, at: number, models: Readonly<Record<string, Usage>>) {
    for (const [key, usage] of Object.entries(models)) {
      // Keys are `provider/modelId`; model ids contain a slash themselves.
      const model = key.slice(key.indexOf("/") + 1)
      this.insertUsage(at, sessionId, model, usage, `backfill:${sessionId}:${key}`)
    }
  }

  clineUsage(since: number, until: number, titles: ReadonlyMap<string, string>): ClineUsage {
    const rows = this.sql
      .exec<LlmRow>(`SELECT at, session_id, model, input, output, cache_read, total_tokens, cost FROM dex_usage_llm WHERE at >= ? AND at <= ?`, since, until)
      .toArray()
    const byModel = new Map<string, { model: string; responses: number; totalTokens: number; listCost: number }>()
    const byChat = new Map<string, { sessionId: string; title: string; totalTokens: number; listCost: number }>()
    let input = 0, output = 0, cacheRead = 0, total = 0, cost = 0
    for (const row of rows) {
      input += row.input
      output += row.output
      cacheRead += row.cache_read
      total += row.total_tokens
      cost += row.cost
      const model = byModel.get(row.model) ?? { model: row.model, responses: 0, totalTokens: 0, listCost: 0 }
      model.responses++
      model.totalTokens += row.total_tokens
      model.listCost += row.cost
      byModel.set(row.model, model)
      const chat = byChat.get(row.session_id) ?? {
        sessionId: row.session_id,
        title: titles.get(row.session_id) ?? "Deleted chat",
        totalTokens: 0,
        listCost: 0
      }
      chat.totalTokens += row.total_tokens
      chat.listCost += row.cost
      byChat.set(row.session_id, chat)
    }
    return {
      responses: rows.length,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      totalTokens: total,
      listCost: cost,
      byModel: [...byModel.values()].sort((a, b) => b.listCost - a.listCost),
      byChat: [...byChat.values()].sort((a, b) => b.listCost - a.listCost).slice(0, 10)
    }
  }

  clineDaily(since: number, until: number): Map<string, number> {
    const daily = new Map<string, number>()
    for (const row of this.sql.exec<{ at: number; cost: number }>(`SELECT at, cost FROM dex_usage_llm WHERE at >= ? AND at <= ?`, since, until)) {
      daily.set(utcDate(row.at), (daily.get(utcDate(row.at)) ?? 0) + row.cost)
    }
    return daily
  }

  earliest(): number | null {
    const llm = this.sql.exec<{ at: number | null }>(`SELECT min(at) AS at FROM dex_usage_llm`).one().at
    const vm = this.sql.exec<{ at: number | null }>(`SELECT min(started_at) AS at FROM dex_vm_runs`).one().at
    const values = [llm, vm].filter((value): value is number => value !== null)
    return values.length ? Math.min(...values) : null
  }

  // ── VM runs ───────────────────────────────────────────────────────────────

  private openRun(sandboxId: string): RunRow | undefined {
    return this.sql.exec<RunRow>(`SELECT * FROM dex_vm_runs WHERE sandbox_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`, sandboxId).toArray()[0]
  }

  /** A VM is running (billed from now) unless its run is already open. */
  runStarted(sandboxId: string, size: string) {
    if (this.openRun(sandboxId)) return
    this.sql.exec(`INSERT INTO dex_vm_runs (sandbox_id, size, started_at) VALUES (?, ?, ?)`, sandboxId, size, Date.now())
  }

  /** A VM stopped at `at` (when boat last changed its state, if known). */
  runEnded(sandboxId: string, at: number) {
    const run = this.openRun(sandboxId)
    if (!run) return
    this.sql.exec(`UPDATE dex_vm_runs SET ended_at = ? WHERE id = ?`, Math.max(run.started_at, Math.min(at, Date.now())), run.id)
  }

  /** VM runs clipped to the range, priced at boat's hourly rate for their size. */
  boatUsage(since: number, until: number): { usage: BoatUsage; daily: Map<string, number> } {
    const rows = this.sql
      .exec<RunRow>(`SELECT * FROM dex_vm_runs WHERE started_at <= ? AND (ended_at IS NULL OR ended_at >= ?) ORDER BY started_at DESC`, until, since)
      .toArray()
    const daily = new Map<string, number>()
    const bySize = new Map<string, { size: string; hours: number; cost: number }>()
    const runs: Array<BoatUsage["runs"][number]> = []
    let hours = 0, cost = 0
    for (const row of rows) {
      const start = Math.max(row.started_at, since)
      const end = Math.min(row.ended_at ?? Date.now(), until)
      if (end <= start) continue
      const rate = BOAT_HOURLY[row.size] ?? BOAT_HOURLY.default!
      const runHours = (end - start) / HOUR_MS
      hours += runHours
      cost += runHours * rate
      const size = bySize.get(row.size) ?? { size: row.size, hours: 0, cost: 0 }
      size.hours += runHours
      size.cost += runHours * rate
      bySize.set(row.size, size)
      runs.push({ startedAt: row.started_at, endedAt: row.ended_at, size: row.size, hours: runHours, cost: runHours * rate })
      // Split the run across the UTC days it spans.
      for (let cursor = start; cursor < end; ) {
        const dayEnd = Date.parse(utcDate(cursor)) + DAY_MS
        const sliceEnd = Math.min(dayEnd, end)
        daily.set(utcDate(cursor), (daily.get(utcDate(cursor)) ?? 0) + ((sliceEnd - cursor) / HOUR_MS) * rate)
        cursor = sliceEnd
      }
    }
    return {
      usage: {
        hours,
        cost,
        running: this.sql.exec(`SELECT 1 FROM dex_vm_runs WHERE ended_at IS NULL LIMIT 1`).toArray().length > 0,
        bySize: [...bySize.values()],
        runs: runs.slice(0, 20)
      },
      daily
    }
  }
}
