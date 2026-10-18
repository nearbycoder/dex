/** How Dex authenticates to an MCP server. */
export type McpAuth = "none" | "headers" | "oauth"

export type McpTransport = "auto" | "streamable-http" | "sse"

/** The connection's state, as the Agents SDK reports it, or `disconnected` when it holds no connection. */
export type McpStatus = "connecting" | "authenticating" | "connected" | "discovering" | "ready" | "failed" | "disconnected"

export interface McpToolInfo {
  readonly name: string
  readonly description: string
}

/** A connected (or connecting) MCP server, as the UI sees it. Header values never leave the agent. */
export interface McpServerInfo {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly transport: McpTransport
  readonly auth: McpAuth
  /** Names of the headers sent with every request, e.g. `Authorization`. */
  readonly headerNames: ReadonlyArray<string>
  /** A local (stdio) server Dex runs on the MCP VM: its command and the names of its environment variables. */
  readonly local: { readonly command: string; readonly envNames: ReadonlyArray<string> } | null
  /** Attached to new chats that don't use an agent. */
  readonly defaultOn: boolean
  /** Tool names in chats are `<prefix>__<tool>`. */
  readonly prefix: string
  readonly status: McpStatus
  readonly error: string | null
  readonly tools: ReadonlyArray<McpToolInfo>
  readonly createdAt: number
  readonly updatedAt: number
}

export interface McpServerDraft {
  readonly id?: string
  readonly name: string
  readonly url: string
  readonly transport: McpTransport
  readonly auth: McpAuth
  /** For `headers` auth. An empty value keeps the header's saved value. */
  readonly headers?: ReadonlyArray<{ readonly name: string; readonly value: string }>
  /**
   * Run it on the MCP VM instead of connecting to a URL: the command that starts a stdio server (e.g.
   * `npx -y @modelcontextprotocol/server-everything`), and environment variables for it. An empty value keeps the
   * saved one. Saved secrets (Settings → Secrets) are available too.
   */
  readonly local?: { readonly command: string; readonly env?: ReadonlyArray<{ readonly name: string; readonly value: string }> }
  readonly defaultOn: boolean
}

/** `authUrl`: send the user there to sign in; the server is ready once they come back. */
export type McpConnectResult =
  | { readonly ok: true; readonly id: string; readonly authUrl?: string }
  | { readonly ok: false; readonly id?: string; readonly error: string }

export const MCP_STATUS_LABEL: Record<McpStatus, string> = {
  connecting: "Connecting",
  authenticating: "Needs sign-in",
  connected: "Connecting",
  discovering: "Loading tools",
  ready: "Ready",
  failed: "Failed",
  disconnected: "Not connected"
}
