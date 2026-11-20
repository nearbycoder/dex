import { createFileRoute } from "@tanstack/react-router"
import { getAgentByName } from "agents"
import { env } from "cloudflare:workers"
import type { DexAgent } from "~/agent/dex-agent"
import { attachmentKey } from "~/agent/media"
import { sessionUnavailable, viewerOrUnavailable } from "~/server/active-session"
import { AttachmentError, prepareAttachment, type StoreFile } from "~/server/attachments"
import { ATTACHMENT_LIMITS } from "~/shared/attachments"

const error = (status: number, message: string) => Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } })

/**
 * Stores a file the model can't read inline in R2, under the user's prefix, and tells their agent about it (unsent
 * until a message claims it; deleted after a day otherwise).
 */
const storeFor =
  (userId: string): StoreFile =>
  async (file, name, mimeType) => {
    const key = attachmentKey(userId, name)
    await env.MEDIA.put(key, file, { httpMetadata: { contentType: mimeType }, customMetadata: { name } })
    try {
      const agent = await getAgentByName(env.DexAgent as unknown as DurableObjectNamespace<DexAgent>, userId)
      await agent.registerAttachment(key, name, mimeType, file.size)
    } catch (cause) {
      // An agent still on an older build has no registerAttachment yet: it restarts on the new code shortly.
      await env.MEDIA.delete(key).catch(() => undefined)
      console.error("Registering an attachment failed:", cause)
      throw new AttachmentError("Dex is updating. Try attaching it again in a moment.", 503)
    }
    return { kind: "file", name, mimeType, size: file.size, key }
  }

/** Prepares one file for a chat message (see server/attachments.ts). Signed-in users only. */
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
        if (Number(request.headers.get("content-length") ?? 0) > ATTACHMENT_LIMITS.fileBytes + 64 * 1024) {
          return error(413, `That file is too large (limit ${ATTACHMENT_LIMITS.fileBytes / 1024 / 1024} MB).`)
        }
        const form = await request.formData().catch(() => null)
        const file = form?.get("file")
        if (!(file instanceof File)) return error(400, "Send the file as multipart form data, in a field named file.")
        try {
          const bucket = (env as unknown as { MEDIA?: R2Bucket }).MEDIA
          return Response.json(await prepareAttachment(file, env.AI, bucket ? storeFor(viewer.id) : null), { headers: { "cache-control": "no-store" } })
        } catch (cause) {
          if (cause instanceof AttachmentError) return error(cause.status, cause.message)
          console.error("Attachment failed:", cause)
          return error(500, `Couldn't prepare ${file.name}.`)
        }
      }
    }
  }
})
