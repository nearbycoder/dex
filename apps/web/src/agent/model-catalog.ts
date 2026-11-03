import { BUILT_IN_MODELS, type DexModel, type ModelApi, type ModelMaker, type ModelProvider } from "~/shared/models"
import { CHATGPT_BASE_URL } from "./chatgpt"
import { COMMANDCODE_BASE_URL, type CommandCodeListed } from "./commandcode"
import { OPENCODE_GO_BASE_URL } from "./opencode-go"

/**
 * Keeps the model list current. Providers add, rename, and retire models every few weeks (an anonymous preview
 * gets its real name, a preview becomes a release), and a chat on a model that's gone just fails. Three sources:
 *
 * - OpenCode Go's own model list (`/v1/models`, public): which models it serves right now. It decides what's listed.
 * - OpenCode Zen's list (public): its free models (stealth previews, limited-time promotions) join OpenCode Go's,
 *   on the same key, once the agent has seen one answer for it (outside OpenCode's own apps Zen may refuse them).
 * - Cline's public list (`/ai/cline/models`): its stealth models and the free ones out in the last 60 days join
 *   ClinePass's, on the same key, once one has answered for it.
 * - The signed-in ChatGPT account's model list (OpenAI's `/v1/models`, read by the agent with its token, when one is
 *   connected): which chat models the plan offers. It decides ChatGPT's list.
 * - Command Code's own model list (read with the connected key), limited to what the key's plan covers (the agent
 *   checks; see commandcode.ts). It decides Command Code's list.
 * - OpenRouter's public list: its free models that can use tools, listed whether or not a key is connected (like the
 *   other subscriptions', which the menu then offers to connect).
 * - models.dev, the open catalog pi-ai's is generated from: names, limits, prices, input types, thinking levels, and
 *   each OpenCode Go model's API style, and release dates. Cline publishes no ClinePass list, so its ClinePass
 *   section decides those.
 *
 * Models Dex already knows keep their names and hand-checked settings (API style, compat flags, thinking map) and
 * take the catalog's current limits and prices; new ones are derived from the catalog the way pi-ai's generator
 * does. A model OpenCode serves that the catalog doesn't describe (an unannounced preview, or an old one it dropped)
 * isn't listed until it does. A source that can't be reached leaves that provider's models as they were.
 */

const MODELS_DEV = "https://models.dev/api.json"
const OPENCODE_GO_LIST = `${OPENCODE_GO_BASE_URL}/v1/models`
const OPENCODE_ZEN_LIST = "https://opencode.ai/inference/v1/models"
const CLINE_LIST = "https://api.cline.bot/api/v1/ai/cline/models"
const OPENROUTER_LIST = "https://openrouter.ai/api/v1/models"
/** How recent a free Cline model must be to be offered (Cline lists dozens of older free ones). */
const CLINE_FREE_DAYS = 60
const TIMEOUT_MS = 15_000

interface DevCost {
  readonly input?: number
  readonly output?: number
  readonly cache_read?: number
  readonly cache_write?: number
}

/** One model in models.dev (the fields Dex reads). */
interface DevModel {
  readonly name?: string
  readonly reasoning?: boolean
  readonly reasoning_options?: ReadonlyArray<{ readonly type: string; readonly values?: readonly string[] }>
  readonly modalities?: { readonly input?: readonly string[] }
  readonly limit?: { readonly context?: number; readonly output?: number }
  readonly cost?: DevCost & { readonly tiers?: ReadonlyArray<DevCost & { readonly tier?: { readonly type?: string; readonly size?: number } }> }
  readonly provider?: { readonly npm?: string }
  readonly status?: string
  readonly release_date?: string
}

type DevProvider = { readonly models?: Readonly<Record<string, DevModel>> }

