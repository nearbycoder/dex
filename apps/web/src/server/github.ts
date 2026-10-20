import { Context, Effect, flow, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { AppConfig } from "./config"

export class OAuthError extends Schema.TaggedError<OAuthError>()("OAuthError", {
  reason: Schema.Literals(["not_configured", "exchange_failed", "profile_failed"]),
  message: Schema.String
}) {}

class TokenResponse extends Schema.Class<TokenResponse>("TokenResponse")({
  access_token: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String)
}) {}

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
  exchange(options: { code: string; redirectUri: string }): Effect.Effect<string, OAuthError>
  /** Revoke one access token at GitHub (only that token; the user's other tokens for Dex keep working). */
  revoke(accessToken: string): Effect.Effect<void>
  /** Exchange the callback's code, read the signed-in user, and revoke the token (sign-in needs it only once). */
  complete(options: { code: string; redirectUri: string }): Effect.Effect<GitHubUser, OAuthError>
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

      const exchange = Effect.fn("GitHubOAuth.exchange")(function*({ code, redirectUri }: { code: string; redirectUri: string }) {
        const { clientId, clientSecret } = yield* config
        const token = yield* HttpClientRequest.post("https://github.com/login/oauth/access_token").pipe(
          HttpClientRequest.bodyUrlParams({
            client_id: clientId,
            client_secret: Redacted.value(clientSecret),
            code,
            redirect_uri: redirectUri
          }),
          client.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(TokenResponse)),
          Effect.mapError((cause) => new OAuthError({ reason: "exchange_failed", message: String(cause) }))
        )
        if (!token.access_token) {
          return yield* new OAuthError({
            reason: "exchange_failed",
            message: token.error_description ?? token.error ?? "GitHub returned no access token"
          })
        }
        return token.access_token
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
          Effect.ignore
        )

      // GitHub keeps at most ten tokens per user and scope set for an app and revokes older ones past that. Sign-in
      // and Settings' GitHub connection share this app (and a sign-in token can carry every scope the user granted
      // it), so a sign-in token left alive would eventually cost the connection its token.
      const complete = Effect.fn("GitHubOAuth.complete")(function*({ code, redirectUri }: { code: string; redirectUri: string }) {
        const accessToken = yield* exchange({ code, redirectUri })
        return yield* client.get("https://api.github.com/user", {
          headers: { authorization: `Bearer ${accessToken}` }
        }).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubUser)),
          Effect.mapError((cause) => new OAuthError({ reason: "profile_failed", message: String(cause) })),
          Effect.ensuring(revoke(accessToken))
        )
      })

      return GitHubOAuth.of({ enabled: Option.isSome(github), authorizeUrl, exchange, revoke, complete })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
