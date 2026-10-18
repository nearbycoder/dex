/**
 * Secrets you type into a chat's password fields (API keys, tokens). The value never enters the transcript: the
 * chat sees `{{secret:<name>}}`, which the VM tools fill in on the VM, and any tool output that contains a value is
 * masked back to its placeholder before the model or the Machine page sees it. Stored encrypted, per chat, and
 * deleted with the chat.
 */

const PLACEHOLDER = /\{\{\s*secret:([a-z0-9_-]{1,64})\s*\}\}/gi

export const secretName = (field: string) =>
  field
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "secret"

const envName = (name: string) => `DEX_SECRET_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`
const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

export interface SecretHost {
  readonly sql: SqlStorage
  encrypt(value: string): Promise<string>
  decrypt(sealed: string): Promise<string | null>
}

export class SecretVault {
  /** Decrypted values by chat, loaded before a tool runs, so masking streamed output can be synchronous. */
  private readonly loaded = new Map<string, Map<string, string>>()

  constructor(private readonly host: SecretHost) {
    host.sql.exec(`CREATE TABLE IF NOT EXISTS dex_chat_secrets (
      session_id TEXT NOT NULL, name TEXT NOT NULL, sealed TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (session_id, name))`)
  }

  async store(sessionId: string, field: string, value: string) {
    const name = secretName(field)
    this.host.sql.exec(
      `INSERT INTO dex_chat_secrets (session_id, name, sealed, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, name) DO UPDATE SET sealed = excluded.sealed, created_at = excluded.created_at`,
      sessionId, name, await this.host.encrypt(value), Date.now()
    )
    this.loaded.delete(sessionId)
    return name
  }

  names(sessionId: string): string[] {
    return this.host.sql
      .exec<{ name: string }>(`SELECT name FROM dex_chat_secrets WHERE session_id = ? ORDER BY created_at`, sessionId)
      .toArray()
      .map((row) => row.name)
  }

  forget(sessionId: string) {
    this.host.sql.exec(`DELETE FROM dex_chat_secrets WHERE session_id = ?`, sessionId)
    this.loaded.delete(sessionId)
  }

  /** Loads a chat's values for `fill` and `mask`. */
  async prepare(sessionId: string): Promise<ReadonlyMap<string, string>> {
    const cached = this.loaded.get(sessionId)
    if (cached) return cached
    const values = new Map<string, string>()
    const rows = this.host.sql.exec<{ name: string; sealed: string }>(`SELECT name, sealed FROM dex_chat_secrets WHERE session_id = ?`, sessionId).toArray()
    for (const row of rows) {
      const value = await this.host.decrypt(row.sealed)
      if (value) values.set(row.name, value)
    }
    this.loaded.set(sessionId, values)
    return values
  }

  private lookup(values: ReadonlyMap<string, string>, name: string) {
    const value = values.get(name.toLowerCase())
    if (value === undefined) {
      const known = [...values.keys()]
      throw new Error(`No secret named ${name} in this chat.${known.length ? ` It has: ${known.join(", ")}.` : " Ask the user for it with a password field (render_ui)."}`)
    }
    return value
  }

  /** File content with its placeholders replaced by the values (for vm_write_file). */
  async fill(sessionId: string, content: string) {
    if (!content.match(PLACEHOLDER)) return content
    const values = await this.prepare(sessionId)
    return content.replace(PLACEHOLDER, (_match, name: string) => this.lookup(values, name))
  }

  /**
   * A command with its placeholders turned into environment variables, and a script defining them that the VM
   * sources from a file and deletes, so values never appear in the command, the activity log, or `ps`.
   */
  async command(sessionId: string, command: string): Promise<{ command: string; env: string | null }> {
    const used = new Set<string>()
    for (const match of command.matchAll(PLACEHOLDER)) used.add(match[1]!.toLowerCase())
    if (!used.size) return { command, env: null }
    const values = await this.prepare(sessionId)
    const env = [...used].map((name) => `export ${envName(name)}=${shellQuote(this.lookup(values, name))}`).join("\n")
    return { command: command.replace(PLACEHOLDER, (_match, name: string) => `\${${envName(name)}}`), env }
  }

  /** Text with any secret value of the chat replaced by its placeholder. Uses values loaded by `prepare`. */
  mask(sessionId: string, text: string) {
    const values = this.loaded.get(sessionId)
    if (!values?.size || !text) return text
    let masked = text
    for (const [name, value] of values) if (value.length >= 4) masked = masked.split(value).join(`{{secret:${name}}}`)
    return masked
  }
}
