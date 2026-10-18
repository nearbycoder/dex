import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { finishGitHubLogin } from "~/server/auth"
import { serverRuntime } from "~/server/runtime"

export const Route = createFileRoute("/auth/github/callback")({
  server: {
    handlers: {
      GET: ({ request }) => serverRuntime(env).runPromise(finishGitHubLogin(request))
    }
  }
})
