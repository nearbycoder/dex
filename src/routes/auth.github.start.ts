import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { startGitHubLogin } from "~/server/auth"
import { serverRuntime } from "~/server/runtime"

export const Route = createFileRoute("/auth/github/start")({
  server: {
    handlers: {
      GET: ({ request }) => serverRuntime(env).runPromise(startGitHubLogin(request))
    }
  }
})
