import { createFileRoute } from "@tanstack/react-router"
import { getAgentByName } from "agents"
import { env } from "cloudflare:workers"
import type { DexAgent } from "~/agent/dex-agent"
import { parseAccessToken } from "~/agent/access"
import { isUserIdAllowed, rateLimitKey, readBoundedText } from "~/server/active-session"
import { verifyHmac } from "~/server/crypto"

const MAX_BODY_BYTES = 1_000_000

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body === null ? {} : { "content-type": "application/json" }), "cache-control": "no-store", ...headers }
  })

const unauthorized = () =>
  json(401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "A valid Dex access token is required (Settings → Access)." } }, {
    "www-authenticate": 'Bearer realm="dex"'
  })

const tooManyAuthFailures = () =>
  json(429, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Too many failed authentication attempts. Wait a minute and try again." } }, { "retry-after": "60" })

/**
 * Dex's MCP endpoint (Streamable HTTP, stateless, JSON responses) for external agents. Requests carry an access
 * token made on the Access page: `Authorization: Bearer dexk.…`. The token's signature is checked here, so forged
 * tokens never reach an agent; the user's agent then checks it isn't revoked or expired and enforces its scope.
 * No CORS headers are sent, so web pages can't call it, and requests from other sites' pages are refused.
 */
export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin")
        if (origin && origin !== new URL(request.url).origin) return json(403, { error: "Cross-origin requests are not allowed" })

        const secret = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]
        const parsed = secret ? parseAccessToken(secret) : null
        const authSecret = String((env as unknown as Record<string, unknown>).AUTH_SECRET ?? "")
        const valid = parsed && isUserIdAllowed(env, parsed.userId)
          ? await verifyHmac(authSecret, parsed.signed, parsed.tag)
          : false
        if (!secret || !parsed || !valid) {
          const { success } = await env.LOGIN_LIMITER.limit({ key: rateLimitKey(request, "mcp") })
          if (!success) return tooManyAuthFailures()
          return unauthorized()
        }

        const text = await readBoundedText(request, MAX_BODY_BYTES)
        if (text === "too-large") return json(413, { error: "Request too large" })
        let body: unknown
        try {
          body = JSON.parse(text)
        } catch {
          return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })
        }

        const agent = await getAgentByName(env.DexAgent as unknown as DurableObjectNamespace<DexAgent>, parsed.userId)
        // `unknown` doesn't survive the RPC stub's typing; the shape is mcpRequest's return type.
        const response = (await agent.mcpRequest(secret, body as never)) as { status: number; body: unknown }
        if (response.status === 401) {
          const { success } = await env.LOGIN_LIMITER.limit({ key: rateLimitKey(request, "mcp") })
          if (!success) return tooManyAuthFailures()
          return unauthorized()
        }
        return json(response.status, response.body)
      },
      // Stateless: no server-initiated stream and no sessions to end.
      GET: () => json(405, { error: "Use POST" }, { allow: "POST" }),
      DELETE: () => json(405, { error: "Use POST" }, { allow: "POST" })
    }
  }
})
