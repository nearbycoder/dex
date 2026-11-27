export const BOAT_AUTHORIZE_URL = "https://boat.dev/api/boat/oauth2/authorize"
export const BOAT_TOKEN_URL = "https://boat.dev/api/boat/oauth2/token"
export const BOAT_REVOKE_URL = "https://boat.dev/api/boat/oauth2/revoke"
export const BOAT_ME_URL = "https://boat.dev/api/v1/me"

/**
 * Minimal OAuth scopes Dex needs to run, inspect, host ports on, stream desktops from,
 * and manage named VM template snapshots for sandboxes in the user's boat.dev account.
 */
export const BOAT_OAUTH_SCOPES = [
  "account.read",
  "sandbox.read",
  "sandbox.create",
  "sandbox.resume",
  "sandbox.update",
  "sandbox.stop",
  "sandbox.delete-own",
  "exec",
  "file.read",
  "file.write",
  "desktop",
  "host",
  "snapshot.read",
  "snapshot.write"
].join(" ")

export interface BoatOAuthGrant {
  readonly accessToken: string
  readonly refreshToken: string | null
  /** Epoch ms when the access token expires (boat access tokens last 1 hour). */
  readonly expiresAt: number | null
  readonly scope: string | null
}

export interface BoatOAuthClientConfig {
  readonly clientId: string
  readonly clientSecret?: string | null
}

const UTF8 = new TextEncoder()

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

/** Generates an RFC 7636 PKCE verifier and S256 challenge. */
export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(48))
  const verifier = base64url(bytes)
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", UTF8.encode(verifier)))
  return { verifier, challenge: base64url(digest) }
}

/** Constant-time string comparison for OAuth CSRF state checks. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function buildBoatAuthorizeUrl(options: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  scope?: string
}): string {
  const url = new URL(BOAT_AUTHORIZE_URL)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", options.clientId)
  url.searchParams.set("redirect_uri", options.redirectUri)
  url.searchParams.set("scope", options.scope ?? BOAT_OAUTH_SCOPES)
  url.searchParams.set("state", options.state)
  url.searchParams.set("code_challenge", options.codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  return url.toString()
}

interface TokenPayload {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

const parseGrant = (body: TokenPayload): BoatOAuthGrant | null => {
  if (!body.access_token) return null
  const expiresAt = typeof body.expires_in === "number" && Number.isFinite(body.expires_in) ? Date.now() + body.expires_in * 1000 : null
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
    expiresAt,
    scope: typeof body.scope === "string" ? body.scope : null
  }
}

/** Exchanges an authorization code + PKCE verifier for boat.dev access & refresh tokens. */
export async function exchangeBoatCode(
  options: BoatOAuthClientConfig & { code: string; redirectUri: string; codeVerifier: string }
): Promise<{ ok: true; grant: BoatOAuthGrant } | { ok: false; error: string }> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.codeVerifier,
    client_id: options.clientId
  })
  if (options.clientSecret) params.set("client_secret", options.clientSecret)

  const response = await fetch(BOAT_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": "dex" },
    body: params.toString(),
    signal: AbortSignal.timeout(15_000)
  }).catch(() => null)
  if (!response) return { ok: false, error: "Couldn't reach boat.dev to finish sign-in. Try again." }
  const body = (await response.json().catch(() => ({}))) as TokenPayload
  if (!response.ok) {
    return { ok: false, error: body.error_description ?? body.error ?? `boat.dev returned ${response.status} while exchanging code.` }
  }
  const grant = parseGrant(body)
  if (!grant) return { ok: false, error: body.error_description ?? body.error ?? "boat.dev returned no access token." }
  return { ok: true, grant }
}

/**
 * Refreshes a rotating boat.dev refresh token. Callers MUST serialize refresh calls per connection
 * because boat.dev invalidates the connection if an old refresh token is reused after 1 minute.
 */
export async function refreshBoatGrant(
  options: BoatOAuthClientConfig & { refreshToken: string }
): Promise<{ ok: true; grant: BoatOAuthGrant } | { ok: false; rejected: boolean; error: string }> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: options.refreshToken,
    client_id: options.clientId
  })
  if (options.clientSecret) params.set("client_secret", options.clientSecret)

  const response = await fetch(BOAT_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": "dex" },
    body: params.toString(),
    signal: AbortSignal.timeout(15_000)
  }).catch(() => null)
  if (!response) return { ok: false, rejected: false, error: "Couldn't reach boat.dev to refresh the session." }
  const body = (await response.json().catch(() => ({}))) as TokenPayload
  if (!response.ok) {
    const rejected = response.status === 400 || response.status === 401 || body.error === "invalid_grant" || body.error === "invalid_client"
    return { ok: false, rejected, error: body.error_description ?? body.error ?? `boat.dev returned ${response.status}` }
  }
  const grant = parseGrant(body)
  if (!grant) return { ok: false, rejected: true, error: body.error_description ?? body.error ?? "boat.dev returned no access token." }
  return { ok: true, grant }
}

/** Best-effort revocation of a boat.dev OAuth refresh token when disconnecting or rotating connections. */
export async function revokeBoatToken(token: string): Promise<void> {
  if (!token) return
  const params = new URLSearchParams({ token })
  await fetch(BOAT_REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "dex" },
    body: params.toString(),
    signal: AbortSignal.timeout(10_000)
  })
    .then((res) => res.body?.cancel())
    .catch(() => undefined)
}

/** Reads a human-friendly account label from `GET https://boat.dev/api/v1/me` (email, handle, or name). */
export async function fetchBoatAccount(accessToken: string): Promise<string | null> {
  const response = await fetch(BOAT_ME_URL, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", "user-agent": "dex" },
    signal: AbortSignal.timeout(10_000)
  }).catch(() => null)
  if (!response || !response.ok) {
    void response?.body?.cancel()
    return null
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== "object") return null
  const user = (typeof body.user === "object" && body.user !== null ? (body.user as Record<string, unknown>) : body) as Record<string, unknown>
  for (const key of ["email", "username", "login", "handle", "name"]) {
    const value = user[key]
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120)
  }
  return null
}

export function boatOAuthConfig(env: Record<string, unknown>): BoatOAuthClientConfig | null {
  const clientId = typeof env.BOAT_CLIENT_ID === "string" ? env.BOAT_CLIENT_ID.trim() : ""
  if (!clientId) return null
  const rawSecret = typeof env.BOAT_CLIENT_SECRET === "string" ? env.BOAT_CLIENT_SECRET.trim() : ""
  return { clientId, clientSecret: rawSecret || null }
}
