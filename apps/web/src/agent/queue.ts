import type { ChatAttachment } from "~/shared/attachments"
import type { QueuedMessage } from "~/shared/protocol"

interface Row {
  id: string
  session_id: string
  text: string
  position: number
  created_at: number
  /** JSON: the message's attachments, ready for the model. Null without any. */
  attachments: string | null
  [key: string]: SqlStorageValue
}

/**
 * Messages you sent while a chat was busy, waiting their turn. Dex keeps them (not Pi's inbox) so they can be
 * edited, reordered, deleted, or sent now as a steer until the chat takes them; one goes each time a run ends.
 * A chat you stopped holds its queue until you send something or pick a message to send.
 */
export class MessageQueue {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS dex_queue (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, text TEXT NOT NULL, position REAL NOT NULL, created_at INTEGER NOT NULL)`)
    sql.exec(`CREATE INDEX IF NOT EXISTS dex_queue_session ON dex_queue (session_id, position)`)
    sql.exec(`CREATE TABLE IF NOT EXISTS dex_queue_holds (session_id TEXT PRIMARY KEY)`)
    const columns = sql.exec<{ name: string }>(`PRAGMA table_info(dex_queue)`).toArray().map((column) => column.name)
    if (!columns.includes("attachments")) sql.exec(`ALTER TABLE dex_queue ADD COLUMN attachments TEXT`)
  }

  list(sessionId: string): QueuedMessage[] {
    return this.sql
      .exec<Row>(`SELECT * FROM dex_queue WHERE session_id = ? ORDER BY position, created_at`, sessionId)
      .toArray()
      .map((row) => {
        const files = parseAttachments(row.attachments).map(({ name, mimeType }) => ({ name, mimeType }))
        return { id: row.id, text: row.text, createdAt: row.created_at, ...(files.length > 0 && { attachments: files }) }
      })
  }

  /** Chats with messages waiting. */
  sessions(): string[] {
    return this.sql
      .exec<{ session_id: string }>(`SELECT DISTINCT session_id FROM dex_queue`)
      .toArray()
      .map((row) => row.session_id)
  }

  add(sessionId: string, text: string, attachments: readonly ChatAttachment[] = []) {
    const last = this.sql.exec<{ position: number | null }>(`SELECT MAX(position) AS position FROM dex_queue WHERE session_id = ?`, sessionId).one().position
    this.sql.exec(
      `INSERT INTO dex_queue (id, session_id, text, position, created_at, attachments) VALUES (?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(), sessionId, text, (last ?? 0) + 1, Date.now(), attachments.length ? JSON.stringify(attachments) : null
    )
  }

  private find(sessionId: string, id: string) {
    const row = this.sql.exec<Row>(`SELECT * FROM dex_queue WHERE session_id = ? AND id = ?`, sessionId, id).toArray()[0]
    if (!row) throw new Error("That message was already sent or removed.")
    return row
  }

  edit(sessionId: string, id: string, text: string) {
    this.find(sessionId, id)
    this.sql.exec(`UPDATE dex_queue SET text = ? WHERE id = ?`, text, id)
  }

  /** Takes a message out of the queue (to send it, or to delete it) and returns it. */
  take(sessionId: string, id: string): { text: string; attachments: ChatAttachment[] } {
    const row = this.find(sessionId, id)
    this.sql.exec(`DELETE FROM dex_queue WHERE id = ?`, id)
    return { text: row.text, attachments: parseAttachments(row.attachments) }
  }

  /** Takes the next message in line, if any. */
  next(sessionId: string): { text: string; attachments: ChatAttachment[] } | null {
    const first = this.list(sessionId)[0]
    return first ? this.take(sessionId, first.id) : null
  }

  /** Moves a message to `index` in the line (0 is next). */
  move(sessionId: string, id: string, index: number) {
    const ids = this.list(sessionId).map((item) => item.id)
    const from = ids.indexOf(id)
    if (from === -1) throw new Error("That message was already sent or removed.")
    ids.splice(from, 1)
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id)
    ids.forEach((each, position) => this.sql.exec(`UPDATE dex_queue SET position = ? WHERE id = ?`, position + 1, each))
  }

  clear(sessionId: string) {
    this.sql.exec(`DELETE FROM dex_queue WHERE session_id = ?`, sessionId)
    this.release(sessionId)
  }

  hold(sessionId: string) {
    this.sql.exec(`INSERT OR IGNORE INTO dex_queue_holds (session_id) VALUES (?)`, sessionId)
  }

  release(sessionId: string) {
    this.sql.exec(`DELETE FROM dex_queue_holds WHERE session_id = ?`, sessionId)
  }

  held(sessionId: string) {
    return this.sql.exec(`SELECT 1 FROM dex_queue_holds WHERE session_id = ?`, sessionId).toArray().length > 0
  }
}

const parseAttachments = (json: string | null): ChatAttachment[] => {
  if (!json) return []
  try {
    return JSON.parse(json) as ChatAttachment[]
  } catch {
    return []
  }
}
