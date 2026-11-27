import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { startBoatConnect } from "~/server/boat-connect"

export const Route = createFileRoute("/auth/boat/connect")({
  server: { handlers: { GET: ({ request }) => startBoatConnect(request, env) } }
})
