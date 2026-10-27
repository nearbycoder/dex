/**
 * Files attached to a chat message. `POST /api/attachments` turns an upload into one of these (src/server/attachments.ts):
 * an image prepared for the model, or text (a text or code file as it is, a PDF or Office document converted to
 * Markdown). The app then sends it with the message (`sendMessage(chatId, text, attachments)`), and the agent checks
 * it again before the model sees it.
 *
 * A chat's messages live in rows of the agent's SQLite, which hold at most 2 MB, so a message's attachments share a
 * budget well under that.
 */
export type ChatAttachment =
  | { readonly kind: "image"; readonly name: string; readonly mimeType: string; /** Base64. */ readonly data: string }
  | {
      readonly kind: "text"
      readonly name: string
      /** The file's own type (e.g. application/pdf for a converted PDF). */
      readonly mimeType: string
      readonly text: string
      /** Converted to Markdown from a document. */
      readonly converted?: boolean
      /** Cut to the limit. */
      readonly truncated?: boolean
    }

export const ATTACHMENT_LIMITS = {
  /** Files per message. */
  files: 10,
  /** An upload's size before it's prepared. */
  uploadBytes: 25 * 1024 * 1024,
  /** One prepared image (base64 characters), and all of a message's together. */
  imageBase64: 400_000,
  imagesBase64: 1_200_000,
  /** The longest side of a prepared image. Models scale larger ones down anyway. */
  imagePixels: 1600,
  /** One text attachment, and all of a message's together. */
  textChars: 100_000,
  textsChars: 300_000,
  name: 200
} as const

/** Image types every provider takes inline. */
export const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

/** What the file picker offers (anything else is checked on upload). */
export const ATTACHMENT_ACCEPT = [
  "image/*",
  "text/*",
  "application/json",
  "application/pdf",
  ".md,.csv,.tsv,.json,.yaml,.yml,.toml,.xml,.log,.ini,.sql,.graphql",
  ".js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cc,.cpp,.hpp,.cs,.php,.sh,.zsh,.lua,.r,.scala,.dart,.vue,.svelte,.css,.scss",
  ".pdf,.docx,.xlsx,.xlsm,.xlsb,.xls,.et,.ods,.odt,.numbers,.html,.htm"
].join(",")

const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const unescapeAttribute = (value: string) => value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")

/**
 * How an attachment reads in the message the model gets: a tag naming the file, around its text, or (for an image)
 * on its own just before the image. Apps find these tags to show the files as chips instead of their contents.
 */
export const attachmentTag = (attachment: { name: string; mimeType: string; kind: "image" | "text"; converted?: boolean; truncated?: boolean }, body?: string) => {
  const attributes = [
    `name="${escapeAttribute(attachment.name)}"`,
    `type="${escapeAttribute(attachment.mimeType)}"`,
    ...(attachment.converted ? ['converted="markdown"'] : []),
    ...(attachment.truncated ? ['truncated="true"'] : [])
  ].join(" ")
  return body === undefined ? `<attachment ${attributes} />` : `<attachment ${attributes}>\n${body}\n</attachment>`
}

/** A file named in a message: what the apps show for it. */
export interface AttachedFile {
  readonly name: string
  readonly mimeType: string
}

const TAG = /<attachment ((?:[a-z]+="[^"]*"\s*)+)(?:\/>|>\n?[\s\S]*?\n?<\/attachment>)/g
const ATTRIBUTE = /([a-z]+)="([^"]*)"/g

/** A message's text without its attachment tags, and the files they name. */
export function splitAttachments(text: string): { text: string; files: AttachedFile[] } {
  const files: AttachedFile[] = []
  const rest = text.replace(TAG, (_match, attributes: string) => {
    const values = Object.fromEntries([...attributes.matchAll(ATTRIBUTE)].map(([, key, value]) => [key, unescapeAttribute(value!)]))
    files.push({ name: values.name ?? "file", mimeType: values.type ?? "application/octet-stream" })
    return ""
  })
  return { text: files.length ? rest.replace(/\n{3,}/g, "\n\n").trim() : text, files }
}

/** A short line naming the attachments, for a chat's title or a queued message that has no text. */
export const attachmentSummary = (attachments: ReadonlyArray<{ name: string }>) =>
  attachments.length === 0 ? "" : attachments.length === 1 ? attachments[0]!.name : `${attachments[0]!.name} and ${attachments.length - 1} more`
