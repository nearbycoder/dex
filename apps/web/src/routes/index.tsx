import { createFileRoute, redirect } from "@tanstack/react-router"
import { Landing } from "~/client/components/landing"
import { getViewer } from "~/server/viewer"

const TITLE = "Dex: your personal AI agent, with a computer of its own"
const DESCRIPTION =
  "An open-source AI agent on Cloudflare: generative UI, ClinePass and OpenCode Go models, a cloud VM per chat you can watch, skills, MCP servers, GitHub, and a phone app."

/** Signed in: straight to your chats. Otherwise, what Dex is. */
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { viewer } = await getViewer()
    if (viewer) throw redirect({ to: "/chat" })
  },
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" }
    ]
  }),
  component: Landing
})
