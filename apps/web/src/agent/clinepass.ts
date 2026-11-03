import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy"
import { createProvider } from "@earendil-works/pi-ai/models"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { modelsOf } from "~/shared/models"

export const CLINEPASS_PROVIDER_ID = "clinepass"
export const CLINEPASS_BASE_URL = "https://api.cline.bot/api/v1"

/**
 * ClinePass as a pi-ai provider: Cline's OpenAI-compatible Chat Completions
 * API. `resolveKey` runs before each model request, so a key connected or
 * removed in the UI applies to the next request.
 */
export const clinePassProvider = (resolveKey: () => Promise<{ key: string; source: string } | undefined>) =>
  createProvider({
    id: CLINEPASS_PROVIDER_ID,
    name: "ClinePass",
    baseUrl: CLINEPASS_BASE_URL,
    auth: {
      apiKey: {
        name: "ClinePass API key",
        resolve: async () => {
          const resolved = await resolveKey()
          return resolved && { auth: { apiKey: resolved.key }, source: resolved.source }
        }
      }
    },
    models: modelsOf("clinepass").map((model) => ({
      id: model.id,
      name: model.name,
      api: "openai-completions" as const,
      provider: CLINEPASS_PROVIDER_ID,
      baseUrl: CLINEPASS_BASE_URL,
      reasoning: true,
      input: [...model.input],
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      thinkingLevelMap: model.thinkingLevelMap,
      // ClinePass accepts only the classic roles; reasoning models would otherwise get `developer`.
      compat: { supportsDeveloperRole: false }
    })),
    api: openAICompletionsApi()
  })

export class ClinePassError extends Schema.TaggedError<ClinePassError>()("ClinePassError", {
  reason: Schema.Literals(["invalid_key", "not_subscribed", "unreachable", "unexpected"]),
  message: Schema.String
}) {}

/** Talks to the Cline API outside the agent loop: checking a key before it is saved. */
export class ClinePassClient extends Context.Service<ClinePassClient, {
  /** Resolves with an optional note when Cline accepts the key for ClinePass models. */
  verifyKey(key: string): Effect.Effect<{ note?: string }, ClinePassError>
  /** Whether a model answers for this key: false when Cline turns it away, undefined when that couldn't be told. */
  answers(key: string, apiId: string): Effect.Effect<boolean | undefined>
}>()("dex/agent/ClinePassClient") {
  static readonly layer = Layer.effect(
    ClinePassClient,
    Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient

      // A tiny completion: the cheapest call that proves the key works for ClinePass, which answers
      // 403 for keys without a subscription. It uses a model whose reasoning can be turned off; a
      // reasoning model spends a small max_tokens on thinking and Cline answers 500 "empty response content".
      const verifyKey = Effect.fn("ClinePassClient.verifyKey")(function*(key: string) {
        const response = yield* HttpClientRequest.post(`${CLINEPASS_BASE_URL}/chat/completions`).pipe(
          HttpClientRequest.bearerToken(key),
          HttpClientRequest.bodyJsonUnsafe({
            model: "cline-pass/deepseek-v4.1-flash",
            messages: [{ role: "user", content: "Reply with OK" }],
            max_tokens: 16,
            reasoning_effort: "none",
            stream: false
          }),
          client.execute,
          Effect.timeout("20 seconds"),
          Effect.mapError((cause) => new ClinePassError({ reason: "unreachable", message: `Could not reach Cline: ${cause}` }))
        )
        if (response.status >= 200 && response.status < 300) return {}
        const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
        const detail = body.slice(0, 300)
        switch (response.status) {
          case 401:
            return yield* new ClinePassError({ reason: "invalid_key", message: "Cline rejected this API key." })
          case 403:
            return yield* new ClinePassError({
              reason: "not_subscribed",
              message: "This key has no active ClinePass subscription (or belongs to an organization)."
            })
          case 429:
            return { note: "Key accepted, but ClinePass is rate limiting right now." }
          default:
            if (response.status >= 400 && response.status < 500) {
              return { note: `Key accepted; the test request returned ${response.status}.` }
            }
            return yield* new ClinePassError({ reason: "unexpected", message: `Cline returned ${response.status}: ${detail}` })
        }
      })

      // Room for a reasoning model to think and still answer (a small max_tokens ends in a 500).
      const answers = Effect.fn("ClinePassClient.answers")(function*(key: string, apiId: string) {
        const response = yield* HttpClientRequest.post(`${CLINEPASS_BASE_URL}/chat/completions`).pipe(
          HttpClientRequest.bearerToken(key),
          HttpClientRequest.bodyJsonUnsafe({ model: apiId, messages: [{ role: "user", content: "Reply with OK" }], max_tokens: 512, stream: false }),
          client.execute,
          Effect.timeout("45 seconds"),
          Effect.option
        )
        if (Option.isNone(response)) return undefined
        const status = response.value.status
        if (status >= 200 && status < 300) return true
        return [401, 402, 403, 404, 429].includes(status) ? false : undefined
      })

      return ClinePassClient.of({ verifyKey, answers })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
