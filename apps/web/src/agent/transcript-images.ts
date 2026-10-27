import type { SnapshotEvent } from "@earendil-works/pi-durable"

/** Images bigger than this (base64 characters) are left out of transcripts sent to the browser. */
const LARGE = 4_000

interface ImagePart {
  type: "image"
  data: string
  mimeType: string
  /** Set when `data` was left out: `<entry id>:<content index>`, for loading it on demand. */
  ref?: string
}

const isLargeImage = (part: unknown): part is ImagePart =>
  typeof part === "object" && part !== null && (part as ImagePart).type === "image" && typeof (part as ImagePart).data === "string" && (part as ImagePart).data.length > LARGE

type Message = { content?: unknown }

const messagesOf = (entry: unknown): readonly Message[] => {
  const model = (entry as { model?: unknown }).model
  return Array.isArray(model) ? (model as Message[]) : []
}

/** A tool's output beyond this many characters isn't sent to the browser (the end is kept: that's where results are). */
const MAX_OUTPUT = 12_000
/** Tool results the page never shows in full: what they are, instead of their text. */
const SUMMARIZED: Readonly<Record<string, string>> = {
  load_ui_guide: "(Dex's generative UI guide, for the model; not shown here)"
}

type TextPart = { type: "text"; text: string }
/** An attachment tag with the file's text inside. */
const ATTACHMENT_BODY = /^(<attachment (?:[a-z]+="[^"]*"\s*)+)>\n[\s\S]*\n<\/attachment>$/
const isText = (part: unknown): part is TextPart =>
  typeof part === "object" && part !== null && (part as TextPart).type === "text" && typeof (part as TextPart).text === "string"

/**
 * An entry as the browser needs it: screenshots' bytes left out (each keeps its type and gets a `ref` the page loads
 * it by when shown: they sit in collapsed tool steps, and a long VM session carries megabytes), long tool outputs cut
 * to their end, the UI guide summarized, attached files' text left out (the page shows their names), and the system
 * prompt (which the page never shows) left out. Together these
 * were most of what opening a chat sent.
 */
export function slimEntry<E>(entry: E): E {
  const kind = (entry as { kind?: unknown }).kind
  if (kind === "pi.system") return { ...entry, model: [] }
  const messages = messagesOf(entry)
  let changed = false
  const model = messages.map((message, m) => {
    if (!Array.isArray(message.content)) return message
    const toolName = (message as { toolName?: unknown }).toolName
    const summary = typeof toolName === "string" ? SUMMARIZED[toolName] : undefined
    const content = message.content.map((part: unknown, index: number) => {
      if (isLargeImage(part)) {
        changed = true
        return { type: "image", mimeType: part.mimeType, data: "", ref: `${String((entry as { id?: unknown }).id)}:${m}:${index}` }
      }
      // A file attached to a message: the page shows its name, never its text (see shared/attachments.ts).
      if ((message as { role?: unknown }).role === "user" && isText(part) && part.text.startsWith("<attachment ")) {
        const tagOnly = part.text.replace(ATTACHMENT_BODY, "$1 />")
        if (tagOnly !== part.text) {
          changed = true
          return { type: "text", text: tagOnly }
        }
      }
      if ((message as { role?: unknown }).role === "toolResult" && isText(part)) {
        if (summary) {
          changed = true
          return { type: "text", text: summary }
        }
        if (part.text.length > MAX_OUTPUT) {
          changed = true
          return { type: "text", text: `… [${part.text.length - MAX_OUTPUT} earlier characters not shown]\n${part.text.slice(-MAX_OUTPUT)}` }
        }
      }
      return part
    })
    return { ...message, content }
  })
  return changed ? ({ ...entry, model } as E) : entry
}

/** A chat's snapshot as the browser needs it (see slimEntry). */
export function withoutImages(snapshot: SnapshotEvent): SnapshotEvent {
  return { ...snapshot, entries: snapshot.entries.map(slimEntry) }
}

/** Live events as the browser needs them: entries they carry are slimmed like the snapshot's. */
export function slimEvents<T>(events: readonly T[]): readonly T[] {
  return events.map((event) => {
    const entry = (event as { entry?: unknown }).entry
    return entry && typeof entry === "object" ? ({ ...event, entry: slimEntry(entry) } as T) : event
  })
}

/** The image a `ref` from withoutImages points to. */
export function findImage(snapshot: SnapshotEvent, ref: string): { data: string; mimeType: string } | null {
  const [index, m, ...rest] = ref.split(":").reverse()
  const id = rest.reverse().join(":")
  const entry = snapshot.entries.find((candidate) => String(candidate.id) === id)
  const content = entry ? messagesOf(entry)[Number(m)]?.content : undefined
  const part = Array.isArray(content) ? (content[Number(index)] as unknown) : undefined
  return isLargeImage(part) ? { data: part.data, mimeType: part.mimeType } : null
}
