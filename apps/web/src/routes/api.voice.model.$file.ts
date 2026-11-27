import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { sessionUnavailable, viewerOrUnavailable } from "~/server/active-session"
import { fetchModelFile, MODEL_FILES } from "~/server/voice/tiny-voca"
import { TINY_VOCA_REVISION } from "~/shared/voice"

/**
 * tiny-voca's model and config for the apps to run on the device, from the pinned Hugging Face revision. Served by
 * Dex so the page's Content Security Policy can keep connect-src to Dex alone. The revision is in the ETag; the file
 * at this address never changes within a deploy, so apps can keep it.
 */
export const Route = createFileRoute("/api/voice/model/$file")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const viewer = await viewerOrUnavailable(request, env)
        if (viewer === "unavailable") return sessionUnavailable()
        if (!viewer) return new Response("Unauthorized", { status: 401, headers: { "cache-control": "no-store" } })
        const file = Object.hasOwn(MODEL_FILES, params.file) ? MODEL_FILES[params.file] : undefined
        if (!file) return new Response("Not found", { status: 404 })
        const etag = `"${TINY_VOCA_REVISION}-${params.file}"`
        const headers = { "cache-control": "private, max-age=31536000, immutable", etag, "content-type": file.type }
        const ifNoneMatch = request.headers.get("if-none-match") ?? ""
        if (ifNoneMatch.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag)) {
          return new Response(null, { status: 304, headers })
        }
        const upstream = await fetchModelFile(file.path)
        if (!upstream.ok || !upstream.body) {
          void upstream.body?.cancel()
          return new Response("The voice model isn't available right now.", { status: 502, headers: { "cache-control": "no-store" } })
        }
        const length = upstream.headers.get("content-length")
        return new Response(upstream.body, { headers: { ...headers, ...(length && { "content-length": length }) } })
      }
    }
  }
})
