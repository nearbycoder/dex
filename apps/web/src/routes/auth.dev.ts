import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { devLogin } from "~/server/auth"
import { serverRuntime } from "~/server/runtime"

export const Route = createFileRoute("/auth/dev")({
  server: {
    handlers: {
      POST: ({ request }) => {
        if (request.headers.get("origin") !== new URL(request.url).origin) {
          return new Response("Cross-origin sign-in is not allowed", { status: 403, headers: { "cache-control": "no-store" } })
        }
        return serverRuntime(env).runPromise(devLogin(request))
      }
    }
  }
})
