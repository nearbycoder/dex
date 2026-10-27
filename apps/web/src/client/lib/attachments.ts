import type { ChatAttachment } from "~/shared/attachments"

/** Sends one file to `/api/attachments`, which returns it ready for the model (see server/attachments.ts). */
export async function uploadAttachment(file: File, signal?: AbortSignal): Promise<ChatAttachment> {
  const form = new FormData()
  form.append("file", file, file.name || "pasted")
  const response = await fetch("/api/attachments", { method: "POST", body: form, signal })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? (response.status === 503 ? "Dex is restarting. Try again in a moment." : `Upload failed (${response.status}).`))
  }
  return (await response.json()) as ChatAttachment
}

/** A file being attached in the composer: its upload, and a preview while that runs. */
export interface DraftAttachment {
  readonly id: string
  readonly name: string
  readonly mimeType: string
  /** An object URL for an image, shown as its thumbnail. */
  readonly preview?: string
  readonly status: "uploading" | "ready" | "error"
  readonly attachment?: ChatAttachment
  readonly error?: string
}
