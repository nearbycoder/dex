import handler from "@tanstack/react-start/server-entry"
import { routeAgentRequest } from "agents"
import { Option } from "effect"
import { viewerFromRequest } from "./server/auth"
import { serverRuntime } from "./server/runtime"

export { DexAgent } from "./agent/dex-agent"

/** Agent requests need a session cookie for the same user the instance belongs to. */
const authorizeAgent = (env: Env) => async (request: Request, route: { name: string }) => {
  const origin = request.headers.get("origin")
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return new Response("Cross-origin agent requests are not allowed", { status: 403 })
  }
  const viewer = await serverRuntime(env).runPromise(viewerFromRequest(request))
  if (Option.isNone(viewer)) return new Response("Unauthorized", { status: 401 })
  if (viewer.value.id !== route.name) return new Response("Forbidden", { status: 403 })
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
    return handler.fetch(request)
  }
} satisfies ExportedHandler<Env>