/** One model in OpenCode Zen's list (the fields Dex reads). */
interface ZenModel {
  readonly id?: unknown
  readonly name?: string
  readonly type?: string
  readonly release_date?: string
  readonly modalities?: { readonly input?: readonly string[] }
  readonly capabilities?: { readonly reasoning?: { readonly supported?: boolean; readonly effort?: readonly string[] } }
  readonly limit?: { readonly context?: number; readonly output?: number }
  readonly cost?: { readonly text?: { readonly input?: { readonly price?: number }; readonly output?: { readonly price?: number } } }
  readonly api?: Readonly<Record<string, { readonly base_url?: string } | undefined>>
}

/** One model in Cline's list (OpenRouter's shape; the fields Dex reads). */
interface ClineModel {
  readonly id?: unknown
  readonly name?: string
  readonly created?: number
  readonly context_length?: number
  readonly architecture?: { readonly input_modalities?: readonly string[] }
  readonly top_provider?: { readonly max_completion_tokens?: number | null }
  readonly supported_parameters?: readonly string[]
  readonly pricing?: { readonly prompt?: string; readonly completion?: string }
}

/** The catalog's release date, as a day ("2026-11-03"). */
const released = (date: string | undefined) => (date && /^\d{4}-\d{2}-\d{2}/.test(date) ? { releasedAt: date.slice(0, 10) } : {})

/** Who makes a model, from its id (logos are per maker; OpenCode's own previews get OpenCode's). */
const MAKERS: ReadonlyArray<readonly [RegExp, ModelMaker]> = [
  [/^glm/, "zai"], [/^kimi/, "moonshot"], [/^deepseek/, "deepseek"], [/^qwen/, "qwen"], [/^minimax/, "minimax"],
  [/^mimo/, "xiaomi"], [/^muse/, "meta"], [/^claude/, "anthropic"], [/^(gpt|o\d)/, "openai"], [/^grok/, "xai"],
  [/^gemini/, "google"], [/^longcat/, "meituan"], [/^hy\d/, "tencent"], [/^step/, "stepfun"]
]
const makerOf = (slug: string, fallback: ModelMaker = "opencode"): ModelMaker => MAKERS.find(([pattern]) => pattern.test(slug))?.[1] ?? fallback

