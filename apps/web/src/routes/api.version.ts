import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { activeViewer } from "~/server/active-session"

/**
 * The build this Worker is running, so an open app (a Home Screen app can stay open for days) can tell a deploy
 * has landed and offer a refresh. The sign-in check also restarts an agent still on older code.
 */
export const Route = createFileRoute("/api/version")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await activeViewer(request, env))) return new Response("Unauthorized", { status: 401 })
        return Response.json({ build: __DEX_BUILD__ }, { headers: { "cache-control": "no-store" } })
      }
    }
  }
})
