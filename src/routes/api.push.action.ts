import { createFileRoute } from "@tanstack/react-router"
import { getAgentByName } from "agents"
import { env } from "cloudflare:workers"
import { Option } from "effect"
import type { DexAgent } from "~/agent/dex-agent"
import { viewerFromRequest } from "~/server/auth"
import { serverRuntime } from "~/server/runtime"
import { BACKGROUND_ACTIONS, type BackgroundAction } from "~/shared/notifications"

/**
 * A notification's quick action (e.g. "Mute this chat"), sent by the service worker without opening Dex.
 * Same-origin only, and authenticated by the session cookie like the agent socket.
 */
export const Route = createFileRoute("/api/push/action")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin")
        if (origin && origin !== new URL(request.url).origin) return new Response("Cross-origin requests are not allowed", { status: 403 })
        const viewer = await serverRuntime(env).runPromise(viewerFromRequest(request))
        if (Option.isNone(viewer)) return new Response("Unauthorized", { status: 401 })
        const body = (await request.json().catch(() => null)) as { action?: unknown; sessionId?: unknown } | null
        const action = body?.action
        const sessionId = body?.sessionId
        if (!BACKGROUND_ACTIONS.includes(action as BackgroundAction) || typeof sessionId !== "string" || sessionId.length > 64) {
          return new Response("Bad request", { status: 400 })
        }
        const agent = await getAgentByName(env.DexAgent as unknown as DurableObjectNamespace<DexAgent>, viewer.value.id)
        await agent.pushAction(action as BackgroundAction, sessionId)
        return new Response(null, { status: 204 })
      }
    }
  }
})
