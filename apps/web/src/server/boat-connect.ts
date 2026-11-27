import { getAgentByName } from "agents"
import type { DexAgent } from "~/agent/dex-agent"
import { activeViewer } from "./active-session"
import { boatOAuthConfig, buildBoatAuthorizeUrl, constantTimeEqual, createPkcePair, exchangeBoatCode, fetchBoatAccount, revokeBoatToken } from "./boat-oauth"
import { clearCookie, isSecureRequest, readCookie, serializeCookie } from "./cookies"

const STATE_COOKIE = "dex_boat_connect_state"

const callbackUrl = (request: Request) => new URL("/auth/boat/connect/callback", request.url).toString()

const redirect = (location: string, cookies: ReadonlyArray<string> = []) => {
  const headers = new Headers({ location })
  for (const cookie of cookies) headers.append("set-cookie", cookie)
  return new Response(null, { status: 302, headers })
}

const backToSettings = (query: string, cookies: ReadonlyArray<string> = []) => redirect(`/settings?${query}`, cookies)

/**
 * "Sign in with boat.dev" in Settings: OAuth 2.0 + PKCE (S256) flow for the signed-in user only.
 * Exchanges the code server-side and stores encrypted rotating tokens in the user's DexAgent.
 */
export async function startBoatConnect(request: Request, env: Env): Promise<Response> {
  const viewer = await activeViewer(request, env)
  if (!viewer) return redirect("/login")
  const config = boatOAuthConfig(env as unknown as Record<string, unknown>)
  if (!config) return backToSettings(`boat_error=${encodeURIComponent("Sign in with boat.dev is not configured on this deployment.")}`)

  const state = crypto.randomUUID()
  const pkce = await createPkcePair()
  const authorizeUrl = buildBoatAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: callbackUrl(request),
    state,
    codeChallenge: pkce.challenge
  })
  // Bind state and PKCE verifier together in an HttpOnly cookie; never exposed to JS or the URL.
  const cookieValue = `${state}.${pkce.verifier}`
  return redirect(authorizeUrl, [serializeCookie(STATE_COOKIE, cookieValue, { maxAge: 600, secure: isSecureRequest(request) })])
}

export async function finishBoatConnect(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const clearState = clearCookie(STATE_COOKIE, isSecureRequest(request))
  const fail = (message: string) => backToSettings(`boat_error=${encodeURIComponent(message)}`, [clearState])

  if (url.searchParams.has("error")) {
    const desc = url.searchParams.get("error_description")
    const code = url.searchParams.get("error")
    return fail(desc || (code === "access_denied" ? "boat.dev sign-in was cancelled." : `boat.dev error: ${code}`))
  }

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const stored = readCookie(request.headers.get("cookie"), STATE_COOKIE)
  const dot = stored?.indexOf(".") ?? -1
  const cookieState = dot > 0 ? stored!.slice(0, dot) : ""
  const codeVerifier = dot > 0 ? stored!.slice(dot + 1) : ""

  if (!code || !state || !cookieState || !codeVerifier || !constantTimeEqual(state, cookieState)) {
    return fail("That boat.dev sign-in expired. Try again.")
  }

  const viewer = await activeViewer(request, env)
  if (!viewer) return redirect("/login", [clearState])

  const config = boatOAuthConfig(env as unknown as Record<string, unknown>)
  if (!config) return fail("Sign in with boat.dev is not configured on this deployment.")

  const exchanged = await exchangeBoatCode({
    ...config,
    code,
    redirectUri: callbackUrl(request),
    codeVerifier
  })
  if (!exchanged.ok) return fail(exchanged.error)

  const account = await fetchBoatAccount(exchanged.grant.accessToken)
  const agent = await getAgentByName(env.DexAgent as unknown as DurableObjectNamespace<DexAgent>, viewer.id)
  const result = await agent.connectBoatGrant(exchanged.grant, account).catch((cause: unknown) => ({
    ok: false as const,
    error: cause instanceof Error ? cause.message : "Could not save the boat.dev connection."
  }))
  if (!result.ok) {
    // Don't leave an unused OAuth grant dangling at boat.dev if the agent rejected the switch (e.g. active VMs).
    if (exchanged.grant.refreshToken) void revokeBoatToken(exchanged.grant.refreshToken)
    return fail(result.error)
  }
  return backToSettings("boat=connected", [clearState])
}
