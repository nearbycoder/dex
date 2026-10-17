/**
 * Programmatic access to Dex: what chats (through their app tools) and external agents (through MCP) may do,
 * and the records that keep it accountable.
 */

/**
 * How much an operation can change. `read` looks; `write` creates, starts, sends, and stops things; `admin` deletes
 * or changes what future chats see (settings, existing agents and projects, MCP servers).
 */
export type AccessRisk = "read" | "write" | "admin"

export const ACCESS_RISKS: ReadonlyArray<{ readonly id: AccessRisk; readonly label: string; readonly description: string }> = [
  { id: "read", label: "Read", description: "See chats, agents, projects, machines, usage, and settings." },
  { id: "write", label: "Read & write", description: "Also start and message chats, create agents and projects, run commands on VMs." },
  { id: "admin", label: "Full", description: "Also delete things and change settings, existing agents and projects, and MCP servers." }
]

export const riskRank = (risk: AccessRisk) => ACCESS_RISKS.findIndex((entry) => entry.id === risk)

/** An MCP access token as the app sees it; the secret itself is shown once and stored only as a hash. */
export interface AccessToken {
  readonly id: string
  readonly label: string
  readonly scope: AccessRisk
  readonly createdAt: number
  readonly lastUsedAt: number | null
  readonly expiresAt: number | null
}

/** One operation run by a chat or an external agent, kept for review. */
export interface AuditEntry {
  readonly id: number
  readonly at: number
  readonly actor: "chat" | "mcp" | "user"
  /** The chat's title or the token's label. */
  readonly actorLabel: string
  readonly operation: string
  readonly summary: string
  readonly ok: boolean
  readonly error: string | null
}

/** An admin operation a chat asked for, waiting for you to confirm it in that chat. */
export interface PendingAction {
  readonly id: string
  readonly sessionId: string
  readonly operation: string
  readonly summary: string
  readonly createdAt: number
  readonly status: "pending" | "approved" | "declined" | "expired" | "failed"
  readonly result: string | null
}

export interface AccessState {
  readonly tokens: ReadonlyArray<AccessToken>
  readonly audit: ReadonlyArray<AuditEntry>
  readonly pending: ReadonlyArray<PendingAction>
}

export const NO_ACCESS: AccessState = { tokens: [], audit: [], pending: [] }

/** A created token: `secret` is shown to the user once. */
export interface CreatedAccessToken {
  readonly token: AccessToken
  readonly secret: string
}
