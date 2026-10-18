/**
 * Remote MCP servers from the official MCP Registry (registry.modelcontextprotocol.io), and the checks Dex runs on
 * one before you add it. The registry verifies who published an entry (its namespace) but nothing about the server
 * itself, so the checks look at the server directly: does it answer, how it signs in, what tools it has, and
 * the health of its source repo.
 */

export interface RegistryHeader {
  readonly name: string
  readonly description: string
  readonly required: boolean
  readonly secret: boolean
  /** A template like `Bearer {api_key}`, when the registry has one. */
  readonly value: string | null
}

export type RegistrySource = "smithery" | "registry"

export interface RegistryServer {
  /** Smithery (fast, with use counts; hosted endpoints that sign in through Smithery) or the official MCP Registry. */
  readonly source: RegistrySource
  /** The registry name, e.g. `io.github.owner/server` or `com.example/server`; Smithery's qualified name. */
  readonly name: string
  /** A readable name from the last part of `name`. */
  readonly title: string
  readonly description: string
  readonly version: string
  readonly repository: string | null
  /** Empty for Smithery results until checked (its endpoint comes from the server's details). */
  readonly url: string
  /** `stdio`: a package Dex runs on the MCP VM (see `run`). */
  readonly transport: "streamable-http" | "sse" | "stdio"
  /** For a package: the command that starts it, and the environment variables it reads. */
  readonly run: { readonly command: string; readonly env: ReadonlyArray<RegistryHeader> } | null
  /** Headers the server asks for (an API key, usually). */
  readonly headers: ReadonlyArray<RegistryHeader>
  /** The URL has `{placeholders}` to fill in (a tenant, a region). */
  readonly templated: boolean
  readonly updatedAt: string | null
  readonly status: string
  /** Smithery: how many people use it, and whether Smithery verified the publisher. */
  readonly uses: number | null
  readonly verified: boolean | null
}

export type CheckStatus = "pass" | "warn" | "fail" | "info"

export interface McpCheck {
  readonly id: string
  readonly label: string
  readonly status: CheckStatus
  readonly detail: string
}

export interface McpCheckReport {
  /** The endpoint that was checked (for Smithery, found during the check). */
  readonly url: string
  readonly checks: ReadonlyArray<McpCheck>
  /** How to connect it, from what the server answered: sign in with OAuth, send a header, or nothing. */
  readonly auth: "none" | "headers" | "oauth"
  readonly header: string | null
  readonly tools: ReadonlyArray<string>
  readonly checkedAt: number
}

/** `io.github.owner/my-server` → `My server`. */
export const registryTitle = (name: string) => {
  const last = name.split("/").pop() ?? name
  const words = last.replace(/[-_.]+/g, " ").trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : name
}

/** Who published it, from the namespace the registry verified: a GitHub account or a domain. */
export const registryPublisher = (name: string): { readonly kind: "github" | "domain" | "unknown"; readonly id: string } => {
  const namespace = name.split("/")[0] ?? ""
  if (namespace.startsWith("io.github.")) return { kind: "github", id: namespace.slice("io.github.".length) }
  const parts = namespace.split(".")
  if (parts.length >= 2) return { kind: "domain", id: parts.reverse().join(".") }
  return { kind: "unknown", id: namespace }
}
