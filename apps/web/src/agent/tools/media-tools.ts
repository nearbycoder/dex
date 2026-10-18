import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-durable"
import type { SharedMedia } from "../media"

const text = (value: string) => [{ type: "text" as const, text: value }]

/** Puts a video, audio file, or image from this chat's VM in front of the user, playable inline. */
export const mediaTools = (share: (chatId: string, path: string, title?: string) => Promise<SharedMedia>) => [
  defineTool({
    name: "share_media",
    description:
      "Share a video, audio file, or image from your VM so it plays or shows inline in the chat: mp4/mov/webm, mp3/m4a/wav/ogg, " +
      "png/jpg/gif/webp, up to 95 MB. It's stored privately in Dex and keeps working after the VM stops. Put the returned Markdown " +
      "in your reply where it should appear. For screen recordings, record with ffmpeg (x11grab on DISPLAY=:0) and use " +
      "`-movflags +faststart` so playback starts right away.",
    parameters: Type.Object({
      path: Type.String({ description: "Path of the file on the VM, absolute or relative to /home/user." }),
      title: Type.Optional(Type.String({ maxLength: 120, description: "A short caption." }))
    }),
    execute: async ({ path, title }, api) => {
      try {
        const media = await share(String(api.conversationId), path, title)
        const markdown = `![${media.name.replace(/[[\]]/g, "")}](${media.url})`
        return {
          output: text(`Shared ${media.kind} (${(media.size / 1024 / 1024).toFixed(1)} MB). Put this in your reply to show it:\n${markdown}`),
          details: { media: { url: media.url, name: media.name, kind: media.kind } }
        }
      } catch (error) {
        return { output: text(error instanceof Error ? error.message : String(error)), isError: true }
      }
    }
  })
]
