import { Effect, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

export class GitHubTokenError extends Schema.TaggedError<GitHubTokenError>()("GitHubTokenError", {
  message: Schema.String
}) {}

const GitHubUser = Schema.Struct({ id: Schema.Number, login: Schema.String, name: Schema.NullOr(Schema.String) })

/** The account a GitHub token belongs to, and the git identity commits on the VMs use. */
export interface GitHubIdentity {
  readonly login: string
  readonly name: string
  /** GitHub's noreply address, so commits link to the account without exposing an email. */
  readonly email: string
}

/** Checks a personal access token against GitHub's API. */
export const verifyGitHubToken = Effect.fn("verifyGitHubToken")(function*(token: string) {
  const response = yield* HttpClientRequest.get("https://api.github.com/user").pipe(
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.acceptJson,
    HttpClientRequest.setHeader("user-agent", "dex"),
    HttpClient.execute,
    Effect.mapError(() => new GitHubTokenError({ message: "Could not reach GitHub. Try again." }))
  )
  if (response.status === 401) return yield* new GitHubTokenError({ message: "GitHub rejected this token. Check that it is valid and not expired." })
  if (response.status !== 200) return yield* new GitHubTokenError({ message: `GitHub returned ${response.status}.` })
  const user = yield* HttpClientResponse.schemaBodyJson(GitHubUser)(response).pipe(
    Effect.mapError(() => new GitHubTokenError({ message: "GitHub returned an unexpected response." }))
  )
  return { login: user.login, name: user.name ?? user.login, email: `${user.id}+${user.login}@users.noreply.github.com` } satisfies GitHubIdentity
}, Effect.provide(FetchHttpClient.layer))
