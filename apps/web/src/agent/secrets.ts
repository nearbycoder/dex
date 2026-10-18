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

/** An account secret's name is the environment variable it becomes on VMs. */
export const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/
const RESERVED = /^(PATH|HOME|USER|SHELL|PWD|LANG|TERM|DISPLAY|HOSTNAME|DEX_SECRET_.*)$/

/** Where VMs keep them: sourced by login and interactive shells and by every vm_exec command. */
export const VM_ENV_FILE = "/home/user/.config/dex/env"

/**
 * Secrets you save once in Settings (API keys for CLIs and services) that every chat's VM gets as environment
 * variables. Values are write-only: never sent to the browser or shown to a chat, masked in VM output.
 */
export class AccountSecrets {
  private cache: Map<string, string> | null = null

  constructor(private readonly host: SecretHost & { publish: (secrets: Array<{ name: string; note: string; updatedAt: number }>) => void }) {
    host.sql.exec(`CREATE TABLE IF NOT EXISTS dex_account_secrets (
      name TEXT PRIMARY KEY, sealed TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
  }

  list() {
    return this.host.sql
      .exec<{ name: string; note: string; updated_at: number }>(`SELECT name, note, updated_at FROM dex_account_secrets ORDER BY name`)
      .toArray()
      .map((row) => ({ name: row.name, note: row.note, updatedAt: row.updated_at }))
  }

  refresh() {
    this.host.publish(this.list())
  }

  /** Changes on every save or delete, so VMs know to rewrite their env file. */
  version(): number {
    const row = this.host.sql.exec<{ value: string }>(`SELECT value FROM dex_meta WHERE key = 'account_secrets_version'`).toArray()[0]
    return Number(row?.value ?? 0)
  }

  private bump() {
    this.host.sql.exec(
      `INSERT INTO dex_meta (key, value) VALUES ('account_secrets_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      String(this.version() + 1)
    )
    this.cache = null
    this.refresh()
  }

  /** Saves a secret. A value is required for a new one; omitted, an existing one keeps its value (a note edit). */
  async save(name: string, value: string | undefined, note = "") {
    const key = name.trim().toUpperCase()
    if (!ENV_NAME.test(key)) throw new Error("Use an environment variable name: capital letters, digits, and underscores (e.g. MY_API_KEY).")
    if (RESERVED.test(key)) throw new Error(`${key} is reserved on VMs; pick another name.`)
    const existing = this.host.sql.exec<{ sealed: string }>(`SELECT sealed FROM dex_account_secrets WHERE name = ?`, key).toArray()[0]
    if (!value && !existing) throw new Error("Enter the secret's value.")
    if (value && value.length > 10_000) throw new Error("That value is too long (10,000 characters at most).")
    if (value?.includes("\n")) throw new Error("Values must be one line.")
    const now = Date.now()
    this.host.sql.exec(
      `INSERT INTO dex_account_secrets (name, sealed, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET sealed = excluded.sealed, note = excluded.note, updated_at = excluded.updated_at`,
      key, value ? await this.host.encrypt(value) : existing!.sealed, note.trim().slice(0, 200), now, now
    )
    this.bump()
    return key
  }

  remove(name: string) {
    const removed = this.host.sql.exec(`DELETE FROM dex_account_secrets WHERE name = ?`, name).rowsWritten > 0
    if (removed) this.bump()
    return removed
  }

  /** Decrypted values, for the VM env file and for masking. */
  async load(): Promise<ReadonlyMap<string, string>> {
    if (this.cache) return this.cache
    const values = new Map<string, string>()
    for (const row of this.host.sql.exec<{ name: string; sealed: string }>(`SELECT name, sealed FROM dex_account_secrets`).toArray()) {
      const value = await this.host.decrypt(row.sealed)
      if (value) values.set(row.name, value)
    }
    this.cache = values
    return values
  }

  /** The VM's env file: one `export NAME='value'` per secret. */
  async envFile() {
    const values = await this.load()
    return [...values].map(([name, value]) => `export ${name}=${shellQuote(value)}`).join("\n") + (values.size ? "\n" : "")
  }

  /** Text with any account secret value replaced by `$NAME`. Uses values loaded by `load`. */
  mask(text: string) {
    if (!this.cache?.size || !text) return text
    let masked = text
    for (const [name, value] of this.cache) if (value.length >= 4) masked = masked.split(value).join(`$${name}`)
    return masked
  }
}

/** Makes VM shells load the env file: login shells (~/.profile) and interactive ones (~/.bashrc). */
export const VM_ENV_HOOK = `chmod 600 ${VM_ENV_FILE}; for f in ~/.profile ~/.bashrc; do grep -qs 'config/dex/env' "$f" || echo '[ -f ~/.config/dex/env ] && . ~/.config/dex/env' >> "$f"; done`
