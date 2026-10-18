import { createFileRoute } from "@tanstack/react-router"
import { getAgentByName } from "agents"
import { env } from "cloudflare:workers"
import type { DexAgent } from "~/agent/dex-agent"
import { encodeUserId, parseUploadToken } from "~/agent/media"
import { activeViewer } from "~/server/active-session"
import { Keys } from "~/server/crypto"
import { serverRuntime } from "~/server/runtime"
import { MAX_MEDIA_BYTES, mediaTypeOf } from "~/shared/media"

const KEY = /^[A-Za-z0-9_-]+\/[0-9a-f-]{36}\.[a-z0-9]+$/
const agentFor = (userId: string) => getAgentByName(env.DexAgent as unknown as DurableObjectNamespace<DexAgent>, userId)
const status = (code: number, message: string) => new Response(message, { status: code, headers: { "cache-control": "no-store" } })

/**
 * GET/HEAD /api/media/<user>/<id>.<ext>: a shared file, for its owner only (session cookie), with byte ranges so
 * Safari can play and seek video. The type comes from the extension's allowlist and the response is sandboxed, so
 * nothing served here can run as a page on Dex's origin.
 */
async function serve(request: Request, key: string, head: boolean) {
  if (!KEY.test(key)) return status(404, "Not found")
  const media = mediaTypeOf(key)
  if (!media) return status(404, "Not found")
  const viewer = await activeViewer(request, env)
  if (!viewer) return status(401, "Unauthorized")
  // Someone else's key looks the same as a missing one.
  if (!key.startsWith(`${encodeUserId(viewer.id)}/`)) return status(404, "Not found")

  const object = head ? await env.MEDIA.head(key) : await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers })
  if (!object) return status(404, "Not found")

  const headers = new Headers({
    "content-type": media.type,
    "accept-ranges": "bytes",
    etag: object.httpEtag,
    "cache-control": "private, max-age=31536000, immutable",
    "content-disposition": "inline",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin"
  })
  if (head) {
    headers.set("content-length", String(object.size))
    return new Response(null, { status: 200, headers })
  }
  // A failed precondition (If-None-Match, …) returns the object without a body.
  if (!("body" in object)) return new Response(null, { status: 304, headers })

  const range = object.range as { offset?: number; length?: number; suffix?: number } | undefined
  if (range && request.headers.has("range")) {
    const offset = range.suffix !== undefined ? object.size - range.suffix : (range.offset ?? 0)
    const length = range.suffix !== undefined ? range.suffix : (range.length ?? object.size - offset)
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`)
    headers.set("content-length", String(length))
    return new Response((object as R2ObjectBody).body, { status: 206, headers })
  }
  headers.set("content-length", String(object.size))
  return new Response((object as R2ObjectBody).body, { status: 200, headers })
}

/**
 * PUT /api/media/upload/<token>: a VM uploading a file it was asked to share. The single-use token (HMAC-checked
 * here, claimed in the user's agent) is the only credential; browsers can't use this endpoint.
 */
async function upload(request: Request, token: string) {
  if (request.headers.get("origin")) return status(403, "Uploads come from VMs, not browsers")
  const parsed = parseUploadToken(token)
  const valid = parsed ? await serverRuntime(env).runPromise(Keys.use((keys) => keys.verify(parsed.signed, parsed.tag))) : false
  if (!parsed || !valid) {
    await env.LOGIN_LIMITER.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" })
    return status(401, "Invalid upload token")
  }
  const size = Number(request.headers.get("content-length"))
  if (!Number.isFinite(size) || size <= 0) return status(411, "Content-Length required")
  if (size > MAX_MEDIA_BYTES) return status(413, `Too large: the limit is ${Math.floor(MAX_MEDIA_BYTES / 1024 / 1024)} MB`)
  if (!request.body) return status(400, "Empty body")

  const agent = await agentFor(parsed.userId)
  const claim = (await agent.consumeMediaUpload(token, size)) as { key: string; contentType: string; name: string; sessionId: string } | null
  if (!claim || !claim.key.startsWith(`${encodeUserId(parsed.userId)}/`)) return status(401, "Upload token expired or already used")

  await env.MEDIA.put(claim.key, request.body, { httpMetadata: { contentType: claim.contentType }, customMetadata: { name: claim.name } })
  await agent.finishMediaUpload(claim.key, claim.sessionId, claim.name, claim.contentType, size)
  return new Response(JSON.stringify({ url: `/api/media/${claim.key}` }), { status: 201, headers: { "content-type": "application/json" } })
}

export const Route = createFileRoute("/api/media/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => serve(request, params._splat ?? "", false),
      HEAD: ({ request, params }) => serve(request, params._splat ?? "", true),
      PUT: ({ request, params }) => {
        const path = params._splat ?? ""
        return path.startsWith("upload/") ? upload(request, path.slice("upload/".length)) : status(405, "Method not allowed")
      }
    }
  }
})
