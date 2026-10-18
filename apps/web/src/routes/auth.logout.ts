import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { logout } from "~/server/auth"
import { serverRuntime } from "~/server/runtime"

export const Route = createFileRoute("/auth/logout")({
  server: {
    handlers: {
      POST: ({ request }) => serverRuntime(env).runPromise(logout(request))
    }
  }
})
