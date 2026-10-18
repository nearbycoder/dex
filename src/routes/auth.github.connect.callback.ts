import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { finishGitHubConnect } from "~/server/github-connect"

export const Route = createFileRoute("/auth/github/connect/callback")({
  server: { handlers: { GET: ({ request }) => finishGitHubConnect(request, env) } }
})
