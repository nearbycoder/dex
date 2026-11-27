import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { readBoundedText, sessionUnavailable, viewerOrUnavailable } from "~/server/active-session"
import { phonemesFor } from "~/server/voice/tiny-voca"
import { MAX_SPOKEN_CHARS } from "~/shared/voice"

const noStore = { "cache-control": "no-store" }
const MAX_BODY_BYTES = MAX_SPOKEN_CHARS * 4 + 1024

/**
 * Text a sidekick says on a call, as the phoneme ids tiny-voca reads (see shared/voice.ts). The web app and the
 * native apps (session cookie, no Origin) call it a sentence or two at a time while a reply streams.
 */
export const Route = createFileRoute("/api/voice/phonemes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin")
        if (origin && origin !== new URL(request.url).origin) {
          return Response.json({ error: "Cross-origin requests are not allowed" }, { status: 403, headers: noStore })
        }
        const viewer = await viewerOrUnavailable(request, env)
        if (viewer === "unavailable") return sessionUnavailable()
        if (!viewer) return Response.json({ error: "Sign in again" }, { status: 401, headers: noStore })
        const raw = await readBoundedText(request, MAX_BODY_BYTES)
        if (raw === "too-large") return Response.json({ error: `At most ${MAX_SPOKEN_CHARS} characters at a time` }, { status: 413, headers: noStore })
        let body: { text?: unknown } | null = null
        try {
          body = JSON.parse(raw) as { text?: unknown } | null
        } catch {
          body = null
        }
        const text = typeof body?.text === "string" ? body.text : ""
        if (!text.trim()) return Response.json({ sentences: [] }, { headers: noStore })
        if (text.length > MAX_SPOKEN_CHARS) return Response.json({ error: `At most ${MAX_SPOKEN_CHARS} characters at a time` }, { status: 413, headers: noStore })
        try {
          return Response.json(await phonemesFor(text), { headers: noStore })
        } catch (cause) {
          console.error("Phonemes failed:", cause)
          return Response.json({ error: "The voice isn't available right now." }, { status: 503, headers: { ...noStore, "retry-after": "5" } })
        }
      }
    }
  }
})
