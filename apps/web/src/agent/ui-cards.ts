/** One card's saved form and filter state is at most this big; a chat keeps at most this many cards' state. */
const MAX_STATE_CHARS = 20_000
const MAX_STATES_PER_SCOPE = 200
const MAX_NOTES = 20

/**
 * What generated UIs keep between visits: each card's form and filter state (so a reload keeps your choices), and
 * notes for a chat about what you did in its UI (added to your next message, so the chat knows; see DexAgent.deliver).
 */
export class UiCards {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS dex_ui_state (
      scope TEXT NOT NULL, card TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (scope, card))`)
    // The board of pinned cards is gone: its panels and their saved state go with it.
    sql.exec(`DROP TABLE IF EXISTS dex_pins`)
    sql.exec(`DELETE FROM dex_ui_state WHERE scope LIKE 'pin:%'`)
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

  /** A chat is gone: so are its cards' saved state and its notes. */
  forget(scope: string) {
    this.sql.exec(`DELETE FROM dex_ui_state WHERE scope = ?`, scope)
    this.sql.exec(`DELETE FROM dex_ui_notes WHERE session_id = ?`, scope)
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
