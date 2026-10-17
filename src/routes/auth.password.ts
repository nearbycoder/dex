import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { passwordLogin } from "~/server/auth"
import { serverRuntime } from "~/server/runtime"

export const Route = createFileRoute("/auth/password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { success } = await env.LOGIN_LIMITER.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" })
        if (!success) {
          return new Response(null, { status: 302, headers: { location: `/login?error=${encodeURIComponent("Too many attempts. Wait a minute and try again.")}` } })
        }
        return serverRuntime(env).runPromise(passwordLogin(request))
      }
    }
  }
})
