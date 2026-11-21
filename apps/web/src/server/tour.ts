/**
 * The landing page's tour video, with byte ranges. Safari won't play a video without them, and static files are
 * served whole, so the Worker reads the file from the build's assets and answers ranges itself.
 */

export const TOUR_PATH = "/tour.mp4"
const ASSET = "/landing/dex-tour.mp4"

export async function serveTour(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 })
  const asset = await env.ASSETS.fetch(new URL(ASSET, request.url))
  if (!asset.ok) {
    void asset.body?.cancel()
    return new Response("Not found", { status: 404 })
  }
  const headers = { "content-type": "video/mp4", "accept-ranges": "bytes", "cache-control": "public, max-age=86400" }
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range")?.trim() ?? "")
  const contentLength = Number(asset.headers.get("content-length"))
  // Answer un-ranged HEAD directly from asset metadata without reading the whole video into memory.
  if (request.method === "HEAD" && (!range || (range[1] === "" && range[2] === "")) && Number.isFinite(contentLength) && contentLength > 0) {
    void asset.body?.cancel()
    return new Response(null, { status: 200, headers: { ...headers, "content-length": String(contentLength) } })
  }
  const body = await asset.arrayBuffer()
  const size = body.byteLength
  const send = (status: number, part: ArrayBuffer, extra: Record<string, string> = {}) =>
    new Response(request.method === "HEAD" ? null : part, { status, headers: { ...headers, ...extra, "content-length": String(part.byteLength) } })

  if (!range || (range[1] === "" && range[2] === "")) return send(200, body)
  const start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1])
  const end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1)
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } })
  return send(206, body.slice(start, end + 1), { "content-range": `bytes ${start}-${end}/${size}` })
}
