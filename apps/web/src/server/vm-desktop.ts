import { getAgentByName } from "agents"
import type { DexAgent } from "~/agent/dex-agent"
import type { DesktopUpstream } from "~/agent/vm"
import { activeViewer } from "./active-session"

/**
 * The VM desktop over Selkies, framed by the Machine page at /vm-desktop/<vm key>/. The page and its client come
 * from Dex (the client is in public/assets/selkies, cached like the app's own files); the stream itself, the one
 * WebSocket at api/websockets, is relayed to the VM. The Worker adds what the VM asks for (boat's port cookie and
 * Selkies' password), so neither reaches the browser, and Safari, which won't send boat's cookie from inside Dex,
 * works too. Same origin, so it's covered by Dex's own sign-in.
 */

export const VM_DESKTOP_PREFIX = "/vm-desktop/"

/**
 * `?view=watch` (the chat's floating preview, which is watch-only): no Selkies touch controls, i.e. its sidebar
 * tab, on-screen keyboard button, and touch gamepad. The Machine page keeps them for taking control.
 */
const WATCH_ONLY = `<style>.toggle-handle,.virtual-keyboard-button,#touch-gamepad-host{display:none!important}</style>`

/** Selkies' own index.html, pointed at the copy of its client that ships with Dex. */
const page = (watchOnly: boolean) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Desktop</title>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<script type="module" crossorigin src="/assets/selkies/index-CPWh3fQ6.js"></script>
<link rel="stylesheet" crossorigin href="/assets/selkies/index-D97fjY6g.css">${watchOnly ? WATCH_ONLY : ""}
</head><body><div id="app"></div><div id="root"></div><div id="touch-gamepad-host"></div></body></html>`

/**
 * The client decodes video in workers it makes from blob: and data: URLs and reaches back only to this origin.
 * Framed only by Dex.
 */
const pagePolicy = (host: string) =>
  [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: data:",
    "worker-src 'self' blob: data:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src 'self' wss://${host} ws://${host}`,
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'"
  ].join("; ")

/**
 * What may reach the VM: the stream (a WebSocket) and the Selkies sidebar's few endpoints. Anything else is refused,
 * so a VM can't serve pages of its own under Dex's origin.
 */
const RELAYED = /^api\/(websockets|status|switch|upload|files(\/.*)?|print(\/.*)?)$/

/**
 * Whatever the VM answers (outside the stream) is inert on Dex's origin: the VM runs whatever the agent runs, and a
 * prompt-injected agent could replace Selkies with its own server. No scripts, no framing, no sniffing; files are
 * downloads. The Selkies client only reads these with fetch, which these headers don't affect.
 */
const INERT = {
  "content-security-policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
  "cache-control": "no-store"
}
const UPSTREAM_DROPPED = ["set-cookie", "location", "refresh", "link", "access-control-allow-origin", "access-control-allow-credentials", "access-control-allow-headers", "access-control-allow-methods", "access-control-expose-headers", "content-security-policy", "content-security-policy-report-only", "x-frame-options"]

/** Headers the browser sent that must not go to the VM: Dex's own cookie and anything naming Dex's host. */
const DROPPED = ["cookie", "authorization", "host", "origin", "referer", "cf-connecting-ip", "x-forwarded-for", "x-real-ip"]

const agentFor = (env: Env, userId: string) => getAgentByName(env.DexAgent as unknown as DurableObjectNamespace<DexAgent>, userId)

export async function handleVmDesktop(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const [rawKey, ...rest] = url.pathname.slice(VM_DESKTOP_PREFIX.length).split("/")
  const key = decodeURIComponent(rawKey ?? "")
  if (!key || key.length > 128) return new Response("Not found", { status: 404 })
  // /vm-desktop/<key> → /vm-desktop/<key>/, so the client's relative paths resolve under it.
  if (rest.length === 0) return Response.redirect(`${url.origin}${VM_DESKTOP_PREFIX}${rawKey}/`, 302)

  const origin = request.headers.get("origin")
  if (origin && origin !== url.origin) return new Response("Cross-origin requests are not allowed", { status: 403 })
  const viewer = await activeViewer(request, env)
  if (!viewer) return new Response("Unauthorized", { status: 401 })

  const path = rest.join("/")
  if (path === "" || path === "index.html") {
    return new Response(page(url.searchParams.get("view") === "watch"), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": pagePolicy(url.host),
        "x-content-type-options": "nosniff",
        "referrer-policy": "same-origin"
      }
    })
  }

  const upgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket"
  if (!RELAYED.test(path) || (path === "api/websockets") !== upgrade) return new Response("Not found", { status: 404 })

  const agent = await agentFor(env, viewer.id)
  const relay = async (upstream: DesktopUpstream) => {
    const target = new URL(`/${path}${url.search}`, upstream.origin)
    const headers = new Headers(request.headers)
    for (const name of DROPPED) headers.delete(name)
    for (const [name, value] of Object.entries(upstream.headers)) headers.set(name, value)
    headers.set("origin", upstream.origin)
    return fetch(target, { method: request.method, headers, body: request.body, redirect: "manual" })
  }

  try {
    let upstream = await agent.vmDesktopUpstream(key)
    if (!upstream) return new Response("The VM isn't running", { status: 503 })
    let response = await relay(upstream)
    // Selkies stopped answering, or boat's cookie lapsed: set up again once. (A request body can't be sent twice.)
    if ([401, 403, 502, 503].includes(response.status) && !request.body) {
      upstream = await agent.vmDesktopUpstream(key, true)
      if (!upstream) return new Response("The VM isn't running", { status: 503 })
      response = await relay(upstream)
    }
    if (response.status === 101 || response.webSocket) return upgrade ? response : new Response("Not found", { status: 404 })
    // No redirects from the VM: they'd make Dex's origin bounce you anywhere.
    if (response.status >= 300 && response.status < 400) return new Response("The desktop stream sent a redirect", { status: 502 })
    const relayed = new Response(response.body, response)
    for (const name of UPSTREAM_DROPPED) relayed.headers.delete(name)
    for (const [name, value] of Object.entries(INERT)) relayed.headers.set(name, value)
    if (path.startsWith("api/files") || path.startsWith("api/print")) relayed.headers.set("content-disposition", "attachment")
    return relayed
  } catch (error) {
    // e.g. the agent is still on the build from before this deploy, which has no vmDesktopUpstream yet.
    console.error("VM desktop relay failed:", error instanceof Error ? error.message : String(error))
    return new Response("The desktop stream isn't available right now. Try again in a moment.", { status: 503 })
  }
}
