import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy"
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy"
import { createProvider } from "@earendil-works/pi-ai/models"
import { modelsOf } from "~/shared/models"

/**
 * Command Code (https://commandcode.ai/docs/provider): a plan's models over one OpenAI-compatible API, with Claude on
 * Anthropic Messages. Each plan covers some of the models it lists; the rest answer 403 MODEL_NOT_IN_PLAN, so Dex
 * lists only the ones the connected key's plan covers (`planModels`).
 */
export const COMMANDCODE_PROVIDER_ID = "commandcode"
/** Anthropic-style requests go to `${base}/v1/messages` (pi-ai adds the path); OpenAI-style ones to `${base}/v1/…`. */
export const COMMANDCODE_BASE_URL = "https://api.commandcode.ai/provider"
const API = `${COMMANDCODE_BASE_URL}/v1`
const TIMEOUT_MS = 20_000

/**
 * Command Code as a pi-ai provider, with the models listed now (see model-catalog.ts). `resolveKey` runs before each
 * model request, so a key connected or removed in the UI applies to the next request.
 */
export const commandCodeProvider = (resolveKey: () => Promise<{ key: string; source: string } | undefined>) =>
  createProvider({
    id: COMMANDCODE_PROVIDER_ID,
    name: "Command Code",
    baseUrl: API,
    auth: {
      apiKey: {
        name: "Command Code API key",
        resolve: async () => {
          const resolved = await resolveKey()
          return resolved && { auth: { apiKey: resolved.key }, source: resolved.source }
        }
      }
    },
    models: modelsOf("commandcode").map((model) => ({
      id: model.apiId,
      name: model.name,
      api: model.api ?? "openai-completions",
      provider: COMMANDCODE_PROVIDER_ID,
      baseUrl: model.baseUrl ?? API,
      reasoning: true,
      input: [...model.input],
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      headers: { "User-Agent": "dex/1.0" },
      ...(model.thinkingLevelMap && { thinkingLevelMap: model.thinkingLevelMap }),
      ...(model.compat && { compat: model.compat })
      // pi-ai types compat per API; the catalog carries values for each model's API.
    })) as never,
    api: {
      "anthropic-messages": anthropicMessagesApi(),
      "openai-completions": openAICompletionsApi()
    }
  })

/** One model Command Code lists (GET /provider/v1/models). */
export interface CommandCodeListed {
  readonly id: string
  readonly name: string
  readonly contextLength: number | null
  /** `/chat/completions`, `/responses`, and `/messages` (Claude). */
  readonly endpoints: ReadonlyArray<string>
}

export class CommandCodeError extends Error {
  constructor(message: string, readonly reason: "invalid_key" | "unreachable" | "unexpected") {
    super(message)
  }
}

const headers = (key: string) => ({ authorization: `Bearer ${key}`, "content-type": "application/json", "user-agent": "dex/1.0" })

/** The models Command Code lists for this key. Also checks the key: a wrong one answers 401. */
export async function listCommandCodeModels(key: string): Promise<CommandCodeListed[]> {
  let response: Response
  try {
    response = await fetch(`${API}/models`, { headers: headers(key), signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (error) {
    throw new CommandCodeError(`Couldn't reach Command Code: ${error instanceof Error ? error.message : String(error)}`, "unreachable")
  }
  if (response.status === 401 || response.status === 403) throw new CommandCodeError("Command Code didn't accept that key. Copy a new one from Command Code Studio.", "invalid_key")
  if (!response.ok) throw new CommandCodeError(`Command Code answered ${response.status}.`, "unexpected")
  const body = (await response.json()) as { data?: Array<{ id?: unknown; name?: unknown; context_length?: unknown; supported_endpoints?: unknown }> }
  return (body.data ?? []).flatMap((model) => {
    const endpoints = Array.isArray(model.supported_endpoints) ? model.supported_endpoints.map(String) : []
    // Chats need Chat Completions or (Claude) Messages; anything else (a decision model) isn't a chat model.
    if (typeof model.id !== "string" || !(endpoints.includes("/chat/completions") || endpoints.includes("/messages"))) return []
    return [{ id: model.id, name: typeof model.name === "string" ? model.name : model.id, contextLength: typeof model.context_length === "number" ? model.context_length : null, endpoints }]
  })
}

/**
 * Which listed models this key's plan covers. A request with an impossible temperature is refused with 403
 * MODEL_NOT_IN_PLAN before it goes anywhere for a model outside the plan, and by the model's own provider (without
 * generating) for one inside it; `max_tokens: 1` bounds the cost if a provider ignores the temperature. Anything but
 * the plan refusal (a rate limit, an outage) counts as covered, so a hiccup doesn't hide models.
 */
export async function planModels(key: string, listed: ReadonlyArray<CommandCodeListed>): Promise<Set<string>> {
  const covered = new Set<string>()
  const check = async (model: CommandCodeListed) => {
    const claude = !model.endpoints.includes("/chat/completions")
    try {
      const response = await fetch(`${API}/${claude ? "messages" : "chat/completions"}`, {
        method: "POST",
        headers: { ...headers(key), ...(claude && { "anthropic-version": "2023-06-01" }) },
        body: JSON.stringify({ model: model.id, max_tokens: 1, temperature: 99, messages: [{ role: "user", content: "hi" }] }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      const text = response.status === 403 ? await response.text() : ""
      void response.body?.cancel().catch(() => undefined)
      if (!/MODEL_NOT_IN_PLAN/.test(text)) covered.add(model.id)
    } catch {
      covered.add(model.id)
    }
  }
  // A few at a time: the plan check is quick, and Command Code rate-limits bursts.
  for (let index = 0; index < listed.length; index += 8) await Promise.all(listed.slice(index, index + 8).map(check))
  return covered
}
