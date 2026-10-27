import { getAgentByName } from "agents"
import { Option } from "effect"
import type { DexAgent } from "~/agent/dex-agent"
import { viewerFromRequest } from "./auth"
import { readCookie } from "./cookies"
import { serverRuntime } from "./runtime"
import { SESSION_COOKIE, type SessionUser, tokenIssuedAt } from "./session"

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

/**
 * The signed-in user if their session cookie is valid and hasn't been revoked; null if not. "Sign out everywhere"
 * (Settings) records a time in the user's agent; sessions issued before it stop working on every device. When the
 * agent can't answer even after a couple of tries, throws SessionCheckUnavailable (no access either way).
 */
export async function checkViewer(request: Request, env: Env): Promise<SessionUser | null> {
  const viewer = await serverRuntime(env).runPromise(viewerFromRequest(request))
  if (Option.isNone(viewer)) return null
  const issuedAt = tokenIssuedAt(readCookie(request.headers.get("cookie"), SESSION_COOKIE) ?? "")
  let lastError: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]))
    try {
      // A fresh stub each try: one whose instance reset can't be used again.
      const agent = await getAgentByName(env.DexAgent as unknown as DurableObjectNamespace<DexAgent>, viewer.value.id)
      // With this Worker's build: an agent left running older code since a deploy restarts onto this one.
      return (await agent.isSessionCurrent(issuedAt, __DEX_BUILD__)) ? viewer.value : null
    } catch (error) {
      lastError = error
    }
  }
  const unavailable = new SessionCheckUnavailable(lastError)
  console.error(unavailable.message)
  throw unavailable
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
