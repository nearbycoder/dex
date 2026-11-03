import { Context, Effect, flow, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { AppConfig } from "./config"

export class OAuthError extends Schema.TaggedError<OAuthError>()("OAuthError", {
  reason: Schema.Literals(["not_configured", "exchange_failed", "profile_failed", "refresh_rejected", "refresh_failed"]),
  message: Schema.String
}) {}

class TokenResponse extends Schema.Class<TokenResponse>("TokenResponse")({
  access_token: Schema.optional(Schema.String),
  // Only when the OAuth app has "Expire user authorization tokens" on: the access token then lasts eight hours.
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
  refresh_token_expires_in: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String)
}) {}

/** An access token, and for an expiring one the refresh token that renews it (GitHub rotates both on every renewal). */
export interface GitHubGrant {
  readonly accessToken: string
  readonly refreshToken: string | null
  /** When the access token stops working (ms), or null when it doesn't expire. */
  readonly expiresAt: number | null
  readonly refreshExpiresAt: number | null
}

export class GitHubUser extends Schema.Class<GitHubUser>("GitHubUser")({
  id: Schema.Number,
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatar_url: Schema.NullOr(Schema.String)
}) {}

/** GitHub's web application OAuth flow. */
export class GitHubOAuth extends Context.Service<GitHubOAuth, {
  readonly enabled: boolean
  /** `scope` defaults to reading the profile (sign-in); connecting GitHub for VMs asks for repo access. */
  authorizeUrl(options: { state: string; redirectUri: string; scope?: string }): Effect.Effect<string, OAuthError>
  /** Exchange the callback's code for an access token. */
  exchange(options: { code: string; redirectUri: string }): Effect.Effect<GitHubGrant, OAuthError>
  /** Renew an expiring token. `refresh_rejected`: GitHub no longer accepts the refresh token (connect again). */
  refresh(refreshToken: string): Effect.Effect<GitHubGrant, OAuthError>
  /** Revoke one access token at GitHub (only that token; the user's other tokens for Dex keep working). */
  revoke(accessToken: string): Effect.Effect<void>
  /**
   * Exchange the callback's code, read the signed-in user, and revoke the token (sign-in needs it only once) unless
   * `keep` says it is one Dex still uses.
   */
  complete(options: { code: string; redirectUri: string; keep?: (accessToken: string, user: GitHubUser) => Promise<boolean> }): Effect.Effect<GitHubUser, OAuthError>
}>()("dex/server/GitHubOAuth") {
  static readonly layer = Layer.effect(
    GitHubOAuth,
    Effect.gen(function*() {
      const { github } = yield* AppConfig
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(flow(HttpClientRequest.acceptJson, HttpClientRequest.setHeader("user-agent", "dex"))),
        HttpClient.filterStatusOk
      )

      const config = Effect.fromOption(github).pipe(
        Effect.mapError(() => new OAuthError({ reason: "not_configured", message: "GitHub sign-in is not configured" }))
      )

      const authorizeUrl = Effect.fn("GitHubOAuth.authorizeUrl")(function*({ state, redirectUri, scope = "read:user" }: { state: string; redirectUri: string; scope?: string }) {
        const { clientId } = yield* config
        const url = new URL("https://github.com/login/oauth/authorize")
        url.searchParams.set("client_id", clientId)
        url.searchParams.set("redirect_uri", redirectUri)
        url.searchParams.set("scope", scope)
        url.searchParams.set("state", state)
        url.searchParams.set("allow_signup", "false")
        return url.toString()
      })

      const tokenRequest = (params: Record<string, string>) =>
        config.pipe(
          Effect.flatMap(({ clientId, clientSecret }) =>
            HttpClientRequest.post("https://github.com/login/oauth/access_token").pipe(
              HttpClientRequest.bodyUrlParams({ client_id: clientId, client_secret: Redacted.value(clientSecret), ...params }),
              client.execute,
              Effect.flatMap(HttpClientResponse.schemaBodyJson(TokenResponse))
            )
          )
        )

      const toGrant = (token: TokenResponse, accessToken: string): GitHubGrant => {
        const now = Date.now()
        return {
          accessToken,
          refreshToken: token.refresh_token ?? null,
          expiresAt: token.expires_in ? now + token.expires_in * 1000 : null,
          refreshExpiresAt: token.refresh_token_expires_in ? now + token.refresh_token_expires_in * 1000 : null
        }
      }

      const exchange = Effect.fn("GitHubOAuth.exchange")(function*({ code, redirectUri }: { code: string; redirectUri: string }) {
        const token = yield* tokenRequest({ code, redirect_uri: redirectUri }).pipe(
          Effect.mapError((cause) => cause instanceof OAuthError ? cause : new OAuthError({ reason: "exchange_failed", message: String(cause) }))
        )
        if (!token.access_token) {
          return yield* new OAuthError({
            reason: "exchange_failed",
            message: token.error_description ?? token.error ?? "GitHub returned no access token"
          })
        }
        return toGrant(token, token.access_token)
      })

      const refresh = Effect.fn("GitHubOAuth.refresh")(function*(refreshToken: string) {
        const token = yield* tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }).pipe(
          Effect.timeout("15 seconds"),
          Effect.mapError((cause) => cause instanceof OAuthError ? cause : new OAuthError({ reason: "refresh_failed", message: String(cause) }))
        )
        // GitHub answers a bad refresh token with 200 and an error (bad_refresh_token, or the app's credentials).
        if (!token.access_token) {
          return yield* new OAuthError({ reason: "refresh_rejected", message: token.error_description ?? token.error ?? "GitHub returned no access token" })
        }
        return toGrant(token, token.access_token)
      })

      const revoke = (accessToken: string) =>
        config.pipe(
          Effect.flatMap(({ clientId, clientSecret }) =>
            HttpClientRequest.delete(`https://api.github.com/applications/${clientId}/token`).pipe(
              HttpClientRequest.basicAuth(clientId, clientSecret),
              HttpClientRequest.bodyJsonUnsafe({ access_token: accessToken }),
              client.execute
            )
          ),
          Effect.timeout("10 seconds"),
          // Logged: a sign-in token left alive counts toward GitHub's ten (see `complete`).
          Effect.tapError((error) => Effect.sync(() => console.warn(`GitHub didn't revoke a token: ${String(error).slice(0, 300)}`))),
          Effect.ignore
        )

      // GitHub keeps at most ten tokens per user and scope set for an app and revokes older ones past that. Sign-in
      // and Settings' GitHub connection share this app (and a sign-in token can carry every scope the user granted
      // it), so a sign-in token left alive would eventually cost the connection its token. But should GitHub ever hand
      // a sign-in the very token the connection has, revoking it would disconnect GitHub: `keep` is asked first, and a
      // failed check keeps it (one stray token beats a dead connection).
      const complete = Effect.fn("GitHubOAuth.complete")(function*({ code, redirectUri, keep }: { code: string; redirectUri: string; keep?: (accessToken: string, user: GitHubUser) => Promise<boolean> }) {
        const { accessToken } = yield* exchange({ code, redirectUri })
        const user = yield* client.get("https://api.github.com/user", {
          headers: { authorization: `Bearer ${accessToken}` }
        }).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubUser)),
          Effect.mapError((cause) => new OAuthError({ reason: "profile_failed", message: String(cause) })),
          Effect.tapError(() => revoke(accessToken))
        )
        const kept = keep ? yield* Effect.promise(() => keep(accessToken, user).catch(() => true)) : false
        if (!kept) yield* revoke(accessToken)
        return user
      })

      return GitHubOAuth.of({ enabled: Option.isSome(github), authorizeUrl, exchange, refresh, revoke, complete })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
