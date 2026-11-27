import { Context, Effect, Layer, Redacted, Result, Schema } from "effect"
import { Base64Url } from "effect/encoding"
import { AppConfig } from "./config"

export class CryptoError extends Schema.TaggedError<CryptoError>()("CryptoError", {
  message: Schema.String
}) {}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Module-level CryptoKey caches keyed by AUTH_SECRET, avoiding repeated importKey/deriveKey and letting
// hot paths (session verification, MCP/media token checks) skip Effect ManagedRuntime overhead.
const hmacKeyCache = new Map<string, Promise<CryptoKey>>()
const aesKeyCache = new Map<string, Promise<CryptoKey>>()

export function getCachedHmacKey(secret: string): Promise<CryptoKey> {
  let cached = hmacKeyCache.get(secret)
  if (!cached) {
    if (hmacKeyCache.size >= 4) hmacKeyCache.clear()
    cached = crypto.subtle
      .importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
      .catch((error) => {
        hmacKeyCache.delete(secret)
        throw error
      })
    hmacKeyCache.set(secret, cached)
  }
  return cached
}

export function getCachedAesKey(secret: string): Promise<CryptoKey> {
  let cached = aesKeyCache.get(secret)
  if (!cached) {
    if (aesKeyCache.size >= 4) aesKeyCache.clear()
    const raw = encoder.encode(secret)
    cached = crypto.subtle
      .importKey("raw", raw, "HKDF", false, ["deriveKey"])
      .then((base) =>
        crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: encoder.encode("dex"), info: encoder.encode("dex/secrets/v1") },
          base,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        )
      )
      .catch((error) => {
        aesKeyCache.delete(secret)
        throw error
      })
    aesKeyCache.set(secret, cached)
  }
  return cached
}

/** Fast HMAC-SHA256 verification without entering an Effect runtime (for hot HTTP/WS gates). */
export async function verifyHmac(secret: string, payload: string, signature: string): Promise<boolean> {
  if (!secret || !payload || !signature) return false
  const bytes = Base64Url.decode(signature)
  if (Result.isFailure(bytes)) return false
  const hmacKey = await getCachedHmacKey(secret)
  return crypto.subtle.verify("HMAC", hmacKey, new Uint8Array(bytes.success), encoder.encode(payload))
}

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
      const secretText = Redacted.value(authSecret)
      const hmacKey = yield* Effect.promise(() => getCachedHmacKey(secretText))
      const getAesKey = () => getCachedAesKey(secretText)

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
        const aesKey = yield* Effect.promise(getAesKey)
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const sealed = yield* Effect.promise(() =>
          crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, encoder.encode(plaintext))
        )
        return `${Base64Url.encode(iv)}.${Base64Url.encode(new Uint8Array(sealed))}`
      })

      const decrypt = Effect.fnUntraced(function*(ciphertext: string) {
        const parts = ciphertext.split(".")
        if (parts.length !== 2) return yield* new CryptoError({ message: "Malformed ciphertext" })
        const [ivPart = "", sealedPart = ""] = parts
        const iv = Base64Url.decode(ivPart)
        const sealed = Base64Url.decode(sealedPart)
        if (Result.isFailure(iv) || Result.isFailure(sealed) || iv.success.length !== 12) {
          return yield* new CryptoError({ message: "Malformed ciphertext" })
        }
        const aesKey = yield* Effect.promise(getAesKey)
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
