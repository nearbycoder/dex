/**
 * The landing page's tour video, with byte ranges. Safari won't play a video without them, and static files are
 * served whole, so the Worker reads the file from the build's assets and answers ranges itself.
 */

export const TOUR_PATH = "/tour.mp4"
const ASSET = "/landing/dex-tour.mp4"

export async function serveTour(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } })
  }
  const asset = await env.ASSETS.fetch(new URL(ASSET, request.url))
  if (!asset.ok) {
    void asset.body?.cancel()
    return new Response("Not found", { status: 404 })
  }
  const etag = asset.headers.get("etag")
  const headers: Record<string, string> = {
    "content-type": "video/mp4",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=86400",
    ...(etag ? { etag } : {})
  }
  if (etag && (request.headers.get("if-none-match") ?? "").split(",").some((t) => t.trim().replace(/^W\//, "") === etag.replace(/^W\//, ""))) {
    void asset.body?.cancel()
    return new Response(null, { status: 304, headers })
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range")?.trim() ?? "")
  const contentLength = Number(asset.headers.get("content-length"))
  // Answer both un-ranged and ranged HEAD directly from asset metadata without reading the video into memory.
  if (request.method === "HEAD" && Number.isFinite(contentLength) && contentLength > 0) {
    void asset.body?.cancel()
    if (!range || (range[1] === "" && range[2] === "")) {
      return new Response(null, { status: 200, headers: { ...headers, "content-length": String(contentLength) } })
    }
    const start = range[1] === "" ? Math.max(0, contentLength - Number(range[2])) : Number(range[1])
    const end = range[1] === "" || range[2] === "" ? contentLength - 1 : Math.min(Number(range[2]), contentLength - 1)
    if (start > end || start >= contentLength) {
      return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${contentLength}` } })
    }
    return new Response(null, {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${contentLength}`, "content-length": String(end - start + 1) }
    })
  }
  const body = await asset.arrayBuffer()
  const size = body.byteLength
  const send = (status: number, part: ArrayBuffer | Uint8Array<ArrayBuffer>, extra: Record<string, string> = {}) =>
    new Response(request.method === "HEAD" ? null : part, { status, headers: { ...headers, ...extra, "content-length": String(part.byteLength) } })

  if (!range || (range[1] === "" && range[2] === "")) return send(200, body)
  const start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1])
  const end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1)
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } })
  // Zero-copy subarray view instead of copying the byte range.
  return send(206, new Uint8Array(body, start, end - start + 1), { "content-range": `bytes ${start}-${end}/${size}` })
}
