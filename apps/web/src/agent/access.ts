import { Value } from "typebox/value"
import type { AccessRisk, AccessState, AccessToken, AuditEntry, CreatedAccessToken, PendingAction, UiOperationResult } from "~/shared/access"
import { riskRank } from "~/shared/access"
import type { DexState } from "~/shared/protocol"
import { type Caller, type Operation, type OperationHost, operationByName, riskOf } from "./operations"

const TOKEN_PREFIX = "dexk"
/** A chat's request for an admin operation waits this long for the user. */
const PENDING_TTL_MS = 60 * 60_000
const MAX_RESULT_CHARS = 60_000
const MAX_UI_RESULT_CHARS = 500_000

/** Per caller, per window: generous for real work, small enough to stop a loop or a leaked token from running away. */
const LIMITS = {
  mcpPerMinute: 120,
  chatCallsPerMinute: 60,
  /** A chat's generated UI: its live views refetch on their own and every card in the chat loads its data. */
  uiCallsPerMinute: 120,
  chatSessionsPerHour: 20,
  chatMessagesPerHour: 60
}

interface TokenRow {
  id: string
  label: string
  hash: string
  scope: string
  created_at: number
  last_used_at: number | null
  expires_at: number | null
  [key: string]: SqlStorageValue
}

interface AuditRow {
  id: number
  at: number
  actor: string
  actor_ref: string
  actor_label: string
  operation: string
  summary: string
  ok: number
  error: string | null
  [key: string]: SqlStorageValue
}

interface PendingRow {
  id: string
  session_id: string
  operation: string
  args: string
  summary: string
  created_at: number
  status: string
  result: string | null
  [key: string]: SqlStorageValue
}

export interface AccessHost {
  readonly sql: SqlStorage
  readonly operations: OperationHost
  state(): DexState
  publish(access: AccessState): void
  /** HMAC with the deployment's key, so the Worker can reject forged tokens before waking any agent. */
  sign(payload: string): Promise<string>
  /** Tells a chat what became of the admin operation it asked for (a message in that chat). */
  tellChat(sessionId: string, text: string): Promise<void>
}

/** The outcome of an operation, ready for a tool result. */
export type OperationOutcome =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: string }
  | { readonly ok: "pending"; readonly pending: PendingAction }

export class AccessError extends Error {}

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
const sha256 = async (text: string) => toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
export const encodeUserId = (userId: string) => base64url(new TextEncoder().encode(userId))

/** `dexk.<user>.<random>.<tag>`: who it's for, and an HMAC over both. */
export const parseAccessToken = (token: string) => {
  const [prefix, user, random, tag, ...rest] = token.split(".")
  if (prefix !== TOKEN_PREFIX || !user || !random || !tag || rest.length) return null
  try {
    const userId = new TextDecoder().decode(Uint8Array.from(atob(user.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0)))
    return { userId, signed: `${TOKEN_PREFIX}.${user}.${random}`, tag }
  } catch {
    return null
  }
}

