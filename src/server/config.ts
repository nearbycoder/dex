import { Config, ConfigProvider, Context, Effect, Layer, Option, Redacted } from "effect"

export interface GitHubAppConfig {
  readonly clientId: string
  readonly clientSecret: Redacted.Redacted<string>
}

/** Deployment configuration, read from Worker vars and secrets. */
export class AppConfig extends Context.Service<AppConfig, {
  readonly authSecret: Redacted.Redacted<string>
  readonly github: Option.Option<GitHubAppConfig>
  /** Lowercased GitHub logins allowed to sign in. */
  readonly allowedUsers: ReadonlyArray<string>
  readonly devLogin: boolean
  /** Lets the owner sign in with a long random password until a GitHub OAuth app is set up. */
  readonly ownerPassword: Option.Option<Redacted.Redacted<string>>
  /** Shared ClinePass key for users who have not connected their own. */
  readonly clineApiKey: Option.Option<Redacted.Redacted<string>>
  /** boat.dev API key: gives each user's agent a cloud VM. */
  readonly boatApiKey: Option.Option<Redacted.Redacted<string>>
}>()("dex/server/AppConfig") {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function*() {
      const authSecret = yield* Config.Redacted("AUTH_SECRET")
      const clientId = yield* Config.option(Config.NonEmptyString("GITHUB_CLIENT_ID"))
      const clientSecret = yield* Config.option(Config.Redacted("GITHUB_CLIENT_SECRET"))
      const allowedUsers = yield* Config.String("ALLOWED_GITHUB_USERS").pipe(
        Config.withDefault(""),
        Config.map((value) => value.split(",").map((login) => login.trim().toLowerCase()).filter(Boolean))
      )
      const devLogin = yield* Config.Boolean("DEV_LOGIN").pipe(Config.withDefault(false))
      const clineApiKey = yield* Config.option(Config.Redacted("CLINE_API_KEY"))
      const ownerPassword = yield* Config.option(Config.Redacted("OWNER_PASSWORD"))
      const boatApiKey = yield* Config.option(Config.Redacted("BOAT_API_KEY"))

      const github = Option.all({ clientId, clientSecret })
      return AppConfig.of({ authSecret, github, allowedUsers, devLogin, ownerPassword, clineApiKey, boatApiKey })
    })
  )
}

/** Reads config from a Worker `env` object instead of `process.env`. */
export const envConfigProvider = (env: object) => ConfigProvider.layer(ConfigProvider.fromUnknown(env))
