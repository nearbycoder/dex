import { KeyRound, ShieldCheck } from "lucide-react"
import type { McpAuth, McpConnectResult } from "~/shared/mcp"

export const AUTH_LABEL: Record<McpAuth, string> = { none: "No auth", headers: "API key", oauth: "OAuth" }
export const AUTH_ICON: Record<McpAuth, typeof KeyRound | null> = { none: null, headers: KeyRound, oauth: ShieldCheck }

/** Sends the browser to the server's sign-in page when connecting needs one; it returns to /mcp. */
export const followConnect = (result: McpConnectResult) => {
  if (!result.ok || !result.authUrl) return
  try {
    const url = new URL(result.authUrl)
    const allowed = url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
    if (allowed) window.location.assign(url.href)
  } catch {}
}
