import { Clock, Context, Effect, Layer, Option, Result, Schema } from "effect"
import { Base64Url } from "effect/encoding"
import { Keys } from "./crypto"

export const SESSION_COOKIE = "dex_session"
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

export class SessionUser extends Schema.Class<SessionUser>("SessionUser")({
  /** Stable id; also the name of this user's DexAgent instance. */
  id: Schema.String,
  login: Schema.String,
  name: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String)
}) {}

const Claims = Schema.Struct({
  user: SessionUser,
  exp: Schema.Number,
  /** Issued at (seconds), so "sign out everywhere" can reject older sessions. Tokens from before it lack it. */
  iat: Schema.optional(Schema.Number)
})
const ClaimsJson = Schema.fromJsonString(Claims)
const decodeClaims = Schema.decodeUnknownOption(ClaimsJson)
const encodeClaims = Schema.encodeSync(ClaimsJson)

/** Signed, stateless session tokens: `base64url(claims).signature`. */
export class Sessions extends Context.Service<Sessions, {
  issue(user: SessionUser): Effect.Effect<string>
  /** The user, or none when the token is missing, forged, malformed, or expired. */
  verify(token: string | undefined): Effect.Effect<Option.Option<SessionUser>>
}>()("dex/server/Sessions") {
  static readonly layer = Layer.effect(
    Sessions,
    Effect.gen(function*() {
      const keys = yield* Keys

      const issue = Effect.fn("Sessions.issue")(function*(user: SessionUser) {
        const now = yield* Clock.currentTimeMillis
        const iat = Math.floor(now / 1000)
        const payload = Base64Url.encode(encodeClaims({ user, exp: iat + SESSION_TTL_SECONDS, iat }))
        const signature = yield* keys.sign(payload)
        return `${payload}.${signature}`
      })

      const verify = Effect.fn("Sessions.verify")(function*(token: string | undefined) {
        const [payload, signature] = token?.split(".") ?? []
        if (!payload || !signature) return Option.none()
        if (!(yield* keys.verify(payload, signature))) return Option.none()
        const json = Base64Url.decodeString(payload)
        if (Result.isFailure(json)) return Option.none()
        const now = yield* Clock.currentTimeMillis
        return decodeClaims(json.success).pipe(
          Option.filter((claims) => claims.exp * 1000 > now),
          Option.map((claims) => claims.user)
        )
      })

      return Sessions.of({ issue, verify })
    })
  )
}

/** When a token (already verified) was issued, in seconds. Older tokens without `iat` are dated from their expiry. */
export const tokenIssuedAt = (token: string): number => {
  const json = Base64Url.decodeString(token.split(".")[0] ?? "")
  if (Result.isFailure(json)) return 0
  return Option.match(decodeClaims(json.success), { onNone: () => 0, onSome: (claims) => claims.iat ?? claims.exp - SESSION_TTL_SECONDS })
}
