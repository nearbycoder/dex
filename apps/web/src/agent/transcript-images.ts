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

/**
 * A chat's snapshot without its screenshots' bytes: each large image keeps its type and gets a `ref` the page
 * loads it by when it's shown (they sit in collapsed tool steps, and a long VM session can carry megabytes).
 */
export function withoutImages(snapshot: SnapshotEvent): SnapshotEvent {
  let changed = false
  const entries = snapshot.entries.map((entry) => {
    const messages = messagesOf(entry)
    if (!messages.some((message) => Array.isArray(message.content) && message.content.some(isLargeImage))) return entry
    changed = true
    const model = messages.map((message, m) =>
      Array.isArray(message.content)
        ? {
            ...message,
            content: message.content.map((part: unknown, index: number) =>
              isLargeImage(part) ? { type: "image", mimeType: part.mimeType, data: "", ref: `${String(entry.id)}:${m}:${index}` } : part
            )
          }
        : message
    )
    return { ...entry, model } as unknown as typeof entry
  })
  return changed ? { ...snapshot, entries } : snapshot
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
