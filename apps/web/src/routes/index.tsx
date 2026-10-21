import { createFileRoute, redirect } from "@tanstack/react-router"
import { Landing } from "~/client/components/landing"
import { getSiteOrigin, getViewer } from "~/server/viewer"

const TITLE = "Dex: your personal AI agent, with a computer of its own"
const DESCRIPTION =
  "An open-source AI agent on Cloudflare: generative UI, ClinePass and OpenCode Go models, a cloud VM per chat you can watch, skills, MCP servers, GitHub, and native iOS and Android apps."

/** Signed in: straight to your chats. Otherwise, what Dex is. */
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { viewer } = await getViewer()
    if (viewer) throw redirect({ to: "/chat" })
  },
  // Link previews need absolute URLs, and this deployment's origin is the one being shared.
  loader: () => getSiteOrigin(),
  head: ({ loaderData: origin = "" }) => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Dex" },
      { property: "og:url", content: `${origin}/` },
      // Made from assets/og.html.
      { property: "og:image", content: `${origin}/landing/og.png` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Dex: your personal AI agent, with a computer of its own. A chat with a revenue chart and a phone showing a signups chart." },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "twitter:image", content: `${origin}/landing/og.png` }
    ]
  }),
  component: Landing
})
