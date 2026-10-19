import { MAX_PIN_CODE, MAX_PINS, type Pin, type PinInfo } from "~/shared/board"

/** One card's saved form and filter state is at most this big; a chat or pin keeps at most this many cards' state. */
const MAX_STATE_CHARS = 20_000
const MAX_STATES_PER_SCOPE = 200
const MAX_NOTES = 20

interface PinRow {
  id: string
  title: string
  code: string
  session_id: string | null
  position: number
  created_at: number
  updated_at: number
  [key: string]: SqlStorageValue
}

const toInfo = (row: PinRow): PinInfo => ({
  id: row.id,
  title: row.title,
  sessionId: row.session_id,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

/**
 * What generated UIs keep between visits: each card's form and filter state (so a reload keeps your choices), the
 * board's pinned cards, and notes for a chat about what you did in its UI (added to your next message, so the chat
 * knows; see DexAgent.deliver).
 */
export class UiCards {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS dex_ui_state (
      scope TEXT NOT NULL, card TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (scope, card))`)
    sql.exec(`CREATE TABLE IF NOT EXISTS dex_pins (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, code TEXT NOT NULL, session_id TEXT, position INTEGER NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    sql.exec(`CREATE TABLE IF NOT EXISTS dex_ui_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL)`)
  }

  // ── Card state ────────────────────────────────────────────────────────────

  states(scope: string): Record<string, unknown> {
    const rows = this.sql.exec<{ card: string; state: string }>(`SELECT card, state FROM dex_ui_state WHERE scope = ?`, scope).toArray()
    return Object.fromEntries(rows.map((row) => [row.card, JSON.parse(row.state) as unknown]))
  }

  saveState(scope: string, card: string, state: unknown) {
    const json = JSON.stringify(state ?? {})
    if (json.length > MAX_STATE_CHARS) throw new Error("That's too much to keep for one card.")
    this.sql.exec(
      `INSERT INTO dex_ui_state (scope, card, state, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (scope, card) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      scope, card.slice(0, 200), json, Date.now()
    )
    this.sql.exec(
      `DELETE FROM dex_ui_state WHERE scope = ? AND card NOT IN (SELECT card FROM dex_ui_state WHERE scope = ? ORDER BY updated_at DESC LIMIT ?)`,
      scope, scope, MAX_STATES_PER_SCOPE
    )
  }

  /** A chat or pin is gone: so is its saved state (and a chat's notes). */
  forget(scope: string) {
    this.sql.exec(`DELETE FROM dex_ui_state WHERE scope = ?`, scope)
    this.sql.exec(`DELETE FROM dex_ui_notes WHERE session_id = ?`, scope)
  }

  // ── Pins ──────────────────────────────────────────────────────────────────

  pins(): Pin[] {
    return this.sql.exec<PinRow>(`SELECT * FROM dex_pins ORDER BY position, created_at`).toArray().map((row) => ({ ...toInfo(row), code: row.code }))
  }

  pinInfos(): PinInfo[] {
    return this.sql.exec<PinRow>(`SELECT id, title, '' AS code, session_id, position, created_at, updated_at FROM dex_pins ORDER BY position, created_at`).toArray().map(toInfo)
  }

  pin(id: string): Pin | null {
    const row = this.sql.exec<PinRow>(`SELECT * FROM dex_pins WHERE id = ?`, id).toArray()[0]
    return row ? { ...toInfo(row), code: row.code } : null
  }

  addPin(input: { title: string; code: string; sessionId: string | null; state?: unknown }): Pin {
    const title = input.title.trim().slice(0, 80) || "Pinned"
    const code = input.code.trim()
    if (!code) throw new Error("There's no UI to pin.")
    if (code.length > MAX_PIN_CODE) throw new Error("That UI is too big to pin.")
    const count = this.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM dex_pins`).one().count
    if (count >= MAX_PINS) throw new Error(`The board holds ${MAX_PINS} panels; unpin one first.`)
    const id = crypto.randomUUID().slice(0, 8)
    const now = Date.now()
    const last = this.sql.exec<{ position: number | null }>(`SELECT MAX(position) AS position FROM dex_pins`).one().position ?? -1
    this.sql.exec(
      `INSERT INTO dex_pins (id, title, code, session_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, title, code, input.sessionId, last + 1, now, now
    )
    // It opens the way it looked in the chat: same filters, tabs, and choices.
    if (input.state && typeof input.state === "object") this.saveState(`pin:${id}`, "main", input.state)
    return this.pin(id)!
  }

  updatePin(id: string, changes: { title?: string; code?: string; position?: number }): Pin {
    const pin = this.pin(id)
    if (!pin) throw new Error(`No pinned panel ${id}.`)
    const title = changes.title !== undefined ? changes.title.trim().slice(0, 80) || pin.title : pin.title
    const code = changes.code !== undefined ? changes.code.trim() : pin.code
    if (!code) throw new Error("A panel needs its UI.")
    if (code.length > MAX_PIN_CODE) throw new Error("That UI is too big to pin.")
    this.sql.exec(`UPDATE dex_pins SET title = ?, code = ?, updated_at = ? WHERE id = ?`, title, code, Date.now(), id)
    if (changes.position !== undefined) this.move(id, changes.position)
    return this.pin(id)!
  }

  /** Puts a panel at `position` (0 is first) and renumbers the rest. */
  private move(id: string, position: number) {
    const ids = this.pinInfos().map((pin) => pin.id).filter((other) => other !== id)
    ids.splice(Math.max(0, Math.min(ids.length, Math.round(position))), 0, id)
    ids.forEach((pinId, index) => this.sql.exec(`UPDATE dex_pins SET position = ? WHERE id = ?`, index, pinId))
  }

  removePin(id: string) {
    if (!this.pin(id)) throw new Error(`No pinned panel ${id}.`)
    this.sql.exec(`DELETE FROM dex_pins WHERE id = ?`, id)
    this.forget(`pin:${id}`)
  }

  /** A chat was deleted: its pins stay on the board, without a chat to ask. */
  detachChat(sessionId: string) {
    this.sql.exec(`UPDATE dex_pins SET session_id = NULL WHERE session_id = ?`, sessionId)
  }

  // ── Notes for the chat ────────────────────────────────────────────────────

  /** Something you did with a chat's UI (a button that changed something), for the chat to hear about next time. */
  note(sessionId: string, text: string) {
    this.sql.exec(`INSERT INTO dex_ui_notes (session_id, at, text) VALUES (?, ?, ?)`, sessionId, Date.now(), text.slice(0, 300))
    this.sql.exec(
      `DELETE FROM dex_ui_notes WHERE session_id = ? AND id NOT IN (SELECT id FROM dex_ui_notes WHERE session_id = ? ORDER BY id DESC LIMIT ?)`,
      sessionId, sessionId, MAX_NOTES
    )
  }

  /** The chat's notes, oldest first, removed as they're handed over. */
  takeNotes(sessionId: string): string[] {
    const notes = this.sql.exec<{ text: string }>(`SELECT text FROM dex_ui_notes WHERE session_id = ? ORDER BY id`, sessionId).toArray().map((row) => row.text)
    if (notes.length) this.sql.exec(`DELETE FROM dex_ui_notes WHERE session_id = ?`, sessionId)
    return notes
  }
}