const slugOf = (model: Pick<DexModel, "apiId">) => model.apiId.replace(/^cline-pass\//, "")

const SPELLINGS: Readonly<Record<string, string>> = { glm: "GLM", gpt: "GPT", mimo: "MiMo", deepseek: "DeepSeek", minimax: "MiniMax", longcat: "LongCat" }

/** "deepseek-v4-flash" → "DeepSeek V4 Flash", for a ClinePass model OpenCode doesn't also name. */
const titleCase = (slug: string) =>
  slug
    .split("-")
    .map((word) => SPELLINGS[word] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")

const cost = (value: DevModel["cost"]): DexModel["cost"] => {
  const flat = (part: DevCost = {}) => ({ input: part.input ?? 0, output: part.output ?? 0, cacheRead: part.cache_read ?? 0, cacheWrite: part.cache_write ?? 0 })
  const tiers = (value?.tiers ?? [])
    .filter((tier) => tier.tier?.type === "context" && typeof tier.tier.size === "number")
    .map((tier) => ({ ...flat(tier), inputTokensAbove: tier.tier!.size! }))
  return { ...flat(value), ...(tiers.length > 0 && { tiers }) }
}

const input = (entry: DevModel): DexModel["input"] => (entry.modalities?.input?.includes("image") ? ["text", "image"] : ["text"])

/** The catalog's current limits, prices, and input types over what Dex knows of a model. */
const refreshed = (model: DexModel, entry: DevModel | undefined): DexModel => {
  if (!entry) return model
  return {
    ...model,
    input: input(entry),
    contextWindow: entry.limit?.context ?? model.contextWindow,
    maxTokens: entry.limit?.output ?? model.maxTokens,
    ...(entry.cost && { cost: cost(entry.cost) }),
    ...released(entry.release_date)
  }
}

/** Thinking levels from the catalog's effort values; Anthropic-style APIs list only the levels above `high`. */
const thinkingMap = (entry: DevModel, api: ModelApi): DexModel["thinkingLevelMap"] => {
  const values = entry.reasoning ? entry.reasoning_options?.find((option) => option.type === "effort")?.values : undefined
  if (!values?.length) return undefined
  const level = (value: string) => (values.includes(value) ? value : null)
  if (api === "anthropic-messages") {
    const above = { ...(values.includes("xhigh") && { xhigh: "xhigh" }), ...(values.includes("max") && { max: "max" }) }
    return Object.keys(above).length > 0 ? above : undefined
  }
  return { off: values.includes("none") ? "none" : null, minimal: level("minimal"), low: level("low"), medium: level("medium"), high: level("high"), xhigh: level("xhigh"), max: level("max") }
}

/** An OpenCode Go model Dex hasn't seen, from its catalog entry (API style from the SDK package it names). */
const newOpenCodeModel = (apiId: string, entry: DevModel): DexModel => {
  const npm = entry.provider?.npm ?? ""
  const api: ModelApi = npm.includes("anthropic")
    ? "anthropic-messages"
    : npm === "@ai-sdk/openai"
      ? "openai-responses"
      : npm.includes("google")
        ? "google-generative-ai"
        : "openai-completions"
  const maker = makerOf(apiId)
  const compat =
    api === "openai-completions"
      ? {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsStrictMode: true,
          maxTokensField: "max_tokens",
          ...(maker === "deepseek" && { requiresReasoningContentOnAssistantMessages: true, thinkingFormat: "deepseek" })
        }
      : api === "openai-responses"
        ? { sessionAffinityFormat: "openai-nosession" }
        : undefined
  const thinkingLevelMap = thinkingMap(entry, api)
  return {
    id: `opencode-go/${apiId}`,
    apiId,
    provider: "opencode-go",
    name: entry.name ?? apiId,
    maker,
    api,
    baseUrl: api === "anthropic-messages" ? OPENCODE_GO_BASE_URL : `${OPENCODE_GO_BASE_URL}/v1`,
    input: input(entry),
    contextWindow: entry.limit?.context ?? 128_000,
    maxTokens: entry.limit?.output ?? 32_768,
    cost: cost(entry.cost),
    ...(thinkingLevelMap && { thinkingLevelMap }),
    ...(compat && { compat }),
    // OpenCode's "contributor" models may train on what's sent to them.
    ...(/contributor/.test(apiId) && { trainsOnData: true })
  }
}

/**
 * Zen's free chat models that OpenCode Go doesn't also serve, as OpenCode models on Zen's Chat Completions API
 * (the same key works on both), newest first. Free while OpenCode lists them at no cost; a model whose promotion ends
 * drops out.
 */
const zenFreeModels = (listed: ReadonlyArray<ZenModel>, goIds: ReadonlySet<string>): DexModel[] =>
  listed.toSorted((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? "")).flatMap((model) => {
    const apiId = typeof model.id === "string" ? model.id : ""
    const baseUrl = model.api?.["chat-completions"]?.base_url
    const free = model.cost?.text?.input?.price === 0 && model.cost.text.output?.price === 0
    if (!apiId || !baseUrl || !free || model.type !== "chat" || goIds.has(apiId)) return []
    const efforts = model.capabilities?.reasoning?.supported ? model.capabilities.reasoning.effort : undefined
    const entry: DevModel = {
      name: model.name,
      reasoning: Boolean(efforts?.length),
      ...(efforts && { reasoning_options: [{ type: "effort", values: efforts }] }),
      modalities: model.modalities,
      limit: model.limit
    }
    return [{ ...newOpenCodeModel(apiId, entry), baseUrl: baseUrl.replace(/\/+$/, ""), cost: cost({}), ...released(model.release_date) }]
  })

/** Whether a model is one of Zen's (served on Zen's address rather than OpenCode Go's). */
const isZenModel = (model: Pick<DexModel, "provider" | "baseUrl">) =>
  model.provider === "opencode-go" && Boolean(model.baseUrl) && !model.baseUrl!.startsWith(OPENCODE_GO_BASE_URL)

/**
 * Cline's stealth models and its free ones from the last 60 days that can use tools, newest first, on ClinePass's API
 * (Cline's, with the same key). Names drop the maker prefix Cline gives them and the "(free)" the badge already says ("Recursive: Flint (free)").
 */
const clineFreeModels = (listed: ReadonlyArray<ClineModel>, now = Date.now()): DexModel[] =>
  listed
    .toSorted((a, b) => (b.created ?? 0) - (a.created ?? 0))
    .flatMap((model) => {
      const apiId = typeof model.id === "string" ? model.id : ""
      const free = model.pricing?.prompt === "0" && model.pricing.completion === "0"
      const stealth = apiId.startsWith("stealth/")
      const recent = typeof model.created === "number" && now - model.created * 1000 < CLINE_FREE_DAYS * 86_400_000
      if (!apiId || apiId.startsWith("cline-pass/") || !free || !(stealth || recent) || !model.supported_parameters?.includes("tools")) return []
      const slug = apiId.split("/").pop()!.replace(/:free$/, "")
      const reasons = model.supported_parameters.includes("reasoning_effort")
      return [{
        id: apiId,
        apiId,
        provider: "clinepass",
        name: (model.name ?? titleCase(slug)).replace(/^[^:]+:\s*/, "").replace(/\s*\(free\)$/i, "").replace(/\s+/g, " "),
        maker: stealth ? "other" : makerOf(slug, "other"),
        input: model.architecture?.input_modalities?.includes("image") ? ["text", "image"] : ["text"],
        contextWindow: model.context_length ?? 128_000,
        maxTokens: Math.min(model.top_provider?.max_completion_tokens ?? 32_768, 131_072),
        cost: cost({}),
        ...(reasons && { thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null } }),
        ...(typeof model.created === "number" && { releasedAt: new Date(model.created * 1000).toISOString().slice(0, 10) })
      } satisfies DexModel]
    })

/** OpenRouter's vendor prefixes for makers Dex has a logo for (the rest show as Other). */
const OPENROUTER_VENDORS: Readonly<Record<string, ModelMaker>> = {
  google: "google", openai: "openai", anthropic: "anthropic", "x-ai": "xai", "z-ai": "zai", moonshotai: "moonshot", deepseek: "deepseek",
  qwen: "qwen", minimax: "minimax", xiaomi: "xiaomi", "meta-llama": "meta", meituan: "meituan", tencent: "tencent", stepfun: "stepfun"
}

/**
 * OpenRouter's free models that can use tools, newest first. Its own routers ("openrouter/free", which picks a model
 * per request) are left out. Names drop the maker prefix OpenRouter gives them and the "(free)" the badge already says ("NVIDIA: Nemotron 3.5 (free)").
 */
const openRouterFreeModels = (listed: ReadonlyArray<ClineModel>): DexModel[] =>
  listed
    .toSorted((a, b) => (b.created ?? 0) - (a.created ?? 0))
    .flatMap((model) => {
      const apiId = typeof model.id === "string" ? model.id : ""
      const free = model.pricing?.prompt === "0" && model.pricing.completion === "0"
      if (!apiId || apiId.startsWith("openrouter/") || !free || !model.supported_parameters?.includes("tools")) return []
      const [vendor = "", rest = apiId] = apiId.split("/")
      const slug = rest.replace(/:free$/, "")
      const reasons = model.supported_parameters.includes("reasoning")
      return [{
        id: `openrouter/${apiId}`,
        apiId,
        provider: "openrouter",
        name: (model.name ?? titleCase(slug)).replace(/^[^:]+:\s*/, "").replace(/\s*\(free\)$/i, "").replace(/\s+/g, " "),
        maker: OPENROUTER_VENDORS[vendor] ?? makerOf(slug, "other"),
        input: model.architecture?.input_modalities?.includes("image") ? ["text", "image"] : ["text"],
        contextWindow: model.context_length ?? 128_000,
        maxTokens: Math.min(model.top_provider?.max_completion_tokens ?? 32_768, 131_072),
        cost: cost({}),
        ...(reasons && { thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null } }),
        ...(typeof model.created === "number" && { releasedAt: new Date(model.created * 1000).toISOString().slice(0, 10) })
      } satisfies DexModel]
    })

