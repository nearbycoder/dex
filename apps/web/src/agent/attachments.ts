import type { ImageContent, TextContent } from "@earendil-works/pi-ai"
import { ATTACHMENT_LIMITS, attachmentTag, type ChatAttachment, INLINE_IMAGE_TYPES } from "~/shared/attachments"

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/**
 * A message's attachments as the app sent them, checked again: the upload route prepared them, but any client can
 * call `sendMessage`, and the whole message must fit a SQLite row. Throws with what to fix.
 */
export function checkAttachments(raw: unknown): ChatAttachment[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Error("Attachments must be a list.")
  if (raw.length > ATTACHMENT_LIMITS.files) throw new Error(`Attach at most ${ATTACHMENT_LIMITS.files} files to a message.`)
  let imageChars = 0
  let textChars = 0
  return raw.map((item: unknown): ChatAttachment => {
    const value = (item ?? {}) as Record<string, unknown>
    const name = typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, ATTACHMENT_LIMITS.name) : "file"
    const mimeType = typeof value.mimeType === "string" ? value.mimeType.slice(0, 100) : ""
    if (value.kind === "image") {
      const data = value.data
      if (!INLINE_IMAGE_TYPES.has(mimeType) || typeof data !== "string" || !BASE64.test(data)) throw new Error(`${name} isn't an image Dex can send.`)
      if (data.length > ATTACHMENT_LIMITS.imageBase64) throw new Error(`${name} is too large; attach it again so Dex can shrink it.`)
      imageChars += data.length
      if (imageChars > ATTACHMENT_LIMITS.imagesBase64) throw new Error("Those images are too much for one message: send some in the next one.")
      return { kind: "image", name, mimeType, data }
    }
    if (value.kind === "text") {
      const text = value.text
      if (typeof text !== "string") throw new Error(`${name} has no text.`)
      if (text.length > ATTACHMENT_LIMITS.textChars) throw new Error(`${name} is too long; attach it again so Dex can cut it to fit.`)
      textChars += text.length
      if (textChars > ATTACHMENT_LIMITS.textsChars) throw new Error("Those files are too long for one message: send some in the next one.")
      return {
        kind: "text",
        name,
        mimeType: mimeType || "text/plain",
        text,
        ...(value.converted === true && { converted: true }),
        ...(value.truncated === true && { truncated: true })
      }
    }
    throw new Error(`${name} isn't an attachment Dex knows.`)
  })
}

/**
 * The message the model gets: your text first, then each file in a tag naming it (its text inside, or for an image,
 * the image right after). A model that reads text only gets a note in place of each image.
 */
export function messageContent(text: string, attachments: readonly ChatAttachment[], vision: boolean): string | Array<TextContent | ImageContent> {
  if (attachments.length === 0) return text
  const parts: Array<TextContent | ImageContent> = text ? [{ type: "text", text }] : []
  for (const attachment of attachments) {
    if (attachment.kind === "text") {
      parts.push({ type: "text", text: attachmentTag(attachment, attachment.text) })
    } else if (vision) {
      parts.push({ type: "text", text: attachmentTag(attachment) }, { type: "image", data: attachment.data, mimeType: attachment.mimeType })
    } else {
      parts.push({
        type: "text",
        text: attachmentTag(
          attachment,
          "(An image the user attached. This chat's model reads text only, so it can't see it: say so, and suggest switching to a model marked Vision.)"
        )
      })
    }
  }
  return parts
}
