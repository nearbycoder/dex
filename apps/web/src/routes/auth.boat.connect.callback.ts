import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { finishBoatConnect } from "~/server/boat-connect"

export const Route = createFileRoute("/auth/boat/connect/callback")({
  server: { handlers: { GET: ({ request }) => finishBoatConnect(request, env) } }
})
