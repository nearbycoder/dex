import handler from "@tanstack/react-start/server-entry"
import { routeAgentRequest } from "agents"
import { activeViewer } from "./server/active-session"
import { handleVmDesktop, VM_DESKTOP_PREFIX } from "./server/vm-desktop"

export { DexAgent } from "./agent/dex-agent"

const sameOrigin = (origin: string, request: Request) => {
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    // e.g. `Origin: null` from a sandboxed frame or a file.
    return false
  }
}

/** Agent requests need a current (not revoked) session cookie for the same user the instance belongs to. */
const authorizeAgent = (env: Env) => async (request: Request, route: { name: string }) => {
  const origin = request.headers.get("origin")
  if (origin && !sameOrigin(origin, request)) {
    return new Response("Cross-origin agent requests are not allowed", { status: 403 })
  }
  const viewer = await activeViewer(request, env)
  if (!viewer) return new Response("Unauthorized", { status: 401 })
  if (viewer.id !== route.name) return new Response("Forbidden", { status: 403 })
}

/**
 * Defense in depth for a page that renders model-written content:
 * - connect-src 'self': even injected script couldn't send chat content anywhere but Dex.
 * - img-src: images only from Dex (and GitHub avatars), so a prompt-injected "image" URL can't leak data.
 * - script-src 'self' 'unsafe-inline': no third-party scripts (TanStack Start inlines its hydration scripts).
 * - frame-src: the VM desktop (Dex's own /vm-desktop/ page, or boat.dev's players) and the YouTube/Vimeo players.
 *   Only /vm-desktop/ may be framed, and only by Dex.
 * - media-src https:: video elsewhere, loaded only when the user taps play.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://avatars.githubusercontent.com https://i.ytimg.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  // Video from other sites only loads after a tap (client/components/media.tsx), never from model output alone.
  "media-src 'self' blob: https:",
  "frame-src 'self' https://boat.dev https://*.boat.dev https://www.youtube-nocookie.com https://player.vimeo.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join("; ")

const withSecurityHeaders = (response: Response, request: Request) => {
  // WebSocket upgrades and the like can't be copied.
  if (response.status === 101 || response.webSocket) return response
  const secured = new Response(response.body, response)
  // Responses with their own (stricter) policy keep it, e.g. sandboxed media.
  if (!secured.headers.has("Content-Security-Policy")) secured.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY)
  secured.headers.set("X-Content-Type-Options", "nosniff")
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
  // Pages opened from Dex (links in chats) get no handle back to it, and Dex none to them.
  secured.headers.set("Cross-Origin-Opener-Policy", "same-origin")
  if (new URL(request.url).protocol === "https:") secured.headers.set("Strict-Transport-Security", "max-age=31536000")
  return secured
}

export default {
  async fetch(request, env) {
    // Agent sockets live at /agents/<class>/<instance>. Other /agents/* paths (the Agents pages, e.g.
    // /agents/pr-reviewer) don't match the SDK's two-segment route and fall through to the app.
    if (new URL(request.url).pathname.startsWith("/agents/")) {
      const authorize = authorizeAgent(env)
      const response = await routeAgentRequest(request, env, { onBeforeConnect: authorize, onBeforeRequest: authorize })
      if (response) return response
    }
    if (new URL(request.url).pathname.startsWith(VM_DESKTOP_PREFIX)) return withSecurityHeaders(await handleVmDesktop(request, env), request)
    return withSecurityHeaders(await handler.fetch(request), request)
  }
} satisfies ExportedHandler<Env>
