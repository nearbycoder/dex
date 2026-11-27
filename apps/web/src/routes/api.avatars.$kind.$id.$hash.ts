import { createFileRoute } from "@tanstack/react-router"
import { getAgentByName } from "agents"
import { env } from "cloudflare:workers"
import type { DexAgent } from "~/agent/dex-agent"
import { sessionUnavailable, viewerOrUnavailable } from "~/server/active-session"
import { type AvatarKind, parseAvatarDataUrl } from "~/shared/avatars"

const NO_STORE = { "cache-control": "no-store" }
const HASH_RE = /^[0-9a-f]{16}$/

/**
 * GET/HEAD /api/avatars/<kind>/<id>/<hash>: immutable, content-addressed character or project image served to its
 * owner only (session cookie, no Origin required, so Web, iOS, and Android share one endpoint).
 * Every response is sandboxed with `nosniff` and `default-src 'none'; sandbox` so uploaded SVGs can never run script.
 */
async function serve(request: Request, params: { kind: string; id: string; hash: string }, head: boolean) {
  const kind = params.kind
  if (kind !== "character" && kind !== "project") return new Response("Not found", { status: 404, headers: NO_STORE })
  const id = params.id
  const hash = params.hash
  if (!id || id.length > 100 || !HASH_RE.test(hash)) return new Response("Not found", { status: 404, headers: NO_STORE })

  const viewer = await viewerOrUnavailable(request, env)
  if (viewer === "unavailable") return sessionUnavailable()
  if (!viewer) return new Response("Unauthorized", { status: 401, headers: NO_STORE })

  const etag = `"${hash}"`
  const agent = await getAgentByName(env.DexAgent as unknown as DurableObjectNamespace<DexAgent>, viewer.id)
  let record: { dataUrl: string; hash: string } | null
  try {
    record = await agent.avatarImage(kind as AvatarKind, id)
  } catch {
    // An agent still on the build from before this route: activeViewer above triggered its restart.
    return new Response("Dex is updating. Try again in a moment.", { status: 503, headers: { ...NO_STORE, "retry-after": "1" } })
  }
  if (!record || record.hash !== hash) return new Response("Not found", { status: 404, headers: NO_STORE })

  const parsed = parseAvatarDataUrl(record.dataUrl)
  if (!parsed) return new Response("Not found", { status: 404, headers: NO_STORE })

  const headers = new Headers({
    "content-type": parsed.mimeType,
    "content-length": String(parsed.bytes.byteLength),
    etag,
    "cache-control": "private, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin"
  })
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(head ? null : parsed.bytes, { status: 200, headers })
}

export const Route = createFileRoute("/api/avatars/$kind/$id/$hash")({
  server: {
    handlers: {
      GET: ({ request, params }) => serve(request, params, false),
      HEAD: ({ request, params }) => serve(request, params, true)
    }
  }
})
