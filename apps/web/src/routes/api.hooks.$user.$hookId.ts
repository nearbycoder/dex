import { createFileRoute } from "@tanstack/react-router"
import { getAgentByName } from "agents"
import { env } from "cloudflare:workers"
import type { DexAgent } from "~/agent/dex-agent"
import { isUserIdAllowed, rateLimitKey, readBoundedText } from "~/server/active-session"

const MAX_WEBHOOK_BYTES = 256_000
const HOOK_ID_RE = /^wh_[a-z0-9]{8,24}$/
const UTF8_DEC = new TextDecoder()

const decodeUserId = (encoded: string): string | null => {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(encoded)) return null
  try {
    return UTF8_DEC.decode(Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0)))
  } catch {
    return null
  }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers }
  })

/**
 * Signed inbound webhook endpoint (`/api/hooks/<encodedUser>/<hookId>`).
 * Verifies user allowlist and body size in the Worker before waking the user's Durable Object,
 * where HMAC-SHA256 / Bearer authentication and per-hook rate limits are enforced.
 */
export const Route = createFileRoute("/api/hooks/$user/$hookId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const userId = decodeUserId(params.user)
        if (!userId || !HOOK_ID_RE.test(params.hookId) || !isUserIdAllowed(env, userId)) {
          return json(404, { error: "Webhook not found." })
        }

        const rawBody = await readBoundedText(request, MAX_WEBHOOK_BYTES)
        if (rawBody === "too-large") return json(413, { error: "Webhook payload exceeds 256 KB limit." })

        const headers: Record<string, string | undefined> = {
          authorization: request.headers.get("authorization") ?? undefined,
          "x-dex-signature-256": request.headers.get("x-dex-signature-256") ?? undefined,
          "x-hub-signature-256": request.headers.get("x-hub-signature-256") ?? undefined,
          "linear-signature": request.headers.get("linear-signature") ?? undefined,
          "x-github-event": request.headers.get("x-github-event") ?? undefined,
          "x-dex-event": request.headers.get("x-dex-event") ?? undefined,
          "x-linear-event": request.headers.get("x-linear-event") ?? undefined,
          "stripe-event": request.headers.get("stripe-event") ?? undefined
        }

        const agent = await getAgentByName(env.DexAgent as unknown as DurableObjectNamespace<DexAgent>, userId)
        const outcome = (await agent.handleWebhook(params.hookId, rawBody, headers)) as { status: number; body: Record<string, unknown> }
        if (outcome.status === 401) {
          const { success } = await env.LOGIN_LIMITER.limit({ key: rateLimitKey(request, "hook") })
          if (!success) return json(429, { error: "Too many invalid webhook attempts." }, { "retry-after": "60" })
        }
        return json(outcome.status, outcome.body)
      },
      GET: () => json(405, { error: "Use POST" }, { allow: "POST" })
    }
  }
})
