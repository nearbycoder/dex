import { createFileRoute } from "@tanstack/react-router"
import { getAgentByName } from "agents"
import { env } from "cloudflare:workers"
import type { DexAgent } from "~/agent/dex-agent"
import { sessionUnavailable, viewerOrUnavailable } from "~/server/active-session"

const noStore = { "cache-control": "no-store" }

/**
 * Your sidekicks for the home-screen widgets on iPhone and Android: each one's picture, whether they've said
 * something you haven't seen, and their latest words, plus how many chats are unread. The apps' widgets call it
 * with the session cookie (no Origin), so they stay current without the app open.
 */
export const Route = createFileRoute("/api/sidekicks")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const viewer = await viewerOrUnavailable(request, env)
        if (viewer === "unavailable") return sessionUnavailable()
        if (!viewer) return Response.json({ error: "Sign in again" }, { status: 401, headers: noStore })
        const agent = await getAgentByName(env.DexAgent as unknown as DurableObjectNamespace<DexAgent>, viewer.id)
        try {
          // `images=0` leaves the pictures out, for a widget that already has them.
          const snapshot = await agent.widgetSnapshot()
          const images = new URL(request.url).searchParams.get("images") !== "0"
          return Response.json(images ? snapshot : { ...snapshot, sidekicks: snapshot.sidekicks.map(({ image: _image, ...rest }) => rest) }, { headers: noStore })
        } catch (cause) {
          // An agent still on the build from before this route: the sign-in check above restarts it, so ask again.
          console.error("Widget snapshot failed:", cause)
          return Response.json({ error: "Dex is updating. Try again in a moment." }, { status: 503, headers: { ...noStore, "retry-after": "2" } })
        }
      }
    }
  }
})
