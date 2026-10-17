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
  authorizeUrl(options: { state: string; redirectUri: string }): Effect.Effect<string, OAuthError>
  /** Exchange the callback's code and read the signed-in user. */
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

      const authorizeUrl = Effect.fn("GitHubOAuth.authorizeUrl")(function*({ state, redirectUri }: { state: string; redirectUri: string }) {
        const { clientId } = yield* config
        const url = new URL("https://github.com/login/oauth/authorize")
        url.searchParams.set("client_id", clientId)
        url.searchParams.set("redirect_uri", redirectUri)
        url.searchParams.set("scope", "read:user")
        url.searchParams.set("state", state)
        url.searchParams.set("allow_signup", "false")
        return url.toString()
      })

      const complete = Effect.fn("GitHubOAuth.complete")(function*({ code, redirectUri }: { code: string; redirectUri: string }) {
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
        return yield* client.get("https://api.github.com/user", {
          headers: { authorization: `Bearer ${token.access_token}` }
        }).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubUser)),
          Effect.mapError((cause) => new OAuthError({ reason: "profile_failed", message: String(cause) }))
        )
      })

      return GitHubOAuth.of({ enabled: Option.isSome(github), authorizeUrl, complete })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
