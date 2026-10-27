import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { sessionUnavailable, viewerOrUnavailable } from "~/server/active-session"
import { AttachmentError, prepareAttachment } from "~/server/attachments"
import { ATTACHMENT_LIMITS } from "~/shared/attachments"

const error = (status: number, message: string) => Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } })

/** Prepares one file for a chat message (see server/attachments.ts). Signed-in users only; nothing is stored. */
export const Route = createFileRoute("/api/attachments")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Dex's own pages, or the native apps (which send no Origin).
        const origin = request.headers.get("origin")
        if (origin && origin !== new URL(request.url).origin) return error(403, "Cross-origin requests are not allowed")
        const viewer = await viewerOrUnavailable(request, env)
        if (viewer === "unavailable") return sessionUnavailable()
        if (!viewer) return error(401, "Sign in again")

        // Turned down before reading it: a form's overhead on top of the file is small.
        if (Number(request.headers.get("content-length") ?? 0) > ATTACHMENT_LIMITS.uploadBytes + 64 * 1024) {
          return error(413, `That file is too large (limit ${ATTACHMENT_LIMITS.uploadBytes / 1024 / 1024} MB).`)
        }
        const form = await request.formData().catch(() => null)
        const file = form?.get("file")
        if (!(file instanceof File)) return error(400, "Send the file as multipart form data, in a field named file.")
        try {
          return Response.json(await prepareAttachment(file, env.AI), { headers: { "cache-control": "no-store" } })
        } catch (cause) {
          if (cause instanceof AttachmentError) return error(cause.status, cause.message)
          console.error("Attachment failed:", cause)
          return error(500, `Couldn't prepare ${file.name}.`)
        }
      }
    }
  }
})
