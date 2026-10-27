import { createCloudflarePhotonImages } from "@earendil-works/pi-durable/images/cloudflare"
import { ATTACHMENT_LIMITS, type ChatAttachment, INLINE_IMAGE_TYPES } from "~/shared/attachments"

/**
 * `POST /api/attachments` (one file, as multipart `file`): turns an upload into something a model can take, without
 * storing it. Images are turned upright, scaled, and re-encoded to fit (Photon, here in the Worker rather than in the
 * agent, whose memory every chat shares); text and code files are read as text; PDFs, Office documents, and web pages
 * become Markdown through Workers AI. The app sends the result with the message.
 */

/** Types and extensions read as plain text. */
const TEXT_TYPES = /^(text\/|application\/(json|ld\+json|xml|x-yaml|yaml|toml|javascript|typescript|x-sh|x-python|sql|graphql|x-httpd-php))/
const TEXT_EXTENSIONS = new Set(
  (
    "txt md markdown csv tsv json jsonl yaml yml toml xml log ini cfg conf sql graphql gql env " +
    "js mjs cjs ts tsx jsx py rb go rs java kt kts swift c h cc cpp hpp cs php sh bash zsh fish lua r scala dart vue svelte css scss sass less " +
    "gradle properties tex bib rst adoc org diff patch"
  ).split(" ")
)
/** Converted to Markdown by Workers AI (https://developers.cloudflare.com/workers-ai/features/markdown-conversion/). */
const DOCUMENT_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "xlsm", "xlsb", "xls", "et", "ods", "odt", "numbers", "html", "htm"])
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp"
}

let photon: ReturnType<typeof createCloudflarePhotonImages> | undefined

export class AttachmentError extends Error {
  constructor(message: string, readonly status = 415) {
    super(message)
  }
}

const extensionOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ""

const cleanName = (name: string) =>
  (name.split(/[\\/]/).pop() ?? "file").replace(/[\u0000-\u001f]/g, "").trim().slice(0, ATTACHMENT_LIMITS.name) || "file"

/** Text, cut to the limit; null if the bytes aren't UTF-8 text. */
const asText = (bytes: Uint8Array): { text: string; truncated?: true } | null => {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  if (text.includes("\u0000")) return null
  return text.length > ATTACHMENT_LIMITS.textChars
    ? { text: text.slice(0, ATTACHMENT_LIMITS.textChars), truncated: true }
    : { text }
}

export async function prepareAttachment(file: File, ai: Ai): Promise<ChatAttachment> {
  const name = cleanName(file.name)
  const extension = extensionOf(name)
  if (file.size > ATTACHMENT_LIMITS.uploadBytes) {
    throw new AttachmentError(`${name} is too large (limit ${ATTACHMENT_LIMITS.uploadBytes / 1024 / 1024} MB).`, 413)
  }
  const declared = file.type.toLowerCase()
  const imageType = declared.startsWith("image/") ? declared : IMAGE_EXTENSIONS[extension]

  if (imageType === "image/heic" || imageType === "image/heif" || extension === "heic" || extension === "heif") {
    throw new AttachmentError(`${name} is a HEIC photo. Share it as JPEG (on iPhone: Settings → Camera → Formats → Most Compatible).`)
  }
  if (imageType && (INLINE_IMAGE_TYPES.has(imageType) || imageType === "image/bmp")) {
    photon ??= createCloudflarePhotonImages()
    const bytes = new Uint8Array(await file.arrayBuffer())
    const prepared = await photon.prepare(bytes, imageType, {
      maxWidth: ATTACHMENT_LIMITS.imagePixels,
      maxHeight: ATTACHMENT_LIMITS.imagePixels,
      maxBytes: ATTACHMENT_LIMITS.imageBase64
    })
    if (!prepared) throw new AttachmentError(`Couldn't read ${name} as an image.`, 422)
    return { kind: "image", name, mimeType: prepared.mimeType, data: prepared.data }
  }
  if (imageType === "image/svg+xml" || extension === "svg") {
    // SVG is text a model reads well; providers don't take it as an image.
    const text = asText(new Uint8Array(await file.arrayBuffer()))
    if (text) return { kind: "text", name, mimeType: "image/svg+xml", ...text }
  }

  if (DOCUMENT_EXTENSIONS.has(extension) || declared === "application/pdf") {
    const result = await ai.toMarkdown({ name, blob: file }).catch((error: unknown) => {
      throw new AttachmentError(`Couldn't convert ${name}: ${error instanceof Error ? error.message : String(error)}`, 422)
    })
    if (result.format === "error") throw new AttachmentError(`Couldn't convert ${name}: ${result.error}`, 422)
    const text = result.data.trim()
    if (!text) throw new AttachmentError(`${name} has no text Dex could read (a scanned PDF?).`, 422)
    const truncated = text.length > ATTACHMENT_LIMITS.textChars
    return {
      kind: "text",
      name,
      mimeType: declared || result.mimeType || "application/octet-stream",
      text: truncated ? text.slice(0, ATTACHMENT_LIMITS.textChars) : text,
      converted: true,
      ...(truncated && { truncated: true })
    }
  }

  // Text and code: by type or extension, or anything else that turns out to be UTF-8 text.
  const known = TEXT_TYPES.test(declared) || TEXT_EXTENSIONS.has(extension)
  if (known || !declared || declared === "application/octet-stream") {
    const text = asText(new Uint8Array(await file.arrayBuffer()))
    if (text) return { kind: "text", name, mimeType: declared && declared !== "application/octet-stream" ? declared : "text/plain", ...text }
    if (known) throw new AttachmentError(`${name} isn't UTF-8 text.`, 422)
  }

  throw new AttachmentError(
    `Dex can't read ${extension ? `.${extension} files` : "this kind of file"} yet. Attach images, text or code, PDFs, Office documents, or web pages.`
  )
}
