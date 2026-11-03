import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy"
import { createProvider } from "@earendil-works/pi-ai/models"
import { modelsOf } from "~/shared/models"
import type { OpenRouterAccount } from "~/shared/usage"

/**
 * OpenRouter (https://openrouter.ai/docs): many providers' models over one OpenAI-compatible API. Dex offers only its
 * free models (stealth previews and promotions, priced at zero), to try new ones out; see model-catalog.ts. pi-ai
 * knows OpenRouter by its address and sends its reasoning and session settings.
 */
export const OPENROUTER_PROVIDER_ID = "openrouter"
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
const TIMEOUT_MS = 20_000

/** OpenRouter asks apps to name themselves; it shows these on the key's activity page. */
const APP_HEADERS = { "HTTP-Referer": "https://trydex.dev", "X-Title": "Dex" }

/**
 * OpenRouter as a pi-ai provider, with the models listed now. `resolveKey` runs before each model request, so a key
 * connected or removed in the UI applies to the next request.
 */
export const openRouterProvider = (resolveKey: () => Promise<{ key: string; source: string } | undefined>) =>
  createProvider({
    id: OPENROUTER_PROVIDER_ID,
    name: "OpenRouter",
    baseUrl: OPENROUTER_BASE_URL,
    auth: {
      apiKey: {
        name: "OpenRouter API key",
        resolve: async () => {
          const resolved = await resolveKey()
          return resolved && { auth: { apiKey: resolved.key }, source: resolved.source }
        }
      }
    },
    models: modelsOf("openrouter").map((model) => ({
      id: model.apiId,
      name: model.name,
      api: "openai-completions" as const,
      provider: OPENROUTER_PROVIDER_ID,
      baseUrl: OPENROUTER_BASE_URL,
      reasoning: Boolean(model.thinkingLevelMap),
      input: [...model.input],
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      headers: APP_HEADERS,
      ...(model.thinkingLevelMap && { thinkingLevelMap: model.thinkingLevelMap })
    })),
    api: openAICompletionsApi()
  })

export class OpenRouterError extends Error {
  constructor(message: string, readonly reason: "invalid_key" | "unreachable" | "unexpected") {
    super(message)
  }
}

/** Checks a key with OpenRouter (GET /key, which answers 401 for a wrong one). Resolves with a note for Settings. */
export async function checkOpenRouterKey(key: string): Promise<{ note?: string }> {
  let response: Response
  try {
    response = await fetch(`${OPENROUTER_BASE_URL}/key`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (error) {
    throw new OpenRouterError(`Couldn't reach OpenRouter: ${error instanceof Error ? error.message : String(error)}`, "unreachable")
  }
  if (response.status === 401 || response.status === 403) throw new OpenRouterError("OpenRouter didn't accept that key. Create a new one in OpenRouter's settings.", "invalid_key")
  if (!response.ok) throw new OpenRouterError(`OpenRouter answered ${response.status}.`, "unexpected")
  const body = (await response.json().catch(() => ({}))) as { data?: { is_free_tier?: boolean } }
  // Accounts that never bought credits get a small daily allowance of free-model requests (OpenRouter's limits page).
  return body.data?.is_free_tier ? { note: "Without credits on the account, OpenRouter allows a few dozen free-model requests a day." } : {}
}

/** The key's live numbers for the Usage page: free requests today, spending, and the account's credits. */
export async function openRouterAccount(key: string): Promise<OpenRouterAccount> {
  const get = async (path: string) => {
    const response = await fetch(`${OPENROUTER_BASE_URL}${path}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (response.status === 401) throw new OpenRouterError("OpenRouter no longer accepts this key.", "invalid_key")
    if (!response.ok) throw new OpenRouterError(`OpenRouter answered ${response.status}.`, "unexpected")
    return ((await response.json()) as { data?: Record<string, unknown> }).data ?? {}
  }
  // Credits need a key that can read the account; without them the rest still shows.
  const [info, credits] = await Promise.all([get("/key"), get("/credits").catch(() => undefined)])
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)
  const free = info.free_model_daily_requests as { used?: unknown; limit?: unknown } | undefined
  return {
    freeRequests: free && typeof free.limit === "number" ? { used: number(free.used), limit: free.limit } : null,
    spent: { day: number(info.usage_daily), week: number(info.usage_weekly), month: number(info.usage_monthly), total: number(info.usage) },
    keyLimit: typeof info.limit === "number" ? { limit: info.limit, remaining: number(info.limit_remaining) } : null,
    credits: credits && typeof credits.total_credits === "number" ? { total: credits.total_credits, used: number(credits.total_usage) } : null
  }
}
