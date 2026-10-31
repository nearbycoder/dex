import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-durable"
import type { SharedMedia } from "../media"

const text = (value: string) => [{ type: "text" as const, text: value }]

export interface ImageToolOptions {
  readonly prompt: string
  readonly shape: "square" | "portrait" | "landscape"
  readonly transparent: boolean
  readonly quality: "low" | "medium" | "high"
  /** /api/media/… links of this chat's images to work from. */
  readonly references: ReadonlyArray<string>
}

/** Makes an image on the user's ChatGPT plan and puts it in the chat. */
export const imageTools = (generate: (chatId: string, options: ImageToolOptions) => Promise<SharedMedia & { revisedPrompt: string | null }>) => [
  defineTool({
    name: "generate_image",
    description:
      "Make an image from a description with OpenAI's image model, on the user's ChatGPT plan: illustrations, avatars and " +
      "profile pictures, icons, logos, concept art, diagrams-as-art, photos of things that don't exist. Describe subject, " +
      "style, composition, colors, and any text exactly. To edit or restyle an image already in this chat (one you made, " +
      "or one shared with share_media), pass its /api/media/… link in `references`. It takes 20–60 seconds. Put the " +
      "returned Markdown in your reply to show it. Each image counts against the user's plan, so make one at a time " +
      "unless asked for several.",
    parameters: Type.Object({
      prompt: Type.String({ minLength: 3, maxLength: 4_000, description: "What to make, in detail." }),
      shape: Type.Optional(Type.Union([Type.Literal("square"), Type.Literal("portrait"), Type.Literal("landscape")], { description: "Default square." })),
      transparent: Type.Optional(Type.Boolean({ description: "A transparent background (stickers, icons, logos)." })),
      quality: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")], { description: "Default medium; high is slower." })),
      references: Type.Optional(Type.Array(Type.String({ maxLength: 300 }), { maxItems: 4, description: "This chat's images to work from, as /api/media/… links." }))
    }),
    execute: async ({ prompt, shape, transparent, quality, references }, api) => {
      try {
        const image = await generate(String(api.conversationId), {
          prompt,
          shape: shape ?? "square",
          transparent: transparent ?? false,
          quality: quality ?? "medium",
          references: references ?? []
        })
        const markdown = `![${image.name.replace(/[[\]]/g, "")}](${image.url})`
        return {
          output: text(`Made the image${image.revisedPrompt ? ` (the image model read the prompt as: ${image.revisedPrompt.slice(0, 400)})` : ""}. Put this in your reply to show it:\n${markdown}`),
          details: { media: { url: image.url, name: image.name, kind: image.kind } }
        }
      } catch (error) {
        return { output: text(error instanceof Error ? error.message : String(error)), isError: true }
      }
    }
  })
]