/** Whether a ClinePass-listed model is one of Cline's own (not a ClinePass plan model). */
const isClineFreeModel = (model: Pick<DexModel, "provider" | "apiId">) => model.provider === "clinepass" && !model.apiId.startsWith("cline-pass/")

/** A ClinePass model Dex hasn't seen: Cline's OpenAI-compatible API, named like OpenCode names the same model. */
const newClinePassModel = (apiId: string, entry: DevModel, names: ReadonlyMap<string, string>): DexModel => {
  const slug = apiId.replace(/^cline-pass\//, "")
  const thinkingLevelMap = thinkingMap(entry, "openai-completions")
  return {
    id: apiId,
    apiId,
    provider: "clinepass",
    name: names.get(slug) ?? titleCase(slug),
    maker: makerOf(slug),
    input: input(entry),
    contextWindow: entry.limit?.context ?? 128_000,
    maxTokens: entry.limit?.output ?? 32_768,
    cost: cost(entry.cost),
    ...(thinkingLevelMap && { thinkingLevelMap })
  }
}

/**
 * A Command Code model, from its own list and (when it has one) its models.dev entry. Claude runs on Anthropic
 * Messages, everything else on Chat Completions (which every non-Claude model it lists serves).
 */
const commandCodeModel = (listed: CommandCodeListed, entry: DevModel | undefined): DexModel => {
  const api: ModelApi = listed.endpoints.includes("/chat/completions") ? "openai-completions" : "anthropic-messages"
  const slug = listed.id.split("/").pop()!.toLowerCase()
  const maker = makerOf(slug, "commandcode")
  const thinkingLevelMap = entry && thinkingMap(entry, api)
  const compat =
    api === "openai-completions"
      ? {
          supportsStore: false,
          supportsDeveloperRole: false,
          maxTokensField: "max_tokens",
          ...(maker === "deepseek" && { requiresReasoningContentOnAssistantMessages: true, thinkingFormat: "deepseek" })
        }
      : { forceAdaptiveThinking: true, supportsTemperature: false }
  return {
    id: `commandcode/${listed.id}`,
    apiId: listed.id,
    provider: "commandcode",
    name: entry?.name ?? listed.name,
    maker,
    api,
    baseUrl: api === "anthropic-messages" ? COMMANDCODE_BASE_URL : `${COMMANDCODE_BASE_URL}/v1`,
    input: entry ? input(entry) : ["text"],
    contextWindow: listed.contextLength ?? entry?.limit?.context ?? 128_000,
    maxTokens: entry?.limit?.output ?? 32_768,
    cost: cost(entry?.cost),
    ...(thinkingLevelMap && { thinkingLevelMap }),
    compat,
    ...(/contributor|:free$|-free$/.test(listed.id) && { trainsOnData: true }),
    ...released(entry?.release_date)
  }
}

/** Command Code's list, grouped by maker in the order it lists them. */
const commandCodeList = (listed: ReadonlyArray<CommandCodeListed>, covered: ReadonlySet<string>, entries: Readonly<Record<string, DevModel>>) => {
  const models = listed.filter((model) => covered.has(model.id)).map((model) => commandCodeModel(model, entries[model.id]))
  const makers = [...new Set(models.map((model) => model.maker))]
  return models.toSorted((a, b) => makers.indexOf(a.maker) - makers.indexOf(b.maker))
}

/** OpenAI lists every model the account can call; chats need the text ones that reason over the Responses API. */
const CHATGPT_CHAT_MODEL = /^(gpt-\d|o\d)/
const CHATGPT_NOT_CHAT = /(realtime|audio|tts|transcribe|image|search|embedding|moderation|instruct|chat-latest|-\d{4}-\d{2}-\d{2}$)/

/** A ChatGPT model Dex hasn't seen, from its catalog entry. */
const newChatGPTModel = (apiId: string, entry: DevModel): DexModel => {
  const thinkingLevelMap = thinkingMap(entry, "openai-responses")
  return {
    id: `chatgpt/${apiId}`,
    apiId,
    provider: "chatgpt",
    name: entry.name ?? apiId,
    maker: "openai",
    api: "openai-responses",
    baseUrl: CHATGPT_BASE_URL,
    input: input(entry),
    contextWindow: entry.limit?.context ?? 128_000,
    maxTokens: entry.limit?.output ?? 32_768,
    cost: cost(entry.cost),
    ...(thinkingLevelMap && { thinkingLevelMap }),
    compat: { supportsStrictMode: true }
  }
}

/**
 * One provider's list of what it serves: known models in the built-in order with fresh details, and each new one
 * after the last of its maker's (so the menu stays grouped by maker).
 */
const providerList = (
  provider: ModelProvider,
  served: ReadonlySet<string>,
  entries: Readonly<Record<string, DevModel>>,
  create: (apiId: string, entry: DevModel) => DexModel
): DexModel[] => {
  const known = BUILT_IN_MODELS.filter((model) => model.provider === provider)
  const list = known
    .filter((model) => served.has(model.apiId))
    .map((model) => refreshed(model, entries[model.apiId]))
  const knownIds = new Set(known.map((model) => model.apiId))
  for (const apiId of [...served].filter((id) => !knownIds.has(id)).sort()) {
    const entry = entries[apiId]
    if (!entry) continue // Served but not catalogued yet: its API style and limits are unknown, so it waits.
    const model = { ...create(apiId, entry), ...released(entry.release_date) }
    const after = list.findLastIndex((other) => other.maker === model.maker)
    list.splice(after === -1 ? list.length : after + 1, 0, model)
  }
  return list
}

const getJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "dex/1.0" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // models.dev's file is a few MB and changes a few times a day: Cloudflare's cache shares one copy between agents.
    cf: { cacheTtl: 900, cacheEverything: true }
  })
  if (!response.ok) throw new Error(`${new URL(url).host} returned ${response.status}`)
  return response.json()
}

