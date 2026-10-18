import { getAgentByName } from "agents"
import { Effect } from "effect"
import type { DexAgent } from "~/agent/dex-agent"
import { activeViewer } from "./active-session"
import { clearCookie, isSecureRequest, readCookie, serializeCookie } from "./cookies"
import { GitHubOAuth } from "./github"
import { serverRuntime } from "./runtime"

const STATE_COOKIE = "dex_gh_connect_state"
/** What VMs need to clone private repos, push branches (including workflow files), and open pull requests. */
const SCOPE = "repo workflow read:user"

const callbackUrl = (request: Request) => new URL("/auth/github/connect/callback", request.url).toString()

const redirect = (location: string, cookies: ReadonlyArray<string> = []) => {
  const headers = new Headers({ location })
  for (const cookie of cookies) headers.append("set-cookie", cookie)
  return new Response(null, { status: 302, headers })
}

const backToSettings = (query: string, cookies: ReadonlyArray<string> = []) => redirect(`/settings?${query}`, cookies)

/**
 * "Connect with GitHub" in Settings: GitHub's OAuth flow with repo access, for the signed-in user only. The
 * resulting token goes to that user's agent, which verifies it and stores it encrypted, exactly like a pasted
 * personal access token; new VMs sign gh and git in with it.
 */
export async function startGitHubConnect(request: Request, env: Env): Promise<Response> {
  const viewer = await activeViewer(request, env)
  if (!viewer) return redirect("/login")
  const state = crypto.randomUUID()
  return serverRuntime(env).runPromise(
    GitHubOAuth.use((github) => github.authorizeUrl({ state, redirectUri: callbackUrl(request), scope: SCOPE })).pipe(
      Effect.map((url) => redirect(url, [serializeCookie(STATE_COOKIE, state, { maxAge: 600, secure: isSecureRequest(request) })])),
      Effect.catchTag("OAuthError", (error) => Effect.succeed(backToSettings(`github_error=${encodeURIComponent(error.message)}`)))
    )
  )
}

export async function finishGitHubConnect(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const clearState = clearCookie(STATE_COOKIE, isSecureRequest(request))
  const fail = (message: string) => backToSettings(`github_error=${encodeURIComponent(message)}`, [clearState])
  if (url.searchParams.has("error")) return fail(url.searchParams.get("error_description") ?? "GitHub access was cancelled.")
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!code || !state || state !== readCookie(request.headers.get("cookie"), STATE_COOKIE)) return fail("That GitHub sign-in expired. Try again.")
  // The token is stored for whoever is signed in now, so the session must still be current.
  const viewer = await activeViewer(request, env)
  if (!viewer) return redirect("/login", [clearState])

  const exchanged = await serverRuntime(env).runPromise(
    GitHubOAuth.use((github) => github.exchange({ code, redirectUri: callbackUrl(request) })).pipe(
      Effect.map((token) => ({ ok: true as const, token })),
      Effect.catchTag("OAuthError", (error) => Effect.succeed({ ok: false as const, error: error.message }))
    )
  )
  if (!exchanged.ok) return fail(exchanged.error)
  const agent = await getAgentByName(env.DexAgent as unknown as DurableObjectNamespace<DexAgent>, viewer.id)
  const result = (await agent.connectGitHub(exchanged.token, "oauth")) as { ok: true; login: string } | { ok: false; error: string }
  return result.ok ? backToSettings(`github=connected`, [clearState]) : fail(result.error)
}
