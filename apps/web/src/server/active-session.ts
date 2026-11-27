import type { DexAgent } from "~/agent/dex-agent"
import { readCookie } from "./cookies"
import { SESSION_COOKIE, type SessionUser, verifySessionTokenFast } from "./session"

/**
 * The session couldn't be checked right now (the agent was restarting onto a new deploy, or unreachable). Not the
 * same as signed out: the native apps forget their session on a 401, so this must never become one.
 */
export class SessionCheckUnavailable extends Error {
  constructor(cause: unknown) {
    super(`Session check failed: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`)
  }
}

/** Waits between tries: an agent restarting onto a new deploy (restartIfOutdated) is back within about a second. */
const RETRY_DELAYS_MS = [300, 900]

const parseAllowedUsers = (env: Env): string[] =>
  (env.ALLOWED_GITHUB_USERS ?? "")
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean)

const isDevLoginEnabled = (env: Env): boolean => {
  const raw = (env as unknown as Record<string, unknown>).DEV_LOGIN
  return raw === true || String(raw ?? "").trim().toLowerCase() === "true"
}

/**
 * Whether a user id (`dev` or `user-<login>`) is currently permitted by deployment config. Re-checked on every
 * request so removing a user from ALLOWED_GITHUB_USERS or turning off DEV_LOGIN takes effect immediately on active
 * web sessions, native sessions, refreshes, and MCP tokens.
 */
export function isUserIdAllowed(env: Env, userId: string): boolean {
  if (userId === "dev") return isDevLoginEnabled(env)
  if (!userId.startsWith("user-")) return false
  const login = userId.slice("user-".length).toLowerCase()
  const allowed = parseAllowedUsers(env)
  if (allowed.includes(login)) return true
  const hasOwnerPassword = Boolean((env as unknown as Record<string, unknown>).OWNER_PASSWORD)
  return allowed.length === 0 && hasOwnerPassword && login === "owner"
}

/** Whether a verified SessionUser is currently permitted by deployment config. */
export function isSessionUserAllowed(env: Env, user: SessionUser): boolean {
  if (user.id === "dev") return user.login === "dev" && isDevLoginEnabled(env)
  return user.id === `user-${user.login.toLowerCase()}` && isUserIdAllowed(env, user.id)
}

/** Normalize rate-limit keys: prefix by endpoint and group IPv6 addresses by /64 prefix. */
export function rateLimitKey(request: Request, scope: string): string {
  const ip = request.headers.get("cf-connecting-ip")?.trim() || "unknown"
  if (ip.includes(":")) {
    const groups = ip.split(":").slice(0, 4).join(":")
    return `${scope}:v6:${groups}`
  }
  return `${scope}:${ip}`
}

/** Read a request body as UTF-8 text while enforcing a strict byte limit even on chunked transfers. */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string | "too-large"> {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maxBytes) return "too-large"
  if (!request.body) return ""
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return "too-large"
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

/** Check directly against the user's DexAgent whether a token issued at `issuedAt` (seconds) is still current. */
export async function isTokenCurrent(env: Env, userId: string, issuedAt: number): Promise<boolean> {
  const ns = env.DexAgent as unknown as DurableObjectNamespace<DexAgent>
  let lastError: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]))
    try {
      // Direct DO stub skips agents' extra setName/onStart RPC on every auth check; isSessionCurrent only reads
      // dex_meta and triggers restartIfOutdated if the DO is running an older deploy.
      const agent = ns.get(ns.idFromName(userId))
      return await agent.isSessionCurrent(issuedAt, __DEX_BUILD__)
    } catch (error) {
      lastError = error
    }
  }
  const unavailable = new SessionCheckUnavailable(lastError)
  console.error(unavailable.message)
  throw unavailable
}

/**
 * The signed-in user if their session cookie is valid, allowed by current config, and hasn't been revoked; null if
 * not. "Sign out everywhere" (Settings) records a time in the user's agent; sessions issued before it stop working
 * on every device. When the agent can't answer even after a couple of tries, throws SessionCheckUnavailable.
 */
export async function checkViewer(request: Request, env: Env): Promise<SessionUser | null> {
  const secret = String((env as unknown as Record<string, unknown>).AUTH_SECRET ?? "")
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE)
  const session = await verifySessionTokenFast(secret, token)
  if (!session) return null
  const { user, issuedAt } = session
  if (!isSessionUserAllowed(env, user)) return null
  return (await isTokenCurrent(env, user.id, issuedAt)) ? user : null
}

/** checkViewer with a check that couldn't run as `"unavailable"`, for callers that answer it with a 503. */
export const viewerOrUnavailable = (request: Request, env: Env): Promise<SessionUser | null | "unavailable"> =>
  checkViewer(request, env).catch((error: unknown) => {
    if (error instanceof SessionCheckUnavailable) return "unavailable" as const
    throw error
  })

/** checkViewer for callers that only need yes or no: a check that couldn't run counts as no. Fails closed. */
export async function activeViewer(request: Request, env: Env): Promise<SessionUser | null> {
  try {
    return await checkViewer(request, env)
  } catch {
    return null
  }
}

/** The response for a check that couldn't run: try again soon, and keep the session. */
export const sessionUnavailable = () =>
  new Response("Dex is restarting. Try again in a moment.", { status: 503, headers: { "retry-after": "2", "cache-control": "no-store" } })
