import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { isSessionUserAllowed, isTokenCurrent, rateLimitKey, SessionCheckUnavailable } from "~/server/active-session"
import { exchangeNativeCode } from "~/server/native-auth"
import { serverRuntime } from "~/server/runtime"

const noStore = { "cache-control": "no-store" }

/** The native app trades its sign-in code and verifier for a session token (see server/native-auth.ts). */
export const Route = createFileRoute("/auth/native/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (request.headers.has("origin") || request.headers.has("sec-fetch-mode")) {
          return Response.json({ error: "Browser requests are not allowed" }, { status: 403, headers: noStore })
        }
        const { success } = await env.LOGIN_LIMITER.limit({ key: rateLimitKey(request, "native-token") })
        if (!success) return Response.json({ error: "Too many attempts. Wait a minute and try again." }, { status: 429, headers: noStore })
        return serverRuntime(env).runPromise(
          exchangeNativeCode(request, async (user, issuedAt) => {
            if (!isSessionUserAllowed(env, user)) return "revoked"
            try {
              return (await isTokenCurrent(env, user.id, issuedAt)) ? "ok" : "revoked"
            } catch (error) {
              if (error instanceof SessionCheckUnavailable) return "unavailable"
              throw error
            }
          })
        )
      }
    }
  }
})
