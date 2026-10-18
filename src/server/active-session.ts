import { getAgentByName } from "agents"
import { Option } from "effect"
import type { DexAgent } from "~/agent/dex-agent"
import { viewerFromRequest } from "./auth"
import { readCookie } from "./cookies"
import { serverRuntime } from "./runtime"
import { SESSION_COOKIE, type SessionUser, tokenIssuedAt } from "./session"

/**
 * The signed-in user if their session cookie is valid and hasn't been revoked. "Sign out everywhere" (Settings)
 * records a time in the user's agent; sessions issued before it stop working on every device. Fails closed.
 */
export async function activeViewer(request: Request, env: Env): Promise<SessionUser | null> {
  const viewer = await serverRuntime(env).runPromise(viewerFromRequest(request))
  if (Option.isNone(viewer)) return null
  try {
    const issuedAt = tokenIssuedAt(readCookie(request.headers.get("cookie"), SESSION_COOKIE) ?? "")
    const agent = await getAgentByName(env.DexAgent as unknown as DurableObjectNamespace<DexAgent>, viewer.value.id)
    return (await agent.isSessionCurrent(issuedAt)) ? viewer.value : null
  } catch (error) {
    console.error("Session check failed:", error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    return null
  }
}