/** What changed between two lists, for the refresh's answer. */
export const catalogChanges = (before: ReadonlyArray<DexModel>, after: ReadonlyArray<DexModel>) => {
  const was = new Map(before.map((model) => [model.id, model]))
  const is = new Set(after.map((model) => model.id))
  return {
    added: after.filter((model) => !was.has(model.id)).map((model) => model.name),
    retired: before.filter((model) => !is.has(model.id)).map((model) => model.name)
  }
}

/**
 * The models each provider offers now. `current` stands in for a provider whose list can't be read, and for ChatGPT
 * when `chatgptServed` (the signed-in account's model ids) is missing. Throws only when neither public source
 * answered, so a refresh that learned nothing doesn't count as checked.
 */
export async function fetchModelCatalog(
  current: ReadonlyArray<DexModel>,
  chatgptServed?: ReadonlySet<string>,
  /** What Command Code lists and the key's plan covers; "keep" when it couldn't be read; missing when not connected. */
  commandCode?: { readonly listed: ReadonlyArray<CommandCodeListed>; readonly covered: ReadonlySet<string> } | "keep",
  /** Which of Zen's and Cline's free models answer for the connected keys; they aren't listed without it. */
  answering?: (service: "zen" | "cline", candidates: ReadonlyArray<DexModel>) => Promise<ReadonlySet<string>>
): Promise<DexModel[]> {
  const answered = async (service: "zen" | "cline", candidates: DexModel[]) => {
    const yes = candidates.length > 0 && answering ? await answering(service, candidates) : new Set<string>()
    return candidates.filter((model) => yes.has(model.apiId))
  }
  const [dev, served, zen, clineListed, openRouterListed] = await Promise.allSettled([
    getJson(MODELS_DEV) as Promise<Readonly<Record<string, DevProvider>>>,
    getJson(OPENCODE_GO_LIST).then((body) => new Set(((body as { data?: Array<{ id?: unknown }> }).data ?? []).map((model) => String(model.id)))),
    getJson(OPENCODE_ZEN_LIST).then((body) => (body as { data?: ZenModel[] }).data ?? []),
    getJson(CLINE_LIST).then((body) => (body as { data?: ClineModel[] }).data ?? []),
    getJson(OPENROUTER_LIST).then((body) => (body as { data?: ClineModel[] }).data ?? [])
  ])
  if (dev.status === "rejected" && served.status === "rejected") throw new Error(`Couldn't reach the model lists: ${dev.reason}`)
  const catalog = dev.status === "fulfilled" ? dev.value : {}
  const keep = (provider: ModelProvider) => current.filter((model) => model.provider === provider)

  const openCodeEntries = catalog["opencode-go"]?.models ?? {}
  const go =
    served.status === "fulfilled" && served.value.size > 0
      ? providerList("opencode-go", served.value, openCodeEntries, newOpenCodeModel)
      : keep("opencode-go").filter((model) => !isZenModel(model))
  const zenListed =
    zen.status === "fulfilled" ? await answered("zen", zenFreeModels(zen.value, new Set(go.map((model) => model.apiId)))) : keep("opencode-go").filter(isZenModel)
  const openCode = go.length > 0 ? [...go, ...zenListed] : []

  // ClinePass: the catalog's list, minus what it marks retired.
  const clineEntries = catalog["cline-pass"]?.models ?? {}
  const clineServed = new Set(Object.entries(clineEntries).filter(([, entry]) => entry.status !== "deprecated").map(([id]) => id))
  const names = new Map(openCode.map((model) => [slugOf(model), model.name]))
  const clinePass =
    clineServed.size > 0
      ? providerList("clinepass", clineServed, clineEntries, (apiId, entry) => newClinePassModel(apiId, entry, names))
      : keep("clinepass").filter((model) => !isClineFreeModel(model))
  const clineFree = clineListed.status === "fulfilled" ? await answered("cline", clineFreeModels(clineListed.value)) : keep("clinepass").filter(isClineFreeModel)
  const cline = clinePass.length > 0 ? [...clinePass, ...clineFree] : []

  // ChatGPT: the chat models the account lists that the catalog describes (and the built-in ones it lists).
  const openAIEntries = catalog["openai"]?.models ?? {}
  const chatgptChat = new Set([...(chatgptServed ?? [])].filter((id) => CHATGPT_CHAT_MODEL.test(id) && !CHATGPT_NOT_CHAT.test(id)))
  const chatgpt = chatgptChat.size > 0 ? providerList("chatgpt", chatgptChat, openAIEntries, newChatGPTModel) : keep("chatgpt")

  const openRouter = openRouterListed.status === "fulfilled" ? openRouterFreeModels(openRouterListed.value) : []

  // Command Code: only with a connected key (its plan decides the list).
  const commandCodeModels =
    commandCode === "keep" ? keep("commandcode") : commandCode ? commandCodeList(commandCode.listed, commandCode.covered, catalog["commandcode"]?.models ?? {}) : []

  return [
    ...(cline.length > 0 ? cline : keep("clinepass")),
    ...(openCode.length > 0 ? openCode : keep("opencode-go")),
    ...(chatgpt.length > 0 ? chatgpt : BUILT_IN_MODELS.filter((model) => model.provider === "chatgpt").map((model) => refreshed(model, openAIEntries[model.apiId]))),
    ...commandCodeModels,
    ...(openRouter.length > 0 ? openRouter : keep("openrouter"))
  ]
}

/** A short fingerprint of a list, so apps refetch it only when it changed. */
export const catalogVersion = (models: ReadonlyArray<DexModel>) => {
  let hash = 0x811c9dc5
  for (const char of JSON.stringify(models)) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
  return hash.toString(16).padStart(8, "0")
}
