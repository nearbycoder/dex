import { Context, Effect, Layer, Redacted, Result, Schema } from "effect"
import { Base64Url } from "effect/encoding"
import { AppConfig } from "./config"

export class CryptoError extends Schema.TaggedError<CryptoError>()("CryptoError", {
  message: Schema.String
}) {}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Keys derived from AUTH_SECRET: an HMAC key that signs session cookies and an
 * AES-GCM key that encrypts API keys at rest in Durable Object storage.
 */
export class Keys extends Context.Service<Keys, {
  sign(payload: string): Effect.Effect<string>
  verify(payload: string, signature: string): Effect.Effect<boolean>
  encrypt(plaintext: string): Effect.Effect<string>
  decrypt(ciphertext: string): Effect.Effect<string, CryptoError>
}>()("dex/server/Keys") {
  static readonly layer = Layer.effect(
    Keys,
    Effect.gen(function*() {
      const { authSecret } = yield* AppConfig
      const secret = encoder.encode(Redacted.value(authSecret))

      const hmacKey = yield* Effect.promise(() =>
        crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
      )
      const aesKey = yield* Effect.promise(async () => {
        const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"])
        return crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: encoder.encode("dex"), info: encoder.encode("dex/secrets/v1") },
          base,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        )
      })

      const sign = Effect.fnUntraced(function*(payload: string) {
        const signature = yield* Effect.promise(() => crypto.subtle.sign("HMAC", hmacKey, encoder.encode(payload)))
        return Base64Url.encode(new Uint8Array(signature))
      })

      const verify = Effect.fnUntraced(function*(payload: string, signature: string) {
        const bytes = Base64Url.decode(signature)
        if (Result.isFailure(bytes)) return false
        return yield* Effect.promise(() => crypto.subtle.verify("HMAC", hmacKey, new Uint8Array(bytes.success), encoder.encode(payload)))
      })

      const encrypt = Effect.fnUntraced(function*(plaintext: string) {
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const sealed = yield* Effect.promise(() =>
          crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, encoder.encode(plaintext))
        )
        return `${Base64Url.encode(iv)}.${Base64Url.encode(new Uint8Array(sealed))}`
      })

      const decrypt = Effect.fnUntraced(function*(ciphertext: string) {
        const [ivPart = "", sealedPart = ""] = ciphertext.split(".")
        const iv = Base64Url.decode(ivPart)
        const sealed = Base64Url.decode(sealedPart)
        if (Result.isFailure(iv) || Result.isFailure(sealed)) {
          return yield* new CryptoError({ message: "Malformed ciphertext" })
        }
        const plain = yield* Effect.tryPromise({
          try: () => crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv.success) }, aesKey, new Uint8Array(sealed.success)),
          catch: () => new CryptoError({ message: "Could not decrypt; was AUTH_SECRET rotated?" })
        })
        return decoder.decode(plain)
      })

      return Keys.of({ sign, verify, encrypt, decrypt })
    })
  )
}
