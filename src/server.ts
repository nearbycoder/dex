import handler from "@tanstack/react-start/server-entry"
import { routeAgentRequest } from "agents"
import { Option } from "effect"
import { viewerFromRequest } from "./server/auth"
import { serverRuntime } from "./server/runtime"

export { DexAgent } from "./agent/dex-agent"

const sameOrigin = (origin: string, request: Request) => {
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    // e.g. `Origin: null` from a sandboxed frame or a file.
    return false
  }
}

/** Agent requests need a session cookie for the same user the instance belongs to. */
const authorizeAgent = (env: Env) => async (request: Request, route: { name: string }) => {
  const origin = request.headers.get("origin")
  if (origin && !sameOrigin(origin, request)) {
    return new Response("Cross-origin agent requests are not allowed", { status: 403 })
  }
  const viewer = await serverRuntime(env).runPromise(viewerFromRequest(request))
  if (Option.isNone(viewer)) return new Response("Unauthorized", { status: 401 })
  if (viewer.value.id !== route.name) return new Response("Forbidden", { status: 403 })
}

/**
 * Images may only come from Dex itself (and GitHub avatars): a prompt-injected model could otherwise
 * leak chat content by rendering an image whose URL carries it. Dex is never framed by other sites.
 * Scripts and styles aren't restricted: TanStack Start inlines its hydration scripts.
 */
const CONTENT_SECURITY_POLICY = [
  "img-src 'self' data: blob: https://avatars.githubusercontent.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join("; ")

const withSecurityHeaders = (response: Response, request: Request) => {
  // WebSocket upgrades and the like can't be copied.
  if (response.status === 101 || response.webSocket) return response
  const secured = new Response(response.body, response)
  secured.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY)
  secured.headers.set("X-Content-Type-Options", "nosniff")
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
  if (new URL(request.url).protocol === "https:") secured.headers.set("Strict-Transport-Security", "max-age=31536000")
  return secured
}

export default {
  async fetch(request, env) {
    // Agent sockets live at /agents/<class>/<instance>. Other /agents/* paths (the Agents pages, e.g.
    // /agents/pr-reviewer) don't match the SDK's two-segment route and fall through to the app.
    if (new URL(request.url).pathname.startsWith("/agents/")) {
      const authorize = authorizeAgent(env)
      const response = await routeAgentRequest(request, env, { onBeforeConnect: authorize, onBeforeRequest: authorize })
      if (response) return response
    }
    return withSecurityHeaders(await handler.fetch(request), request)
  }
} satisfies ExportedHandler<Env>
