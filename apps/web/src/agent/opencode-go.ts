import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy"
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy"
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy"
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy"
import type { ProviderStreams } from "@earendil-works/pi-ai"
import { createProvider } from "@earendil-works/pi-ai/models"
import { Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { modelsOf } from "~/shared/models"
import type { OpenCodeLimits } from "~/shared/usage"

export const OPENCODE_GO_PROVIDER_ID = "opencode-go"
export const OPENCODE_GO_BASE_URL = "https://opencode.ai/inference/go"

/**
 * OpenCode Go asks clients to name themselves (not a generic SDK) and to send a stable id per conversation in
 * `x-opencode-session`, for routing and prompt caching (https://opencode.ai/docs/go/#where-can-i-use-it). Pi Durable
 * gives every conversation a provider session id, which becomes that header.
 */
const USER_AGENT = "dex/1.0"
const SESSION_HEADER = "x-opencode-session"

const withSession = (streams: ProviderStreams): ProviderStreams => {
  type Options = Parameters<ProviderStreams["stream"]>[2]
  const add = (options: Options): Options => {
    const headers = (options?.headers ?? {}) as Record<string, string | null>
    if (Object.keys(headers).some((name) => name.toLowerCase() === SESSION_HEADER)) return options
    return { ...options, headers: { ...headers, [SESSION_HEADER]: options?.sessionId ?? crypto.randomUUID() } } as Options
  }
  return {
    ...streams,
    stream: (model, context, options) => streams.stream(model, context, add(options)),
    streamSimple: (model, context, options) => streams.streamSimple(model, context, add(options))
  }
}

/**
 * OpenCode Go as a pi-ai provider. Each model is served on its own API style (see the catalog in shared/models.ts).
 * `resolveKey` runs before each model request, so a key connected or removed in the UI applies to the next request.
 */
export const openCodeGoProvider = (resolveKey: () => Promise<{ key: string; source: string } | undefined>) =>
  createProvider({
    id: OPENCODE_GO_PROVIDER_ID,
    name: "OpenCode Go",
    baseUrl: OPENCODE_GO_BASE_URL,
    auth: {
      apiKey: {
        name: "OpenCode Go API key",
        resolve: async () => {
          const resolved = await resolveKey()
          return resolved && { auth: { apiKey: resolved.key }, source: resolved.source }
        }
      }
    },
    models: modelsOf("opencode-go").map((model) => ({
      id: model.apiId,
      name: model.name,
      api: model.api ?? "openai-completions",
      provider: OPENCODE_GO_PROVIDER_ID,
      baseUrl: model.baseUrl ?? `${OPENCODE_GO_BASE_URL}/v1`,
      reasoning: true,
      input: [...model.input],
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      headers: { "User-Agent": USER_AGENT },
      ...(model.thinkingLevelMap && { thinkingLevelMap: model.thinkingLevelMap }),
      ...(model.compat && { compat: model.compat })
      // pi-ai types compat per API; the catalog carries pi-ai's own values for each model.
    })) as never,
    api: {
      "anthropic-messages": withSession(anthropicMessagesApi()),
      "google-generative-ai": withSession(googleGenerativeAIApi()),
      "openai-completions": withSession(openAICompletionsApi()),
      "openai-responses": withSession(openAIResponsesApi())
    }
  })

export class OpenCodeGoError extends Schema.TaggedError<OpenCodeGoError>()("OpenCodeGoError", {
  reason: Schema.Literals(["invalid_key", "not_subscribed", "unreachable", "unexpected"]),
  message: Schema.String
}) {}

const Window = Schema.Struct({ status: Schema.String, percent: Schema.Number, resetsAt: Schema.String })
const UsageBody = Schema.Struct({ usage: Schema.Struct({ rolling: Window, weekly: Window, monthly: Window }) })

/** Talks to OpenCode Go outside the agent loop: checking a key before it's saved, and reading the plan's usage. */
export class OpenCodeGoClient extends Context.Service<OpenCodeGoClient, {
  /** Resolves with an optional note when OpenCode Go accepts the key. */
  verifyKey(key: string): Effect.Effect<{ note?: string }, OpenCodeGoError>
  /**
   * How much of the plan's allowance is used: the 5-hour, weekly, and monthly windows. Not in OpenCode's docs (it's
   * what its console reads), so callers treat a failure as "unknown".
   */
  usage(key: string): Effect.Effect<OpenCodeLimits, OpenCodeGoError>
}>()("dex/agent/OpenCodeGoClient") {
  static readonly layer = Layer.effect(
    OpenCodeGoClient,
    Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient

      // The cheapest call that proves the key works: a few tokens from the cheapest model.
      const verifyKey = Effect.fn("OpenCodeGoClient.verifyKey")(function*(key: string) {
        const response = yield* HttpClientRequest.post(`${OPENCODE_GO_BASE_URL}/v1/chat/completions`).pipe(
          HttpClientRequest.bearerToken(key),
          HttpClientRequest.setHeaders({ "user-agent": USER_AGENT, [SESSION_HEADER]: `dex-verify-${crypto.randomUUID()}` }),
          HttpClientRequest.bodyJsonUnsafe({
            model: "deepseek-v4.1-flash",
            messages: [{ role: "user", content: "Reply with OK" }],
            max_tokens: 16,
            stream: false
          }),
          client.execute,
          Effect.timeout("20 seconds"),
          Effect.mapError((cause) => new OpenCodeGoError({ reason: "unreachable", message: `Could not reach OpenCode: ${cause}` }))
        )
        if (response.status >= 200 && response.status < 300) return {}
        const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
        switch (response.status) {
          case 401:
            return yield* new OpenCodeGoError({ reason: "invalid_key", message: "OpenCode rejected this API key." })
          case 402:
          case 403:
            return yield* new OpenCodeGoError({ reason: "not_subscribed", message: "This key has no active OpenCode Go subscription." })
          case 429:
            return { note: "Key accepted, but your Go usage limit is reached right now." }
          default:
            if (response.status >= 400 && response.status < 500) return { note: `Key accepted; the test request returned ${response.status}.` }
            return yield* new OpenCodeGoError({ reason: "unexpected", message: `OpenCode returned ${response.status}: ${body.slice(0, 300)}` })
        }
      })

      const usage = Effect.fn("OpenCodeGoClient.usage")(function*(key: string) {
        const response = yield* HttpClientRequest.get(`${OPENCODE_GO_BASE_URL}/v1/usage`).pipe(
          HttpClientRequest.bearerToken(key),
          HttpClientRequest.setHeader("user-agent", USER_AGENT),
          client.execute,
          Effect.timeout("10 seconds"),
          Effect.mapError((cause) => new OpenCodeGoError({ reason: "unreachable", message: `Could not reach OpenCode: ${cause}` }))
        )
        if (response.status === 401) return yield* new OpenCodeGoError({ reason: "invalid_key", message: "OpenCode rejected this API key." })
        if (response.status >= 300) return yield* new OpenCodeGoError({ reason: "unexpected", message: `OpenCode returned ${response.status}` })
        const body = yield* response.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(UsageBody)),
          Effect.mapError(() => new OpenCodeGoError({ reason: "unexpected", message: "OpenCode sent usage in an unexpected shape" }))
        )
        const window = (value: typeof Window.Type) => ({ percent: value.percent, resetsAt: value.resetsAt, limited: value.status !== "ok" })
        return { rolling: window(body.usage.rolling), weekly: window(body.usage.weekly), monthly: window(body.usage.monthly) }
      })

      return OpenCodeGoClient.of({ verifyKey, usage })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
