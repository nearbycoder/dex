import { createFileRoute } from "@tanstack/react-router"
import { getAgentByName } from "agents"
import { env } from "cloudflare:workers"
import type { DexAgent } from "~/agent/dex-agent"
import { encodeUserId, parseDownloadToken, parseUploadToken } from "~/agent/media"
import { activeViewer, rateLimitKey } from "~/server/active-session"
import { verifyHmac } from "~/server/crypto"
import { MAX_MEDIA_BYTES, mediaTypeOf } from "~/shared/media"

const KEY = /^[A-Za-z0-9_-]+\/[0-9a-f-]{36}\.[a-z0-9]+$/
const agentFor = (userId: string) => getAgentByName(env.DexAgent as unknown as DurableObjectNamespace<DexAgent>, userId)
const status = (code: number, message: string) => new Response(message, { status: code, headers: { "cache-control": "no-store" } })

/** `attachment; filename*=…` for a file's name (RFC 6266/5987). */
const downloadDisposition = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name.replace(/[\u0000-\u001f]/g, "")).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`

/**
 * GET/HEAD /api/media/<user>/<id>.<ext>: a stored file, for its owner only (session cookie), with byte ranges so
 * Safari can play and seek video. Media types (the extension's allowlist) are served inline; any other file (an
 * attachment such as a zip) only as a download of octet-stream. Every response is sandboxed, so nothing served here
 * can run as a page on Dex's origin.
 */
async function serve(request: Request, key: string, head: boolean) {
  if (!KEY.test(key)) return status(404, "Not found")
  const media = mediaTypeOf(key)
  const viewer = await activeViewer(request, env)
  if (!viewer) return status(401, "Unauthorized")
  // Someone else's key looks the same as a missing one.
  if (!key.startsWith(`${encodeUserId(viewer.id)}/`)) return status(404, "Not found")

  const object = head ? await env.MEDIA.head(key) : await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers })
  if (!object) return status(404, "Not found")

  const requestUrl = new URL(request.url)
  const forceDownload = requestUrl.searchParams.get("download") === "1"
  const requestedName = requestUrl.searchParams.get("name")?.replace(/[\u0000-\u001f/\\]/g, "_").trim().slice(0, 140)
  const baseName = requestedName || object.customMetadata?.name || key.split("/").pop() || "file"
  const keyExt = /\.([a-z0-9]{1,10})$/i.exec(key)?.[1]?.toLowerCase()
  const downloadName = keyExt && !baseName.toLowerCase().endsWith(`.${keyExt}`) ? `${baseName}.${keyExt}` : baseName

  const headers = new Headers({
    "content-type": media?.type ?? "application/octet-stream",
    "accept-ranges": "bytes",
    etag: object.httpEtag,
    "cache-control": "private, max-age=31536000, immutable",
    "content-disposition": media && !forceDownload ? "inline" : downloadDisposition(downloadName),
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin"
  })
  if (head) {
    headers.set("content-length", String(object.size))
    return new Response(null, { status: 200, headers })
  }
  // A failed precondition (If-None-Match / If-Modified-Since → 304; If-Match / If-Unmodified-Since → 412).
  if (!("body" in object)) {
    const isPreconditionFailed = request.headers.has("if-match") || request.headers.has("if-unmodified-since")
    return new Response(null, { status: isPreconditionFailed ? 412 : 304, headers })
  }

  const range = object.range as { offset?: number; length?: number; suffix?: number } | undefined
  if (range && request.headers.has("range")) {
    const length = range.suffix !== undefined ? Math.min(range.suffix, object.size) : Math.min(range.length ?? Math.max(0, object.size - (range.offset ?? 0)), Math.max(0, object.size - (range.offset ?? 0)))
    const offset = range.suffix !== undefined ? object.size - length : (range.offset ?? 0)
    if (length <= 0 || offset < 0 || offset >= object.size) {
      void (object as R2ObjectBody).body.cancel()
      headers.set("content-range", `bytes */${object.size}`)
      return new Response(null, { status: 416, headers })
    }
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
  const authSecret = String((env as unknown as Record<string, unknown>).AUTH_SECRET ?? "")
  const valid = parsed ? await verifyHmac(authSecret, parsed.signed, parsed.tag) : false
  if (!parsed || !valid) {
    const { success } = await env.LOGIN_LIMITER.limit({ key: rateLimitKey(request, "media-upload") })
    if (!success) return status(429, "Too many attempts")
    return status(401, "Invalid upload token")
  }
  const size = Number(request.headers.get("content-length"))
  if (!Number.isFinite(size) || size <= 0) return status(411, "Content-Length required")
  if (size > MAX_MEDIA_BYTES) return status(413, `Too large: the limit is ${Math.floor(MAX_MEDIA_BYTES / 1024 / 1024)} MB`)
  if (!request.body) return status(400, "Empty body")

  const agent = await agentFor(parsed.userId)
  const claim = (await agent.consumeMediaUpload(token, size)) as { key: string; contentType: string; name: string; sessionId: string } | null
  if (!claim || !claim.key.startsWith(`${encodeUserId(parsed.userId)}/`)) return status(401, "Upload token expired or already used")

  const stored = await env.MEDIA.put(claim.key, request.body, { httpMetadata: { contentType: claim.contentType }, customMetadata: { name: claim.name } })
  try {
    await agent.finishMediaUpload(claim.key, claim.sessionId, claim.name, claim.contentType, stored?.size ?? size)
  } catch (error) {
    await env.MEDIA.delete(claim.key).catch(() => {})
    throw error
  }
  return new Response(JSON.stringify({ url: `/api/media/${claim.key}` }), { status: 201, headers: { "content-type": "application/json", "cache-control": "no-store" } })
}

/**
 * GET /api/media/download/<token>: a chat's VM fetching a file attached to the chat (the get_attachment tool). The
 * single-use token (HMAC-checked here, claimed in the user's agent) is the only credential; browsers can't use it.
 */
async function download(request: Request, token: string) {
  if (request.headers.get("origin")) return status(403, "Downloads go to VMs, not browsers")
  const parsed = parseDownloadToken(token)
  const authSecret = String((env as unknown as Record<string, unknown>).AUTH_SECRET ?? "")
  const valid = parsed ? await verifyHmac(authSecret, parsed.signed, parsed.tag) : false
  if (!parsed || !valid) {
    const { success } = await env.LOGIN_LIMITER.limit({ key: rateLimitKey(request, "media-download") })
    if (!success) return status(429, "Too many attempts")
    return status(401, "Invalid download token")
  }
  const agent = await agentFor(parsed.userId)
  const file = (await agent.consumeMediaDownload(token)) as { key: string; contentType: string } | null
  if (!file || !file.key.startsWith(`${encodeUserId(parsed.userId)}/`)) return status(401, "Download token expired or already used")
  const object = await env.MEDIA.get(file.key)
  if (!object) return status(404, "Not found")
  return new Response(object.body, {
    headers: { "content-type": "application/octet-stream", "content-length": String(object.size), "cache-control": "no-store", "x-content-type-options": "nosniff" }
  })
}

export const Route = createFileRoute("/api/media/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const path = params._splat ?? ""
        return path.startsWith("download/") ? download(request, path.slice("download/".length)) : serve(request, path, false)
      },
      HEAD: ({ request, params }) => serve(request, params._splat ?? "", true),
      PUT: ({ request, params }) => {
        const path = params._splat ?? ""
        return path.startsWith("upload/") ? upload(request, path.slice("upload/".length)) : status(405, "Method not allowed")
      }
    }
  }
})
