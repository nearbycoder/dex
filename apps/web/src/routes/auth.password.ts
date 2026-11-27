import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { rateLimitKey } from "~/server/active-session"
import { passwordLogin } from "~/server/auth"
import { serverRuntime } from "~/server/runtime"

export const Route = createFileRoute("/auth/password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Only Dex's own login form may post here.
        if (request.headers.get("origin") !== new URL(request.url).origin) {
          return new Response("Cross-origin sign-in is not allowed", { status: 403, headers: { "cache-control": "no-store" } })
        }
        const [perIp, globalCap] = await Promise.all([
          env.LOGIN_LIMITER.limit({ key: rateLimitKey(request, "password") }),
          env.LOGIN_LIMITER.limit({ key: "password:global" })
        ])
        if (!perIp.success || !globalCap.success) {
          return new Response(null, {
            status: 302,
            headers: {
              location: `/login?error=${encodeURIComponent("Too many attempts. Wait a minute and try again.")}`,
              "cache-control": "no-store"
            }
          })
        }
        return serverRuntime(env).runPromise(passwordLogin(request))
      }
    }
  }
})
