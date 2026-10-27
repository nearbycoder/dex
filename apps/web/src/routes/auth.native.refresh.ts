import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { viewerOrUnavailable } from "~/server/active-session"
import { refreshNativeToken } from "~/server/native-auth"
import { serverRuntime } from "~/server/runtime"

/** A native app renews its session token (see server/native-auth.ts). */
export const Route = createFileRoute("/auth/native/refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Apps send no Origin; a web page may not renew a session.
        const origin = request.headers.get("origin")
        if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Cross-origin requests are not allowed" }, { status: 403 })
        // "Sign in again" makes the apps forget their session, so it's only for a session that's really over.
        const viewer = await viewerOrUnavailable(request, env)
        if (viewer === "unavailable") return Response.json({ error: "Dex is restarting. Try again in a moment." }, { status: 503, headers: { "retry-after": "2" } })
        if (!viewer) return Response.json({ error: "Sign in again" }, { status: 401 })
        return serverRuntime(env).runPromise(refreshNativeToken(viewer))
      }
    }
  }
})
