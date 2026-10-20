import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { exchangeNativeCode } from "~/server/native-auth"
import { serverRuntime } from "~/server/runtime"

/** The native app trades its sign-in code and verifier for a session token (see server/native-auth.ts). */
export const Route = createFileRoute("/auth/native/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { success } = await env.LOGIN_LIMITER.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" })
        if (!success) return Response.json({ error: "Too many attempts. Wait a minute and try again." }, { status: 429 })
        return serverRuntime(env).runPromise(exchangeNativeCode(request))
      }
    }
  }
})
