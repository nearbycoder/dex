import { Clock, Effect, Option, Schema } from "effect"
import { Base64Url } from "effect/encoding"
import { Keys } from "./crypto"
import { isSecureRequest, readCookie, serializeCookie, clearCookie } from "./cookies"
import { SESSION_TTL_SECONDS, Sessions, type SessionUser, tokenIssuedAt } from "./session"

/**
 * Sign-in for the native apps (apps/ios, apps/android), a PKCE handoff: the app opens
 * `/auth/native/start?challenge=…` in a browser sheet, the user signs in the usual way, and the app gets back
 * `dex://auth/callback?code=…`. The code is sealed (AES-GCM) with a fresh session token and the challenge, and only
 * the app holding the matching verifier can exchange it at `POST /auth/native/token`, so another app that grabs the
 * `dex://` link learns nothing. The token is the same signed session token the web keeps in its cookie: the apps send
 * it as `Cookie: dex_session=…`, every check still goes through activeViewer, and "Sign out everywhere" revokes it.
 *
 * The last step is a button the user presses (a same-origin POST), never a bare link: otherwise a page could send a
 * signed-in browser through `start` with its own challenge and, with an app of its own registered for `dex://`, take
 * the code.
 */

export const NATIVE_COOKIE = "dex_native"
export const NATIVE_FINISH_PATH = "/auth/native/finish"
/** Fixed, so the server never redirects a code anywhere else. */
export const NATIVE_CALLBACK = "dex://auth/callback"
const CHALLENGE_TTL_SECONDS = 600
const CODE_TTL_MS = 120_000

/** base64url(SHA-256(verifier)) without padding. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/
/** RFC 7636's verifier alphabet and length. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/

const redirect = (location: string, cookies: ReadonlyArray<string> = []) => {
  const headers = new Headers({ location, "cache-control": "no-store" })
  for (const cookie of cookies) headers.append("set-cookie", cookie)
  return new Response(null, { status: 302, headers })
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })

/** The pending native sign-in's challenge, if this browser started one. */
export const nativeChallenge = (request: Request) => {
  const value = readCookie(request.headers.get("cookie"), NATIVE_COOKIE)
  return value && CHALLENGE.test(value) ? value : null
}

/** `GET /auth/native/start?challenge=…`: remembers the challenge, then signs in (or goes straight on if signed in). */
export const startNativeSignIn = (request: Request, signedIn: boolean) => {
  const challenge = new URL(request.url).searchParams.get("challenge") ?? ""
  if (!CHALLENGE.test(challenge)) return new Response("A valid challenge is required", { status: 400 })
  const cookie = serializeCookie(NATIVE_COOKIE, challenge, { maxAge: CHALLENGE_TTL_SECONDS, secure: isSecureRequest(request) })
  return redirect(signedIn ? NATIVE_FINISH_PATH : "/login", [cookie])
}

const Sealed = Schema.fromJsonString(
  Schema.Struct({ purpose: Schema.Literal("dex-native-code"), token: Schema.String, challenge: Schema.String, exp: Schema.Number })
)
const encodeSealed = Schema.encodeSync(Sealed)
const decodeSealed = Schema.decodeUnknownOption(Sealed)

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char)

/** `GET /auth/native/finish` (signed in): asks before handing the app a session. */
export const confirmNativeSignIn = (request: Request, user: SessionUser) => {
  if (!nativeChallenge(request)) return redirect(`/login?error=${encodeURIComponent("The app sign-in expired. Start again from the app.")}`)
  const name = escapeHtml(user.login)
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in to the Dex app</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:16px -apple-system,system-ui,sans-serif;background:#09090b;color:#e4e4e7}
main{max-width:22rem;padding:2rem;text-align:center}h1{font-size:1.4rem;margin:0 0 .5rem}p{color:#a1a1aa;line-height:1.45}
button{width:100%;margin-top:1rem;padding:.8rem;border:0;border-radius:.75rem;background:#059669;color:#fff;font:inherit;font-weight:600}
</style></head><body><main><img src="/favicon.svg" alt="" width="64" height="64"><h1>Sign in to the Dex app?</h1>
<p>The Dex app on this device will be signed in as <b>@${name}</b>. Only continue if you started this from the app.</p>
<form method="post" action="${NATIVE_FINISH_PATH}"><button type="submit">Continue as @${name}</button></form></main></body></html>`
  return new Response(page, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // Its own policy (server.ts keeps it): browsers apply form-action to the form's redirect, which goes to dex:.
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self' dex:; frame-ancestors 'none'; base-uri 'none'"
    }
  })
}

/** `POST /auth/native/finish` (signed in, same origin): hands the app a sealed code for a fresh session token. */
export const finishNativeSignIn = Effect.fn("nativeAuth.finish")(function*(request: Request, user: SessionUser) {
  const challenge = nativeChallenge(request)
  const clear = clearCookie(NATIVE_COOKIE, isSecureRequest(request))
  if (!challenge) return redirect(`/login?error=${encodeURIComponent("The app sign-in expired. Start again from the app.")}`, [clear])
  const token = yield* (yield* Sessions).issue(user)
  const exp = (yield* Clock.currentTimeMillis) + CODE_TTL_MS
  const code = yield* (yield* Keys).encrypt(encodeSealed({ purpose: "dex-native-code", token, challenge, exp }))
  return redirect(`${NATIVE_CALLBACK}?code=${encodeURIComponent(code)}`, [clear])
})

const sha256 = (text: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).pipe(
    Effect.map((digest) => Base64Url.encode(new Uint8Array(digest)))
  )

/** `POST /auth/native/token` `{ code, verifier }` → `{ token, user, expiresAt }`. */
export const exchangeNativeCode = Effect.fn("nativeAuth.exchange")(function*(request: Request) {
  const body = yield* Effect.promise(() => request.json<{ code?: unknown; verifier?: unknown } | null>().catch(() => null))
  const code = typeof body?.code === "string" && body.code.length <= 4096 ? body.code : ""
  const verifier = typeof body?.verifier === "string" ? body.verifier : ""
  if (!code || !VERIFIER.test(verifier)) return json(400, { error: "code and verifier are required" })
  const opened = yield* (yield* Keys).decrypt(code).pipe(Effect.option)
  const sealed = Option.flatMap(opened, decodeSealed)
  if (Option.isNone(sealed)) return json(400, { error: "That sign-in code isn't valid" })
  const now = yield* Clock.currentTimeMillis
  if (sealed.value.exp < now) return json(400, { error: "That sign-in code expired. Sign in again." })
  if ((yield* sha256(verifier)) !== sealed.value.challenge) return json(400, { error: "That sign-in code isn't valid" })
  const user = yield* (yield* Sessions).verify(sealed.value.token)
  if (Option.isNone(user)) return json(400, { error: "That sign-in code isn't valid" })
  const expiresAt = (tokenIssuedAt(sealed.value.token) + SESSION_TTL_SECONDS) * 1000
  return json(200, { token: sealed.value.token, user: user.value, expiresAt })
})

/**
 * `POST /auth/native/refresh` with the app's current (still valid, not revoked) token: a fresh one in the same shape
 * as `/auth/native/token`, so an app renews before its 30 days run out instead of asking you to sign in again.
 */
export const refreshNativeToken = Effect.fn("nativeAuth.refresh")(function*(user: SessionUser) {
  const token = yield* (yield* Sessions).issue(user)
  return json(200, { token, user, expiresAt: (tokenIssuedAt(token) + SESSION_TTL_SECONDS) * 1000 })
})
