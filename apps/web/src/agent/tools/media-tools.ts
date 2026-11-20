import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-durable"
import { MAX_VMS_PER_CHAT } from "~/shared/protocol"
import type { SharedMedia } from "../media"

const text = (value: string) => [{ type: "text" as const, text: value }]

/** Puts a video, audio file, or image from this chat's VM in front of the user, playable inline; and gets files the user attached onto the VM. */
export const mediaTools = (
  share: (chatId: string, path: string, title: string | undefined, vm: number) => Promise<SharedMedia>,
  fetchAttachment: (chatId: string, name: string, path: string | undefined, vm: number) => Promise<{ path: string; name: string; size: number; contentType: string }>
) => [
  defineTool({
    name: "get_attachment",
    description:
      "Copy a file the user attached to this chat (one shown to you as <attachment … key=\"…\">, e.g. audio, video, or an archive) onto " +
      "your VM, so you can work on it there (ffmpeg, a transcription model, unzip, Python, …). Starts the VM if needed. Returns the path.",
    parameters: Type.Object({
      name: Type.String({ maxLength: 300, description: "The attachment's name (or key), as in its tag." }),
      path: Type.Optional(Type.String({ maxLength: 500, description: "Where to put it on the VM (default /home/user/attachments/<name>)." })),
      vm: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_VMS_PER_CHAT, description: "Which of your VMs (default 1)." }))
    }),
    execute: async ({ name, path, vm }, api) => {
      try {
        const file = await fetchAttachment(String(api.conversationId), name, path, Math.min(MAX_VMS_PER_CHAT, Math.max(1, Math.round(Number(vm) || 1))))
        return { output: text(`Copied ${file.name} (${file.contentType}, ${(file.size / 1024 / 1024).toFixed(1)} MB) to ${file.path} on VM ${Math.round(Number(vm) || 1)}.`) }
      } catch (error) {
        return { output: text(error instanceof Error ? error.message : String(error)), isError: true }
      }
    }
  }),
  defineTool({
    name: "share_media",
    description:
      "Share a video, audio file, or image from your VM so it plays or shows inline in the chat: mp4/mov/webm, mp3/m4a/wav/ogg, " +
      "png/jpg/gif/webp, up to 95 MB. It's stored privately in Dex and keeps working after the VM stops. Put the returned Markdown " +
      "in your reply where it should appear. For screen recordings, record with ffmpeg (x11grab on DISPLAY=:0) and use " +
      "`-movflags +faststart` so playback starts right away.",
    parameters: Type.Object({
      path: Type.String({ description: "Path of the file on the VM, absolute or relative to /home/user." }),
      title: Type.Optional(Type.String({ maxLength: 120, description: "A short caption." })),
      vm: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_VMS_PER_CHAT, description: "Which of your VMs has the file (default 1)." }))
    }),
    execute: async ({ path, title, vm }, api) => {
      try {
        const media = await share(String(api.conversationId), path, title, Math.min(MAX_VMS_PER_CHAT, Math.max(1, Math.round(Number(vm) || 1))))
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
