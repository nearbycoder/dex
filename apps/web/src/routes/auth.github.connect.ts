import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { startGitHubConnect } from "~/server/github-connect"

export const Route = createFileRoute("/auth/github/connect")({
  server: { handlers: { GET: ({ request }) => startGitHubConnect(request, env) } }
})
