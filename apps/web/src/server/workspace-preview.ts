import { withAudioUnlock } from "~/shared/web-audio"
import { activeViewer } from "./active-session"

/**
 * The Workspace page's HTML preview. A frame given the file's HTML directly (srcdoc) inherits Dex's strict Content
 * Security Policy, so a page that loads a chart library or fonts from a CDN breaks. Instead the page posts the HTML
 * here (a form targeting the frame, so unsaved edits preview too) and gets it back as its own document with its own
 * policy: anything may load, but the document is sandboxed into an opaque origin, so its scripts can't read Dex's
 * cookies or storage, make requests as you, or navigate Dex. Only Dex may frame it, and only a signed-in, same-origin
 * post gets an answer, so other sites can't use it to show their pages on Dex's address.
 */

export const WORKSPACE_PREVIEW_PATH = "/workspace-preview"

const MAX_BYTES = 5_000_000

const POLICY = [
  "sandbox allow-scripts allow-forms allow-popups allow-modals",
  "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  "img-src * data: blob:",
  "font-src * data:",
  "connect-src *",
  "frame-ancestors 'self'"
].join("; ")

export async function handleWorkspacePreview(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } })
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response("Cross-origin requests are not allowed", { status: 403 })
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES * 3) return new Response("Too large to preview", { status: 413 })
  if (!(await activeViewer(request, env))) return new Response("Unauthorized", { status: 401 })

  const html = (await request.formData()).get("html")
  if (typeof html !== "string" || html.length > MAX_BYTES) return new Response("Nothing to preview", { status: 400 })
  // So a game or demo with sound plays it on iPhone too (see shared/web-audio.ts).
  return new Response(withAudioUnlock(html), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": POLICY,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer"
    }
  })
}
