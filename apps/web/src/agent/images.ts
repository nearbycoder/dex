import { CHATGPT_BASE_URL } from "./chatgpt"

/**
 * Image generation on the user's ChatGPT plan: OpenAI's Responses API with its built-in image_generation tool, the
 * same API and Sign in with ChatGPT token the chats use. Requests are shaped the way those tokens accept (streamed,
 * not stored, no token limits), like pi-ai's own.
 */

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto"
export type ImageQuality = "low" | "medium" | "high" | "auto"

export interface ImageRequest {
  readonly prompt: string
  readonly size?: ImageSize
  /** Transparent needs png or webp. */
  readonly background?: "transparent" | "opaque" | "auto"
  readonly quality?: ImageQuality
  readonly format?: "png" | "webp" | "jpeg"
  /** 0–100, for webp and jpeg: lower is smaller. */
  readonly compression?: number
  /** Pictures to work from (edit, restyle, or keep a likeness), as base64 with their type. */
  readonly references?: ReadonlyArray<{ readonly data: string; readonly mimeType: string }>
}

export interface GeneratedImage {
  readonly bytes: Uint8Array
  readonly mimeType: string
  /** How the image model rewrote the prompt, when it did. */
  readonly revisedPrompt: string | null
}

/** Chat models that can call the image tool, best first; the first the plan accepts is used. */
export const IMAGE_HOST_MODELS = ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-sol", "gpt-5.6-terra"] as const

export class ImageError extends Error {
  constructor(message: string, readonly retryWithAnotherModel = false) {
    super(message)
  }
}

const decode = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

/** One image from a prompt (and optional reference pictures), on the plan behind `token`. */
export async function generateImage(token: string, request: ImageRequest, models: ReadonlyArray<string> = IMAGE_HOST_MODELS): Promise<GeneratedImage> {
  let last: Error = new ImageError("No model could make the image.")
  for (const model of models) {
    try {
      return await generateWith(token, model, request)
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error))
      if (!(error instanceof ImageError && error.retryWithAnotherModel)) throw last
    }
  }
  throw last
}

async function generateWith(token: string, model: string, request: ImageRequest): Promise<GeneratedImage> {
  const format = request.format ?? "png"
  const response = await fetch(`${CHATGPT_BASE_URL}/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({
      model,
      instructions: "Make the image the user describes, with the image_generation tool. Follow the description closely; never add text or watermarks unless asked.",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: request.prompt },
            ...(request.references ?? []).map((image) => ({ type: "input_image", image_url: `data:${image.mimeType};base64,${image.data}` }))
          ]
        }
      ],
      tools: [
        {
          type: "image_generation",
          size: request.size ?? "1024x1024",
          quality: request.quality ?? "auto",
          background: request.background ?? "auto",
          output_format: format,
          ...(format !== "png" && request.compression !== undefined && { output_compression: Math.round(request.compression) })
        }
      ],
      tool_choice: { type: "image_generation" },
      stream: true,
      store: false
    })
  })
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: string } }
    const message = body.error?.message ?? `OpenAI answered ${response.status}`
    if (response.status === 401) throw new ImageError("ChatGPT sign-in expired. Sign in again in Settings.")
    if (response.status === 429) throw new ImageError(`Your ChatGPT plan's image limit was reached for now. ${message}`)
    // A model this plan doesn't offer, or one that can't call the image tool: try the next.
    throw new ImageError(message, response.status === 400 || response.status === 404 || response.status === 403)
  }

  // Server-sent events: the finished image arrives as an image_generation_call output item.
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  let failure: string | null = null
  const image = await (async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return null
      buffer += value
      let end: number
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("")
        if (!data || data === "[DONE]") continue
        let event: { type?: string; item?: { type?: string; result?: string; revised_prompt?: string }; response?: { error?: { message?: string } }; message?: string; error?: { message?: string } }
        try {
          event = JSON.parse(data)
        } catch {
          continue
        }
        if (event.type === "response.output_item.done" && event.item?.type === "image_generation_call" && event.item.result) {
          void reader.cancel().catch(() => undefined)
          return { result: event.item.result, revised: event.item.revised_prompt ?? null }
        }
        if (event.type === "response.failed" || event.type === "error") {
          failure = event.response?.error?.message ?? event.error?.message ?? event.message ?? "The image couldn't be made."
        }
      }
    }
  })()
  if (!image) throw new ImageError(failure ?? "The model answered without an image. Try describing it differently.")
  return { bytes: decode(image.result), mimeType: `image/${format}`, revisedPrompt: image.revised }
}

/** How to ask for a sidekick's picture: their description, in a style that reads as a small round avatar. */
export const sidekickPicturePrompt = (description: string, style: string, background: string) =>
  [
    `A character portrait for a chat app avatar: ${description.trim()}.`,
    `Style: ${style}.`,
    `Head and shoulders, centered, facing the viewer with a friendly expression, filling most of a square frame so it reads at small sizes in a circle.`,
    `Plain solid ${background} background, no scenery, no text, no border.`
  ].join(" ")

export const AVATAR_STYLES: Readonly<Record<string, string>> = {
  illustration: "clean flat vector illustration, bold simple shapes, soft shading",
  "3d": "cute 3D render, soft clay-like materials, studio lighting",
  pixel: "detailed pixel art, 64x64 sprite style, crisp pixels",
  anime: "anime character art, clean line art, cel shading",
  watercolor: "soft watercolor painting, gentle textures",
  photo: "photorealistic portrait photograph, shallow depth of field"
}
