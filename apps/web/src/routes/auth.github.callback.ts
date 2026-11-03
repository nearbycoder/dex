import { createFileRoute } from "@tanstack/react-router"
import { getAgentByName } from "agents"
import { env } from "cloudflare:workers"
import type { DexAgent } from "~/agent/dex-agent"
import { finishGitHubLogin } from "~/server/auth"
import { serverRuntime } from "~/server/runtime"

/** Is this the token the user's GitHub connection uses? Then signing in must not revoke it. */
const connectionToken = async (token: string, userId: string) => {
  const agent = await getAgentByName(env.DexAgent as unknown as DurableObjectNamespace<DexAgent>, userId)
  return Boolean(await agent.isGitHubConnectionToken(token))
}

export const Route = createFileRoute("/auth/github/callback")({
  server: {
    handlers: {
      GET: ({ request }) => serverRuntime(env).runPromise(finishGitHubLogin(request, connectionToken))
    }
  }
})
