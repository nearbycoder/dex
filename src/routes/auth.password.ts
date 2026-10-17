import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { passwordLogin } from "~/server/auth"
import { serverRuntime } from "~/server/runtime"

export const Route = createFileRoute("/auth/password")({
  server: {
    handlers: {
      POST: ({ request }) => serverRuntime(env).runPromise(passwordLogin(request))
    }
  }
})
