import { Effect, Option, Redacted } from "effect"
import { AppConfig } from "./config"
import { Keys } from "./crypto"
import { clearCookie, isSecureRequest, readCookie, serializeCookie } from "./cookies"
import { GitHubOAuth } from "./github"
import { NATIVE_FINISH_PATH, nativeChallenge } from "./native-auth"
import { SESSION_COOKIE, SESSION_TTL_SECONDS, Sessions, SessionUser } from "./session"

const STATE_COOKIE = "dex_oauth_state"

const redirect = (location: string, cookies: ReadonlyArray<string> = []) => {
  const headers = new Headers({ location })
  for (const cookie of cookies) headers.append("set-cookie", cookie)
  return new Response(null, { status: 302, headers })
}

const loginError = (message: string, cookies: ReadonlyArray<string> = []) =>
  redirect(`/login?error=${encodeURIComponent(message)}`, cookies)

/** Agent instance names are per GitHub login, so GitHub and owner-password sign-ins share one agent. */
const userId = (login: string) => `user-${login.toLowerCase()}`

const callbackUrl = (request: Request) => new URL("/auth/github/callback", request.url).toString()

export const viewerFromRequest = Effect.fn("auth.viewerFromRequest")(function*(request: Request) {
  const sessions = yield* Sessions
  return yield* sessions.verify(readCookie(request.headers.get("cookie"), SESSION_COOKIE))
})

export const authOptions = Effect.gen(function*() {
  const config = yield* AppConfig
  return { github: Option.isSome(config.github), devLogin: config.devLogin, password: Option.isSome(config.ownerPassword) }
})

const signIn = Effect.fn("auth.signIn")(function*(request: Request, user: SessionUser, extraCookies: ReadonlyArray<string> = []) {
  const token = yield* (yield* Sessions).issue(user)
  const secure = isSecureRequest(request)
  // Signing in for the native app (native-auth.ts): go on to hand it the session.
  return redirect(nativeChallenge(request) ? NATIVE_FINISH_PATH : "/", [...extraCookies, serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS, secure })])
})

export const startGitHubLogin = Effect.fn("auth.startGitHubLogin")(function*(request: Request) {
  const github = yield* GitHubOAuth
  const state = crypto.randomUUID()
  return yield* github.authorizeUrl({ state, redirectUri: callbackUrl(request) }).pipe(
    Effect.map((url) =>
      redirect(url, [serializeCookie(STATE_COOKIE, state, { maxAge: 600, secure: isSecureRequest(request) })])
    ),
    Effect.catchTag("OAuthError", (error) => Effect.succeed(loginError(error.message)))
  )
})

export const finishGitHubLogin = Effect.fn("auth.finishGitHubLogin")(function*(request: Request) {
  const url = new URL(request.url)
  const secure = isSecureRequest(request)
  const clearState = clearCookie(STATE_COOKIE, secure)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const expected = readCookie(request.headers.get("cookie"), STATE_COOKIE)

  if (url.searchParams.has("error")) {
    return loginError(url.searchParams.get("error_description") ?? "GitHub sign-in was cancelled", [clearState])
  }
  if (!code || !state || state !== expected) {
    return loginError("Sign-in expired. Please try again.", [clearState])
  }

  const { allowedUsers } = yield* AppConfig
  const github = yield* GitHubOAuth
  return yield* github.complete({ code, redirectUri: callbackUrl(request) }).pipe(
    Effect.flatMap((profile) => {
      if (!allowedUsers.includes(profile.login.toLowerCase())) {
        return Effect.succeed(loginError(`@${profile.login} is not on this Dex's allowlist`, [clearState]))
      }
      const user = new SessionUser({
        id: userId(profile.login),
        login: profile.login,
        name: profile.name ?? profile.login,
        avatarUrl: profile.avatar_url
      })
      return signIn(request, user, [clearState])
    }),
    Effect.catchTag("OAuthError", (error) => Effect.succeed(loginError(error.message, [clearState])))
  )
})

export const devLogin = Effect.fn("auth.devLogin")(function*(request: Request) {
  const { devLogin: enabled } = yield* AppConfig
  if (!enabled) return new Response("Dev login is disabled", { status: 404 })
  return yield* signIn(request, new SessionUser({ id: "dev", login: "dev", name: "Local Dev", avatarUrl: null }))
})

export const passwordLogin = Effect.fn("auth.passwordLogin")(function*(request: Request) {
  const { ownerPassword, allowedUsers } = yield* AppConfig
  if (Option.isNone(ownerPassword)) return new Response("Password sign-in is disabled", { status: 404 })
  const form = yield* Effect.promise(() => request.formData().catch(() => new FormData()))
  const given = form.get("password")
  // Compare HMACs so the check takes the same time however much of the password matches.
  const keys = yield* Keys
  const [expected, actual] = yield* Effect.all([
    keys.sign(Redacted.value(ownerPassword.value)),
    keys.sign(typeof given === "string" ? given : "")
  ])
  if (expected !== actual) return loginError("Wrong password")
  const login = allowedUsers[0] ?? "owner"
  return yield* signIn(request, new SessionUser({ id: userId(login), login, name: login, avatarUrl: null }))
})

export const logout = (request: Request) =>
  Effect.succeed(redirect("/login", [clearCookie(SESSION_COOKIE, isSecureRequest(request))]))
