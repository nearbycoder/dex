import { BUILT_IN_MODELS, type DexModel, type ModelApi, type ModelMaker, type ModelProvider } from "~/shared/models"
import { OPENCODE_GO_BASE_URL } from "./opencode-go"

/**
 * Keeps the model list current. Providers add, rename, and retire models every few weeks (an anonymous preview
 * gets its real name, a preview becomes a release), and a chat on a model that's gone just fails. Two sources:
 *
 * - OpenCode Go's own model list (`/v1/models`, public): which models it serves right now. It decides what's listed.
 * - models.dev, the open catalog pi-ai's is generated from: names, limits, prices, input types, thinking levels, and
 *   each OpenCode Go model's API style. Cline publishes no ClinePass list, so its ClinePass section decides those.
 *
 * Models Dex already knows keep their names and hand-checked settings (API style, compat flags, thinking map) and
 * take the catalog's current limits and prices; new ones are derived from the catalog the way pi-ai's generator
 * does. A model OpenCode serves that the catalog doesn't describe (an unannounced preview, or an old one it dropped)
 * isn't listed until it does. A source that can't be reached leaves that provider's models as they were.
 */

const MODELS_DEV = "https://models.dev/api.json"
const OPENCODE_GO_LIST = `${OPENCODE_GO_BASE_URL}/v1/models`
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
}

type DevProvider = { readonly models?: Readonly<Record<string, DevModel>> }

/** Who makes a model, from its id (logos are per maker; OpenCode's own previews get OpenCode's). */
const MAKERS: ReadonlyArray<readonly [RegExp, ModelMaker]> = [
  [/^glm/, "zai"], [/^kimi/, "moonshot"], [/^deepseek/, "deepseek"], [/^qwen/, "qwen"], [/^minimax/, "minimax"],
  [/^mimo/, "xiaomi"], [/^muse/, "meta"], [/^claude/, "anthropic"], [/^(gpt|o\d)/, "openai"], [/^grok/, "xai"],
  [/^gemini/, "google"], [/^longcat/, "meituan"], [/^hy\d/, "tencent"], [/^step/, "stepfun"]
]
const makerOf = (slug: string): ModelMaker => MAKERS.find(([pattern]) => pattern.test(slug))?.[1] ?? "opencode"

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
    ...(entry.cost && { cost: cost(entry.cost) })
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
    const model = create(apiId, entry)
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
 * The models each provider offers now. `current` stands in for a provider whose list can't be read. Throws only
 * when neither source answered, so a refresh that learned nothing doesn't count as checked.
 */
export async function fetchModelCatalog(current: ReadonlyArray<DexModel>): Promise<DexModel[]> {
  const [dev, served] = await Promise.allSettled([
    getJson(MODELS_DEV) as Promise<Readonly<Record<string, DevProvider>>>,
    getJson(OPENCODE_GO_LIST).then((body) => new Set(((body as { data?: Array<{ id?: unknown }> }).data ?? []).map((model) => String(model.id))))
  ])
  if (dev.status === "rejected" && served.status === "rejected") throw new Error(`Couldn't reach the model lists: ${dev.reason}`)
  const catalog = dev.status === "fulfilled" ? dev.value : {}
  const keep = (provider: ModelProvider) => current.filter((model) => model.provider === provider)

  const openCodeEntries = catalog["opencode-go"]?.models ?? {}
  const openCode =
    served.status === "fulfilled" && served.value.size > 0
      ? providerList("opencode-go", served.value, openCodeEntries, newOpenCodeModel)
      : keep("opencode-go")

  // ClinePass: the catalog's list, minus what it marks retired.
  const clineEntries = catalog["cline-pass"]?.models ?? {}
  const clineServed = new Set(Object.entries(clineEntries).filter(([, entry]) => entry.status !== "deprecated").map(([id]) => id))
  const names = new Map(openCode.map((model) => [slugOf(model), model.name]))
  const cline = clineServed.size > 0 ? providerList("clinepass", clineServed, clineEntries, (apiId, entry) => newClinePassModel(apiId, entry, names)) : keep("clinepass")

  return [...(cline.length > 0 ? cline : keep("clinepass")), ...(openCode.length > 0 ? openCode : keep("opencode-go"))]
}

/** A short fingerprint of a list, so apps refetch it only when it changed. */
export const catalogVersion = (models: ReadonlyArray<DexModel>) => {
  let hash = 0x811c9dc5
  for (const char of JSON.stringify(models)) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
  return hash.toString(16).padStart(8, "0")
}
