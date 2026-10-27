import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { sessionUnavailable, viewerOrUnavailable } from "~/server/active-session"

/**
 * The build this Worker is running, so an open app (a Home Screen app can stay open for days) can tell a deploy
 * has landed and offer a refresh. The sign-in check also restarts an agent still on older code.
 */
export const Route = createFileRoute("/api/version")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // The Android app asks this whether its session still works: only a real "no" may be a 401.
        const viewer = await viewerOrUnavailable(request, env)
        if (viewer === "unavailable") return sessionUnavailable()
        if (!viewer) return new Response("Unauthorized", { status: 401 })
        return Response.json({ build: __DEX_BUILD__ }, { headers: { "cache-control": "no-store" } })
      }
    }
  }
})
