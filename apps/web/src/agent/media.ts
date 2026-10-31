import { type ChatArtifact, MAX_MEDIA_BYTES, mediaTypeOf } from "~/shared/media"

const UPLOAD_TTL_MS = 15 * 60_000
const TOKEN_PREFIX = "dexu"

interface UploadRow {
  token_hash: string
  session_id: string
  key: string
  name: string
  content_type: string
  expires_at: number
  used: number
  [key: string]: SqlStorageValue
}

export interface SharedMedia {
  readonly key: string
  readonly url: string
  readonly name: string
  readonly contentType: string
  readonly kind: "video" | "audio" | "image"
  readonly size: number
}

export interface MediaHost {
  readonly sql: SqlStorage
  readonly bucket: R2Bucket | undefined
  /** This agent's user id: media keys start with it, so the Worker can tell whose they are without asking. */
  userId(): string
  sign(payload: string): Promise<string>
}

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
const sha256 = async (text: string) => toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
export const encodeUserId = (userId: string) => base64url(new TextEncoder().encode(userId))

/** `dexu.<user>.<random>.<tag>`: a single-use upload credential for one file, checked by the Worker's HMAC first. */
export const parseUploadToken = (token: string) => {
  const [prefix, user, random, tag, ...rest] = token.split(".")
  if (prefix !== TOKEN_PREFIX || !user || !random || !tag || rest.length) return null
  try {
    const userId = new TextDecoder().decode(Uint8Array.from(atob(user.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0)))
    return { userId, signed: `${TOKEN_PREFIX}.${user}.${random}`, tag }
  } catch {
    return null
  }
}

/**
 * Files a chat shares from its VM. The VM uploads straight to Dex with a single-use token (no base64 round trip
 * through the agent), the bytes land in R2 under this user's prefix, and the chat gets a private /api/media URL.
 * A chat's media is deleted with the chat.
 */
export class MediaCenter {
  constructor(private readonly host: MediaHost) {
    host.sql.exec(`CREATE TABLE IF NOT EXISTS dex_media (
      key TEXT PRIMARY KEY, session_id TEXT NOT NULL, name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL,
      created_at INTEGER NOT NULL)`)
    host.sql.exec(`CREATE TABLE IF NOT EXISTS dex_media_uploads (
      token_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, content_type TEXT NOT NULL,
      expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)`)
    // Where a file was saved from: the VM link a chat served it at (see vmMediaSource), so that link plays this copy.
    const columns = host.sql.exec<{ name: string }>(`PRAGMA table_info(dex_media)`).toArray()
    if (!columns.some((column) => column.name === "source")) host.sql.exec(`ALTER TABLE dex_media ADD COLUMN source TEXT`)
  }

  get configured() {
    return Boolean(this.host.bucket)
  }

  /** A token and key for uploading the file at `path` (its extension decides the type). */
  async createUpload(sessionId: string, path: string, title?: string) {
    const media = mediaTypeOf(path)
    if (!media) throw new Error("Only videos (mp4, mov, webm), audio (mp3, m4a, wav, ogg), and images (png, jpg, gif, webp) can be shared.")
    const extension = path.split(".").pop()!.toLowerCase()
    const key = `${encodeUserId(this.host.userId())}/${crypto.randomUUID()}.${extension}`
    const random = base64url(crypto.getRandomValues(new Uint8Array(32)))
    const signed = `${TOKEN_PREFIX}.${encodeUserId(this.host.userId())}.${random}`
    const token = `${signed}.${await this.host.sign(signed)}`
    const name = (title?.trim() || path.split("/").pop() || "media").slice(0, 120)
    this.host.sql.exec(`DELETE FROM dex_media_uploads WHERE expires_at < ?`, Date.now())
    this.host.sql.exec(
      `INSERT INTO dex_media_uploads (token_hash, session_id, key, name, content_type, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
      await sha256(token), sessionId, key, name, media.type, Date.now() + UPLOAD_TTL_MS
    )
    return { token, key, name, contentType: media.type, kind: media.kind }
  }

  /** Claims an upload token (once) for a body of `size` bytes. Null if it's unknown, used, expired, or too big. */
  async consumeUpload(token: string, size: number) {
    if (!Number.isFinite(size) || size <= 0 || size > MAX_MEDIA_BYTES) return null
    const hash = await sha256(token)
    const row = this.host.sql.exec<UploadRow>(`SELECT * FROM dex_media_uploads WHERE token_hash = ?`, hash).toArray()[0]
    if (!row || row.used || row.expires_at < Date.now()) return null
    this.host.sql.exec(`UPDATE dex_media_uploads SET used = 1 WHERE token_hash = ?`, hash)
    return { key: row.key, contentType: row.content_type, name: row.name, sessionId: row.session_id }
  }

  finishUpload(key: string, sessionId: string, name: string, contentType: string, size: number) {
    this.host.sql.exec(
      `INSERT OR REPLACE INTO dex_media (key, session_id, name, content_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      key, sessionId, name, contentType, size, Date.now()
    )
  }

  setSource(key: string, source: string) {
    this.host.sql.exec(`UPDATE dex_media SET source = ? WHERE key = ?`, source, key)
  }

  /** The copy of a VM link a chat already saved, if any. */
  bySource(sessionId: string, source: string): SharedMedia | null {
    const key = this.host.sql
      .exec<{ key: string }>(`SELECT key FROM dex_media WHERE session_id = ? AND source = ? ORDER BY created_at DESC LIMIT 1`, sessionId, source)
      .toArray()[0]?.key
    return key ? this.get(key) : null
  }

  /** A chat's files, oldest first. */
  list(sessionId: string): ChatArtifact[] {
    return this.host.sql
      .exec<{ key: string; name: string; size: number; source: string | null; created_at: number }>(
        `SELECT key, name, size, source, created_at FROM dex_media WHERE session_id = ? ORDER BY created_at`,
        sessionId
      )
      .toArray()
      .flatMap((row) => {
        const media = mediaTypeOf(row.key)
        return media
          ? [{ key: row.key, url: `/api/media/${row.key}`, name: row.name, kind: media.kind, size: row.size, source: row.source, createdAt: row.created_at }]
          : []
      })
  }

  get(key: string): SharedMedia | null {
    const row = this.host.sql
      .exec<{ key: string; name: string; content_type: string; size: number }>(`SELECT key, name, content_type, size FROM dex_media WHERE key = ?`, key)
      .toArray()[0]
    const media = row && mediaTypeOf(row.key)
    return row && media ? { key: row.key, url: `/api/media/${row.key}`, name: row.name, contentType: row.content_type, kind: media.kind, size: row.size } : null
  }

  /** Deletes the media of chats that are gone (`alive` says which still exist). */
  async reap(alive: (sessionId: string) => boolean) {
    const rows = this.host.sql.exec<{ key: string; session_id: string }>(`SELECT key, session_id FROM dex_media`).toArray()
    const dead = rows.filter((row) => !alive(row.session_id)).map((row) => row.key)
    if (!dead.length || !this.host.bucket) return
    for (let index = 0; index < dead.length; index += 500) await this.host.bucket.delete(dead.slice(index, index + 500))
    for (const key of dead) this.host.sql.exec(`DELETE FROM dex_media WHERE key = ?`, key)
  }
}
