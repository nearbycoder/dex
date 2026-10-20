import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { activeViewer } from "~/server/active-session"
import { confirmNativeSignIn, finishNativeSignIn } from "~/server/native-auth"
import { serverRuntime } from "~/server/runtime"

const signInFirst = () => new Response(null, { status: 302, headers: { location: "/login" } })

/** Asks, then sends the native app its sign-in code (see server/native-auth.ts). */
export const Route = createFileRoute("/auth/native/finish")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const viewer = await activeViewer(request, env)
        return viewer ? confirmNativeSignIn(request, viewer) : signInFirst()
      },
      POST: async ({ request }) => {
        // Only the confirmation page above may post here.
        const origin = request.headers.get("origin")
        if (origin !== new URL(request.url).origin) return new Response("Cross-origin sign-in is not allowed", { status: 403 })
        const viewer = await activeViewer(request, env)
        return viewer ? serverRuntime(env).runPromise(finishNativeSignIn(request, viewer)) : signInFirst()
      }
    }
  }
})