export const stringifyResult = (result: unknown) => {
  const text = typeof result === "string" ? result : (JSON.stringify(result, null, 2) ?? "Done.")
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n… (truncated)` : text
}

/** Validation errors in a model-friendly form: one per field, with the allowed values for enums. */
const describeErrors = (operation: Operation, args: unknown) => {
  const properties = (operation.parameters as { properties?: Record<string, { anyOf?: Array<{ const?: unknown }> }> }).properties ?? {}
  const seen = new Map<string, string>()
  for (const error of Value.Errors(operation.parameters, args)) {
    const path = error.instancePath || "arguments"
    if (seen.has(path)) continue
    const field = properties[path.replace(/^\//, "")]
    const choices = field?.anyOf?.every((option) => option.const !== undefined) ? field.anyOf.map((option) => JSON.stringify(option.const)) : null
    seen.set(path, `${path} ${choices ? `must be one of ${choices.join(", ")}` : error.message}`)
    if (seen.size >= 6) break
  }
  return [...seen.values()].join("; ")
}

const toToken = (row: TokenRow): AccessToken => ({
  id: row.id,
  label: row.label,
  scope: row.scope as AccessRisk,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
  expiresAt: row.expires_at
})

const toAudit = (row: AuditRow): AuditEntry => ({
  id: row.id,
  at: row.at,
  actor: row.actor as AuditEntry["actor"],
  actorLabel: row.actor_label,
  operation: row.operation,
  summary: row.summary,
  ok: row.ok === 1,
  error: row.error
})

const toPending = (row: PendingRow): PendingAction => ({
  id: row.id,
  sessionId: row.session_id,
  operation: row.operation,
  summary: row.summary,
  createdAt: row.created_at,
  status: row.status === "pending" && Date.now() - row.created_at > PENDING_TTL_MS ? "expired" : (row.status as PendingAction["status"]),
  result: row.result
})

/**
 * Who may run which operations, and the record of what ran. Chats run read and write operations directly and
 * ask the user to confirm admin ones; MCP callers are limited by their token's scope. Everything is validated,
 * rate-limited, and written to the audit log shown on the Access page.
 */
export class AccessCenter {
  /** Recent calls from each chat's generated UI (its reads aren't audited, so they're counted here). */
  private readonly uiCalls = new Map<string, number[]>()

  constructor(private readonly host: AccessHost) {
    host.sql.exec(`CREATE TABLE IF NOT EXISTS dex_access_tokens (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, scope TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_used_at INTEGER, expires_at INTEGER)`)
    host.sql.exec(`CREATE TABLE IF NOT EXISTS dex_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, actor_ref TEXT NOT NULL,
      actor_label TEXT NOT NULL, operation TEXT NOT NULL, summary TEXT NOT NULL, ok INTEGER NOT NULL, error TEXT)`)
    host.sql.exec(`CREATE INDEX IF NOT EXISTS dex_audit_actor ON dex_audit (actor_ref, at)`)
    host.sql.exec(`CREATE TABLE IF NOT EXISTS dex_pending (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, operation TEXT NOT NULL, args TEXT NOT NULL, summary TEXT NOT NULL,
      created_at INTEGER NOT NULL, status TEXT NOT NULL, result TEXT)`)
  }

  status(): AccessState {
    const sql = this.host.sql
    return {
      tokens: sql.exec<TokenRow>(`SELECT * FROM dex_access_tokens ORDER BY created_at DESC`).toArray().map(toToken),
      audit: sql.exec<AuditRow>(`SELECT * FROM dex_audit ORDER BY id DESC LIMIT 60`).toArray().map(toAudit),
      pending: sql.exec<PendingRow>(`SELECT * FROM dex_pending ORDER BY created_at DESC LIMIT 30`).toArray().map(toPending)
    }
  }

  private refresh() {
    this.host.publish(this.status())
  }

  // ── Tokens ────────────────────────────────────────────────────────────────

  async createToken(userId: string, label: string, scope: AccessRisk, days: number | null): Promise<CreatedAccessToken> {
    if (riskRank(scope) < 0) throw new AccessError("Unknown scope.")
    const name = String(label ?? "").trim().slice(0, 60)
    if (!name) throw new AccessError("Name the token after the agent that will use it.")
    const random = base64url(crypto.getRandomValues(new Uint8Array(32)))
    const signed = `${TOKEN_PREFIX}.${encodeUserId(userId)}.${random}`
    const secret = `${signed}.${await this.host.sign(signed)}`
    const now = Date.now()
    const id = crypto.randomUUID().slice(0, 8)
    const expiresAt = days && days > 0 ? now + Math.min(days, 365) * 86_400_000 : null
    this.host.sql.exec(
      `INSERT INTO dex_access_tokens (id, label, hash, scope, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
      id, name, await sha256(secret), scope, now, expiresAt
    )
    this.refresh()
    return { token: toToken(this.host.sql.exec<TokenRow>(`SELECT * FROM dex_access_tokens WHERE id = ?`, id).one()), secret }
  }

  revokeToken(id: string) {
    this.host.sql.exec(`DELETE FROM dex_access_tokens WHERE id = ?`, id)
    this.refresh()
  }

  /** The token's record if it is current; the Worker has already checked its signature. */
  async authenticate(secret: string): Promise<AccessToken | null> {
    const row = this.host.sql.exec<TokenRow>(`SELECT * FROM dex_access_tokens WHERE hash = ?`, await sha256(secret)).toArray()[0]
    if (!row || (row.expires_at && row.expires_at < Date.now())) return null
    if (!row.last_used_at || Date.now() - row.last_used_at > 60_000) {
      this.host.sql.exec(`UPDATE dex_access_tokens SET last_used_at = ? WHERE id = ?`, Date.now(), row.id)
      this.refresh()
    }
    return toToken(row)
  }

  // ── Running operations ────────────────────────────────────────────────────

  /** Operations a caller may see: chats get everything without a native equivalent; tokens what their scope allows. */
  available(caller: Caller, scope?: AccessRisk): Operation[] {
    return [...operationByName.values()].filter((operation) => {
      if (caller.kind === "chat") return operation.inChats !== false
      if (!scope) return false
      // Arguments decide some risks; show those if the scope allows the lowest one.
      const lowest = typeof operation.risk === "function" ? "write" : operation.risk
      return riskRank(lowest) <= riskRank(scope)
    })
  }

  private recent(actorRef: string, ms: number, operation?: string) {
    return this.host.sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM dex_audit WHERE actor_ref = ? AND at > ? ${operation ? "AND operation = ?" : ""}`,
        ...[actorRef, Date.now() - ms, ...(operation ? [operation] : [])]
      )
      .one().count
  }

  private chatsRecently(ms: number, operation: string) {
    return this.host.sql
      .exec<{ count: number }>(`SELECT COUNT(*) AS count FROM dex_audit WHERE actor = 'chat' AND operation = ? AND at > ?`, operation, Date.now() - ms)
      .one().count
  }

  private audit(caller: Caller, operation: string, summary: string, error: string | null) {
    const state = this.host.state()
    const [actor, ref, label] =
      caller.kind === "mcp"
        ? ["mcp", `mcp:${caller.tokenId}`, caller.label]
        : [caller.kind, `${caller.kind === "ui" ? "ui" : "chat"}:${caller.sessionId}`, state.sessions.find((session) => session.id === caller.sessionId)?.title ?? `chat ${caller.sessionId}`]
    this.host.sql.exec(
      `INSERT INTO dex_audit (at, actor, actor_ref, actor_label, operation, summary, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      Date.now(), actor, ref, label.slice(0, 120), operation, summary.slice(0, 300), error ? 0 : 1, error?.slice(0, 500) ?? null
    )
    this.host.sql.exec(`DELETE FROM dex_audit WHERE id <= (SELECT id FROM dex_audit ORDER BY id DESC LIMIT 1 OFFSET 2000)`)
  }

  private summarize(operation: Operation, args: unknown) {
    try {
      return operation.summarize(args as never, this.host.state())
    } catch {
      return operation.name
    }
  }

  /**
   * Runs an operation for a caller: validates the arguments, enforces risk and rate limits, and audits it.
   * `scope` is the MCP token's. A chat asking for an admin operation gets a pending confirmation instead.
   */
  async execute(name: string, rawArgs: unknown, caller: Caller, scope?: AccessRisk): Promise<OperationOutcome> {
    const operation = operationByName.get(name)
    if (!operation || (caller.kind === "chat" && operation.inChats === false)) return { ok: false, error: `Unknown operation ${name}.` }
    const args = rawArgs ?? {}
    if (!Value.Check(operation.parameters, args)) return { ok: false, error: `Invalid arguments for ${name}: ${describeErrors(operation, args)}` }
    const risk = riskOf(operation, args)
    const summary = this.summarize(operation, args)

    const refused = (error: string): OperationOutcome => {
      this.audit(caller, name, summary, error)
      this.refresh()
      return { ok: false, error }
    }
    if (caller.kind === "mcp") {
      if (riskRank(risk) > riskRank(scope ?? "read")) return refused(`This token can't ${risk === "admin" ? "delete or change settings" : "make changes"}; it needs ${risk} access.`)
      if (this.recent(`mcp:${caller.tokenId}`, 60_000) >= LIMITS.mcpPerMinute) return refused("Too many requests; slow down.")
    }
    if (caller.kind === "chat") {
      if (this.recent(`chat:${caller.sessionId}`, 60_000) >= LIMITS.chatCallsPerMinute) return refused("Too many app operations from this chat; slow down.")
      if (name === "app_create_session" && this.chatsRecently(3_600_000, name) >= LIMITS.chatSessionsPerHour) {
        return refused(`Chats have started ${LIMITS.chatSessionsPerHour} chats in the last hour; ask the user before starting more.`)
      }
      if (name === "app_send_message" && this.chatsRecently(3_600_000, name) >= LIMITS.chatMessagesPerHour) {
        return refused("Chats have sent too many messages to other chats in the last hour.")
      }
      if (risk === "admin") return this.requestConfirmation(caller.sessionId, operation, args, summary)
    }
    return this.run(operation, args, caller, summary)
  }

  /**
   * Runs an operation for a chat's generated UI: a Query (live data, which runs on its own, so it may only read) or
   * a Mutation (a button you pressed). Write operations run like a chat's; admin ones first come back as `confirm`
   * with Dex's own summary of what they do (not the model's button label) and run once you've confirmed it.
   * Reads aren't audited: a live view refreshing every 30 seconds would bury everything else.
   */
  async runFromUi(sessionId: string, name: string, rawArgs: unknown, options: { readonly query: boolean; readonly confirmed: boolean }): Promise<UiOperationResult> {
    const operation = operationByName.get(name)
    if (!operation || operation.inChats === false) return { ok: false, error: `Unknown operation ${name}.` }
    // A UI passes `null` for a filter that isn't set (a $variable with no value); operations want the field left out.
    const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? Object.fromEntries(Object.entries(rawArgs).filter(([, value]) => value !== null)) : (rawArgs ?? {})
    if (!Value.Check(operation.parameters, args)) return { ok: false, error: `Invalid arguments for ${name}: ${describeErrors(operation, args)}` }
    const now = Date.now()
    const recent = (this.uiCalls.get(sessionId) ?? []).filter((at) => now - at < 60_000)
    if (recent.length >= LIMITS.uiCallsPerMinute) return { ok: false, error: "Too many requests from this chat's UI; slow down." }
    this.uiCalls.set(sessionId, [...recent, now])

    const risk = riskOf(operation, args)
    const summary = this.summarize(operation, args)
    if (options.query && risk !== "read") return { ok: false, error: `${name} changes things, so it runs only from a button (Mutation), not as live data (Query).` }
    if (risk === "admin" && !options.confirmed) return { ok: "confirm", summary }
    const caller: Caller = { kind: "ui", sessionId }
    const outcome = await this.run(operation, args, caller, summary, risk !== "read")
    if (outcome.ok !== true) return { ok: false, error: outcome.ok === false ? outcome.error : "Not run." }
    // It goes back over the app's WebSocket, whose messages are limited to 1 MB.
    if ((JSON.stringify(outcome.result) ?? "").length > MAX_UI_RESULT_CHARS) return { ok: false, error: `${name} returned too much to show here; ask for less.` }
    return outcome
  }

  private async run(operation: Operation, args: unknown, caller: Caller, summary: string, audited = true): Promise<OperationOutcome> {
    try {
      const result = await operation.run(this.host.operations, args as never, caller)
      if (audited) this.audit(caller, operation.name, summary, null)
      return { ok: true, result }
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause)
      if (audited) this.audit(caller, operation.name, summary, error)
      return { ok: false, error }
    } finally {
      if (audited) this.refresh()
    }
  }

  // ── Confirmations ─────────────────────────────────────────────────────────

  private requestConfirmation(sessionId: string, operation: Operation, args: unknown, summary: string): OperationOutcome {
    const id = crypto.randomUUID()
    this.host.sql.exec(
      `INSERT INTO dex_pending (id, session_id, operation, args, summary, created_at, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      id, sessionId, operation.name, JSON.stringify(args), summary, Date.now()
    )
    this.host.sql.exec(`DELETE FROM dex_pending WHERE created_at < ?`, Date.now() - 7 * 86_400_000)
    this.refresh()
    return { ok: "pending", pending: toPending(this.host.sql.exec<PendingRow>(`SELECT * FROM dex_pending WHERE id = ?`, id).one()) }
  }

  /** The user's answer to a chat's request (only reachable from the signed-in app). */
  async resolve(id: string, approve: boolean) {
    const row = this.host.sql.exec<PendingRow>(`SELECT * FROM dex_pending WHERE id = ?`, id).toArray()[0]
    if (!row) throw new AccessError("That request is gone.")
    const pending = toPending(row)
    if (pending.status !== "pending") throw new AccessError(`That request was already ${pending.status}.`)
    const operation = operationByName.get(row.operation)
    if (!operation) throw new AccessError("That operation no longer exists.")
    const caller: Caller = { kind: "user", sessionId: row.session_id }
    if (!approve) {
      this.host.sql.exec(`UPDATE dex_pending SET status = 'declined' WHERE id = ?`, id)
      this.audit(caller, row.operation, `Declined: ${row.summary}`, null)
      this.refresh()
      await this.host.tellChat(row.session_id, `[Declined] ${row.summary}. Don't retry unless I ask.`)
      return
    }
    // Claimed before running, so a double tap can't run it twice.
    this.host.sql.exec(`UPDATE dex_pending SET status = 'approved' WHERE id = ? AND status = 'pending'`, id)
    const outcome = await this.run(operation, JSON.parse(row.args), caller, row.summary)
    const result = outcome.ok === true ? stringifyResult(outcome.result).slice(0, 2_000) : outcome.ok === false ? outcome.error : ""
    this.host.sql.exec(`UPDATE dex_pending SET status = ?, result = ? WHERE id = ?`, outcome.ok === true ? "approved" : "failed", result, id)
    this.refresh()
    await this.host.tellChat(row.session_id, outcome.ok === true ? `[Confirmed] ${row.summary}. Result:\n${result}` : `[Confirmed, but it failed] ${row.summary}: ${result}`)
  }
}
