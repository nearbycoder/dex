import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { devLogin } from "~/server/auth"
import { serverRuntime } from "~/server/runtime"

export const Route = createFileRoute("/auth/dev")({
  server: {
    handlers: {
      POST: ({ request }) => serverRuntime(env).runPromise(devLogin(request))
    }
  }
})
