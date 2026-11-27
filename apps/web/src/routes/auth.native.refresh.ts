import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { viewerOrUnavailable } from "~/server/active-session"
import { refreshNativeToken } from "~/server/native-auth"
import { serverRuntime } from "~/server/runtime"

const noStore = { "cache-control": "no-store" }

/** A native app renews its session token (see server/native-auth.ts). */
export const Route = createFileRoute("/auth/native/refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Native apps send neither Origin nor Sec-Fetch-Mode; reject browser requests so same-origin script
        // cannot turn an HttpOnly dex_session cookie into a raw 30-day token in JSON.
        if (request.headers.has("origin") || request.headers.has("sec-fetch-mode")) {
          return Response.json({ error: "Browser requests are not allowed" }, { status: 403, headers: noStore })
        }
        // "Sign in again" makes the apps forget their session, so it's only for a session that's really over.
        const viewer = await viewerOrUnavailable(request, env)
        if (viewer === "unavailable") return Response.json({ error: "Dex is restarting. Try again in a moment." }, { status: 503, headers: { ...noStore, "retry-after": "2" } })
        if (!viewer) return Response.json({ error: "Sign in again" }, { status: 401, headers: noStore })
        return serverRuntime(env).runPromise(refreshNativeToken(viewer))
      }
    }
  }
})
