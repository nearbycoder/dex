/**
 * The models Dex can run, from two subscriptions:
 * - ClinePass (Cline's OpenAI-compatible API). Context windows and thinking maps follow jellydn/pi-clinepass-provider,
 *   which was tested against the live API.
 * - OpenCode Go (https://opencode.ai/docs/go/), which serves each model over its own API style (OpenAI Chat
 *   Completions or Responses, Anthropic Messages, Google). Generated from pi-ai's opencode-go catalog, limited to the
 *   models Go lists and serves.
 * `id` is unique across both (it's what chats store); `apiId` is what the provider's API calls the model.
 * In a thinking map, `null` marks a level the model rejects; a missing key uses the provider's default.
 *
 * This list is built in, so a fresh agent has models before it has looked anything up. Providers add, rename, and
 * retire models often, so each agent refreshes it from the providers (src/agent/model-catalog.ts) and installs the
 * result with `setModelCatalog`; open apps fetch it when the synced state says it changed.
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

export type ModelProvider = "clinepass" | "opencode-go"

/** The subscriptions models run on, as Settings and the model menu name them. */
export const MODEL_PROVIDERS: Readonly<Record<ModelProvider, { readonly name: string; readonly short: string }>> = {
  clinepass: { name: "ClinePass", short: "Cline" },
  "opencode-go": { name: "OpenCode Go", short: "OpenCode" }
}

export type ModelMaker =
  | "zai" | "moonshot" | "deepseek" | "qwen" | "minimax" | "xiaomi" | "meta"
  | "anthropic" | "openai" | "xai" | "google" | "meituan" | "tencent" | "stepfun" | "opencode"

/** Who makes each model family, with a logo under /public/models. */
export const MODEL_MAKERS: Readonly<Record<ModelMaker, { readonly name: string; readonly logo: string }>> = {
  zai: { name: "Z.ai", logo: "/models/zai.svg" },
  moonshot: { name: "Moonshot AI", logo: "/models/moonshot.svg" },
  deepseek: { name: "DeepSeek", logo: "/models/deepseek.svg" },
  qwen: { name: "Alibaba Qwen", logo: "/models/qwen.svg" },
  minimax: { name: "MiniMax", logo: "/models/minimax.svg" },
  xiaomi: { name: "Xiaomi", logo: "/models/xiaomi.svg" },
  meta: { name: "Meta", logo: "/models/meta.svg" },
  anthropic: { name: "Anthropic", logo: "/models/anthropic.svg" },
  openai: { name: "OpenAI", logo: "/models/openai.svg" },
  xai: { name: "xAI", logo: "/models/xai.svg" },
  google: { name: "Google", logo: "/models/google.svg" },
  meituan: { name: "Meituan", logo: "/models/meituan.svg" },
  tencent: { name: "Tencent", logo: "/models/tencent.svg" },
  stepfun: { name: "StepFun", logo: "/models/stepfun.svg" },
  opencode: { name: "OpenCode", logo: "/models/opencode.svg" }
}

type ThinkingMap = Readonly<Partial<Record<ThinkingLevel | "max", string | null>>>
type Cost = { input: number; output: number; cacheRead: number; cacheWrite: number }
export type ModelApi = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai"

export interface DexModel {
  readonly id: string
  readonly apiId: string
  readonly provider: ModelProvider
  readonly name: string
  readonly maker: ModelMaker
  readonly input: ReadonlyArray<"text" | "image">
  readonly contextWindow: number
  readonly maxTokens: number
  /** Per million tokens. Tiers: higher rates above a prompt size. */
  readonly cost: Cost & { tiers?: Array<Cost & { inputTokensAbove: number }> }
  readonly thinkingLevelMap?: ThinkingMap
  /** OpenCode Go: the API style and base URL this model is served on, and pi-ai compatibility flags. */
  readonly api?: ModelApi
  readonly baseUrl?: string
  readonly compat?: Readonly<Record<string, unknown>>
  /** The provider may train on prompts sent to it (OpenCode's privacy table). */
  readonly trainsOnData?: boolean
}
/** @deprecated The catalog covers both providers now. */
export type ClinePassModel = DexModel

const standard = { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: null } as const
const glm = { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: "max" } as const
const deepseek = { off: "none", minimal: null, low: null, medium: null, high: "high", xhigh: "high" } as const

type CatalogEntry = Omit<DexModel, "id" | "apiId" | "provider">

const CLINEPASS: ReadonlyArray<CatalogEntry & { id: string }> = [
  { id: "cline-pass/glm-5.3", name: "GLM-5.3", maker: "zai", input: ["text"], contextWindow: 1_048_576, maxTokens: 131_072, cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, thinkingLevelMap: glm },
  { id: "cline-pass/glm-5.3-flash", name: "GLM-5.3 Flash", maker: "zai", input: ["text", "image"], contextWindow: 1_048_576, maxTokens: 131_072, cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 }, thinkingLevelMap: glm },
  { id: "cline-pass/kimi-k3", name: "Kimi K3", maker: "moonshot", input: ["text", "image"], contextWindow: 1_048_576, maxTokens: 131_072, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 }, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "max", xhigh: null } },
  { id: "cline-pass/deepseek-v4-pro", name: "DeepSeek V4 Pro", maker: "deepseek", input: ["text"], contextWindow: 1_000_000, maxTokens: 384_000, cost: { input: 1.74, output: 3.48, cacheRead: 0.0145, cacheWrite: 0 }, thinkingLevelMap: deepseek },
  { id: "cline-pass/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", maker: "deepseek", input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 384_000, cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 }, thinkingLevelMap: deepseek },
  { id: "cline-pass/qwen3.8-max", name: "Qwen3.8 Max", maker: "qwen", input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 131_072, cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: null, xhigh: "xhigh" } },
  { id: "cline-pass/qwen3.7-max", name: "Qwen3.7 Max", maker: "qwen", input: ["text"], contextWindow: 262_144, maxTokens: 131_072, cost: { input: 2.5, output: 7.5, cacheRead: 0.5, cacheWrite: 3.125 }, thinkingLevelMap: standard },
  { id: "cline-pass/qwen3.7-plus", name: "Qwen3.7 Plus", maker: "qwen", input: ["text", "image"], contextWindow: 1_048_576, maxTokens: 131_072, cost: { input: 0.4, output: 1.6, cacheRead: 0.04, cacheWrite: 0.5 }, thinkingLevelMap: standard },
  { id: "cline-pass/minimax-m3", name: "MiniMax M3", maker: "minimax", input: ["text", "image"], contextWindow: 1_048_576, maxTokens: 131_072, cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 }, thinkingLevelMap: standard },
  { id: "cline-pass/mimo-v2.5-pro", name: "MiMo V2.5 Pro", maker: "xiaomi", input: ["text"], contextWindow: 262_144, maxTokens: 131_072, cost: { input: 1.74, output: 3.48, cacheRead: 0.0145, cacheWrite: 0 }, thinkingLevelMap: standard },
  { id: "cline-pass/mimo-v2.5", name: "MiMo V2.5", maker: "xiaomi", input: ["text", "image"], contextWindow: 262_144, maxTokens: 131_072, cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 }, thinkingLevelMap: standard },
  { id: "cline-pass/muse-spark-1.3-contributor", name: "Muse Spark 1.3 (Contributor)", maker: "meta", input: ["text", "image"], contextWindow: 1_048_576, maxTokens: 943_718, cost: { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 }, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh" } }
]

const BUILT_IN_CLINEPASS: ReadonlyArray<DexModel> = CLINEPASS.map((model) => ({ ...model, apiId: model.id, provider: "clinepass" }))

const OPENCODE_GO: ReadonlyArray<CatalogEntry & { apiId: string }> = [
  {"apiId": "glm-5.3", "name": "GLM-5.3", "maker": "zai", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text"], "contextWindow": 1000000, "maxTokens": 131072, "cost": {"input": 1.4, "output": 4.4, "cacheRead": 0.26, "cacheWrite": 0}, "thinkingLevelMap": {"off": null, "minimal": null, "low": "low", "medium": null, "high": "high", "xhigh": null, "max": "max"}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens"}},
  {"apiId": "glm-5.3-flash", "name": "GLM-5.3 Flash", "maker": "zai", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text", "image"], "contextWindow": 1000000, "maxTokens": 131072, "cost": {"input": 0.15, "output": 0.5, "cacheRead": 0.03, "cacheWrite": 0}, "thinkingLevelMap": {"off": null, "minimal": null, "low": "low", "medium": null, "high": "high", "xhigh": null, "max": "max"}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens"}},
  {"apiId": "glm-5.2", "name": "GLM-5.2", "maker": "zai", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text"], "contextWindow": 1000000, "maxTokens": 131072, "cost": {"input": 1.4, "output": 4.4, "cacheRead": 0.26, "cacheWrite": 0}, "thinkingLevelMap": {"off": null, "minimal": null, "low": null, "medium": null, "high": "high", "xhigh": null, "max": "max"}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens"}},
  {"apiId": "kimi-k3", "name": "Kimi K3", "maker": "moonshot", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text", "image"], "contextWindow": 1048576, "maxTokens": 131072, "cost": {"input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 0}, "thinkingLevelMap": {"off": null, "minimal": null, "low": null, "medium": null, "high": null, "xhigh": null, "max": "max"}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens", "supportsMidConvoSystemMessages": true, "supportsMidConvoToolAdditions": true}},
  {"apiId": "kimi-k2.7-code", "name": "Kimi K2.7 Code", "maker": "moonshot", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text", "image"], "contextWindow": 262144, "maxTokens": 262144, "cost": {"input": 0.95, "output": 4, "cacheRead": 0.19, "cacheWrite": 0}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens"}},
  {"apiId": "deepseek-v4-pro", "name": "DeepSeek V4 Pro", "maker": "deepseek", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text"], "contextWindow": 1000000, "maxTokens": 384000, "cost": {"input": 0.66, "output": 1.98, "cacheRead": 0.022, "cacheWrite": 0}, "thinkingLevelMap": {"minimal": null, "low": null, "medium": null, "high": "high", "max": "max"}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens", "requiresReasoningContentOnAssistantMessages": true, "thinkingFormat": "deepseek"}},
  {"apiId": "deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash", "maker": "deepseek", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text", "image"], "contextWindow": 1000000, "maxTokens": 384000, "cost": {"input": 0.15, "output": 0.6, "cacheRead": 0.003, "cacheWrite": 0}, "thinkingLevelMap": {"off": null, "minimal": null, "low": "low", "medium": null, "high": "high", "xhigh": null, "max": "max"}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens", "requiresReasoningContentOnAssistantMessages": true, "thinkingFormat": "deepseek"}},
  {"apiId": "qwen3.8-max", "name": "Qwen3.8 Max", "maker": "qwen", "api": "anthropic-messages", "baseUrl": "https://opencode.ai/inference/go", "input": ["text", "image"], "contextWindow": 1000000, "maxTokens": 131072, "cost": {"input": 2, "output": 6, "cacheRead": 0.25, "cacheWrite": 2.5}},
  {"apiId": "qwen3.8-flash", "name": "Qwen3.8 Flash", "maker": "qwen", "api": "anthropic-messages", "baseUrl": "https://opencode.ai/inference/go", "input": ["text", "image"], "contextWindow": 1000000, "maxTokens": 131072, "cost": {"input": 0.15, "output": 0.47, "cacheRead": 0.016, "cacheWrite": 0.2}, "compat": {"allowEmptySignature": true}},
  {"apiId": "qwen3.7-plus", "name": "Qwen3.7 Plus", "maker": "qwen", "api": "anthropic-messages", "baseUrl": "https://opencode.ai/inference/go", "input": ["text", "image"], "contextWindow": 1000000, "maxTokens": 65536, "cost": {"input": 0.4, "output": 1.6, "cacheRead": 0.04, "cacheWrite": 0.5, "tiers": [{"inputTokensAbove": 256000, "input": 1.2, "output": 4.8, "cacheRead": 0.12, "cacheWrite": 1.5}]}},
  {"apiId": "minimax-m3", "name": "MiniMax-M3", "maker": "minimax", "api": "anthropic-messages", "baseUrl": "https://opencode.ai/inference/go", "input": ["text", "image"], "contextWindow": 1000000, "maxTokens": 131072, "cost": {"input": 0.3, "output": 1.2, "cacheRead": 0.06, "cacheWrite": 0, "tiers": [{"inputTokensAbove": 512000, "input": 0.6, "output": 2.4, "cacheRead": 0.12, "cacheWrite": 0}]}},
  {"apiId": "mimo-v2.6-pro", "name": "MiMo V2.6 Pro", "maker": "xiaomi", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text", "image"], "contextWindow": 1048576, "maxTokens": 131072, "cost": {"input": 0.435, "output": 0.87, "cacheRead": 0.003625, "cacheWrite": 0}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens"}},
  {"apiId": "mimo-v2.6-flash", "name": "MiMo V2.6 Flash", "maker": "xiaomi", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text", "image"], "contextWindow": 1048576, "maxTokens": 131072, "cost": {"input": 0.14, "output": 0.28, "cacheRead": 0.0028, "cacheWrite": 0}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens"}},
  {"apiId": "mimo-v2.5-pro", "name": "MiMo V2.5 Pro", "maker": "xiaomi", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text"], "contextWindow": 1048576, "maxTokens": 128000, "cost": {"input": 0.435, "output": 0.87, "cacheRead": 0.003625, "cacheWrite": 0}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens"}},
  {"apiId": "mimo-v2.5", "name": "MiMo V2.5", "maker": "xiaomi", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text", "image"], "contextWindow": 1000000, "maxTokens": 128000, "cost": {"input": 0.14, "output": 0.28, "cacheRead": 0.0028, "cacheWrite": 0}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens"}},
  {"apiId": "claude-haiku-5-5", "name": "Claude Haiku 5.5", "maker": "anthropic", "api": "anthropic-messages", "baseUrl": "https://opencode.ai/inference/go", "input": ["text", "image"], "contextWindow": 1000000, "maxTokens": 128000, "cost": {"input": 0.1, "output": 0.5, "cacheRead": 0.01, "cacheWrite": 0.125, "tiers": [{"inputTokensAbove": 100000, "input": 0.5, "output": 2.5, "cacheRead": 0.05, "cacheWrite": 0.625}]}, "thinkingLevelMap": {"xhigh": "xhigh", "max": "max"}, "compat": {"forceAdaptiveThinking": true, "supportsTemperature": false}},
  {"apiId": "gpt-6-luna", "name": "GPT-6 Luna", "maker": "openai", "api": "openai-responses", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text", "image"], "contextWindow": 1050000, "maxTokens": 128000, "cost": {"input": 0.1, "output": 0.5, "cacheRead": 0.01, "cacheWrite": 0.125, "tiers": [{"inputTokensAbove": 272000, "input": 0.2, "output": 0.75, "cacheRead": 0.02, "cacheWrite": 0.25}]}, "thinkingLevelMap": {"off": "none", "minimal": null, "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max"}, "compat": {"sessionAffinityFormat": "openai-nosession", "supportsMidConvoSystemMessages": true, "supportsAdditionalTools": true}},
  {"apiId": "gpt-5.6-luna", "name": "GPT-5.6 Luna", "maker": "openai", "api": "openai-responses", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text", "image"], "contextWindow": 1050000, "maxTokens": 128000, "cost": {"input": 0.2, "output": 1.2, "cacheRead": 0.02, "cacheWrite": 0.25, "tiers": [{"inputTokensAbove": 272000, "input": 0.4, "output": 1.8, "cacheRead": 0.04, "cacheWrite": 0.5}]}, "thinkingLevelMap": {"off": null, "minimal": null, "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max"}, "compat": {"sessionAffinityFormat": "openai-nosession", "supportsMidConvoSystemMessages": true, "supportsAdditionalTools": true}},
  {"apiId": "grok-4.7", "name": "Grok 4.7", "maker": "xai", "api": "openai-responses", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text", "image"], "contextWindow": 500000, "maxTokens": 500000, "cost": {"input": 2, "output": 6, "cacheRead": 0.5, "cacheWrite": 0, "tiers": [{"inputTokensAbove": 200000, "input": 4, "output": 12, "cacheRead": 1, "cacheWrite": 0}]}, "thinkingLevelMap": {"off": null, "minimal": null, "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": null}, "compat": {"sessionAffinityFormat": "openai-nosession"}},
  {"apiId": "gemini-4-argon-contributor", "name": "Gemini 4 Argon (Contributor)", "maker": "google", "api": "google-generative-ai", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text", "image"], "contextWindow": 1048576, "maxTokens": 65536, "cost": {"input": 4, "output": 20, "cacheRead": 0.2, "cacheWrite": 0}, "thinkingLevelMap": {"off": null, "minimal": null, "low": "low", "medium": "medium", "high": "high", "xhigh": null, "max": null}, "trainsOnData": true},
  {"apiId": "muse-spark-1.3-contributor", "name": "Muse Spark 1.3 (Contributor)", "maker": "meta", "api": "openai-responses", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text", "image"], "contextWindow": 1048576, "maxTokens": 131072, "cost": {"input": 0.1, "output": 0.2, "cacheRead": 0.002, "cacheWrite": 0}, "thinkingLevelMap": {"off": null, "minimal": "minimal", "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": null}, "compat": {"sessionAffinityFormat": "openai-nosession"}, "trainsOnData": true},
  {"apiId": "muse-spark-1.2-contributor", "name": "Muse Spark 1.2 (Contributor)", "maker": "meta", "api": "openai-responses", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text", "image"], "contextWindow": 1048576, "maxTokens": 131072, "cost": {"input": 0.1, "output": 0.2, "cacheRead": 0.002, "cacheWrite": 0}, "thinkingLevelMap": {"off": null, "minimal": "minimal", "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": null}, "compat": {"sessionAffinityFormat": "openai-nosession"}, "trainsOnData": true},
  {"apiId": "longcat-2.0", "name": "LongCat-2.0", "maker": "meituan", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text"], "contextWindow": 1000000, "maxTokens": 131072, "cost": {"input": 0.3, "output": 1.2, "cacheRead": 0.006, "cacheWrite": 0}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens"}},
  {"apiId": "longcat-2.5-preview-free", "name": "LongCat 2.5 Preview (Free)", "maker": "meituan", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text", "image"], "contextWindow": 1000000, "maxTokens": 131072, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens"}},
  {"apiId": "hy4-preview", "name": "Hy4 Preview", "maker": "tencent", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text"], "contextWindow": 1024000, "maxTokens": 64000, "cost": {"input": 0.834, "output": 2.501, "cacheRead": 0.042, "cacheWrite": 0}, "thinkingLevelMap": {"off": "none", "minimal": null, "low": null, "medium": null, "high": "high", "xhigh": null, "max": null}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens"}},
  {"apiId": "hy3", "name": "Hy3", "maker": "tencent", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text"], "contextWindow": 256000, "maxTokens": 128000, "cost": {"input": 0.14, "output": 0.58, "cacheRead": 0.035, "cacheWrite": 0}, "thinkingLevelMap": {"off": "none", "minimal": null, "low": "low", "medium": null, "high": "high", "xhigh": null, "max": null}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens"}},
  {"apiId": "step-5-preview", "name": "Step 5 Preview", "maker": "stepfun", "api": "openai-completions", "baseUrl": "https://opencode.ai/inference/go/v1", "input": ["text", "image"], "contextWindow": 1000000, "maxTokens": 65536, "cost": {"input": 1.0, "output": 2.7, "cacheRead": 0.1, "cacheWrite": 0}, "thinkingLevelMap": {"off": null, "minimal": null, "low": "low", "medium": "medium", "high": "high", "xhigh": null, "max": null}, "compat": {"supportsStore": false, "supportsDeveloperRole": false, "supportsStrictMode": true, "maxTokensField": "max_tokens"}},
]

const BUILT_IN_OPENCODE_GO: ReadonlyArray<DexModel> = OPENCODE_GO.map((model) => ({
  ...model,
  id: `opencode-go/${model.apiId}`,
  provider: "opencode-go"
}))

export const BUILT_IN_MODELS: ReadonlyArray<DexModel> = [...BUILT_IN_CLINEPASS, ...BUILT_IN_OPENCODE_GO]

/** A refreshed model list: `version` changes only when the list does; `updatedAt` is when it was last checked. */
export interface ModelCatalog {
  readonly version: string
  readonly updatedAt: number
  readonly models: ReadonlyArray<DexModel>
}

/** Every model that can run now. The same array is updated in place by `setModelCatalog`, so importers see changes. */
const current: DexModel[] = [...BUILT_IN_MODELS]
let currentUpdatedAt = 0
export const MODELS: ReadonlyArray<DexModel> = current

/**
 * Installs a refreshed list, unless one checked more recently is already in place (agents can share a runtime).
 * Models from a maker or provider this build doesn't know (a newer agent's list in an older app) are left out.
 */
export function setModelCatalog(catalog: Pick<ModelCatalog, "models" | "updatedAt">): boolean {
  const models = catalog.models.filter((model) => model.maker in MODEL_MAKERS && model.provider in MODEL_PROVIDERS)
  if (catalog.updatedAt < currentUpdatedAt || models.length === 0) return false
  current.splice(0, current.length, ...models)
  currentUpdatedAt = catalog.updatedAt
  return true
}

/** The models one subscription offers now. */
export const modelsOf = (provider: ModelProvider) => MODELS.filter((model) => model.provider === provider)

export const DEFAULT_MODEL_ID = "cline-pass/glm-5.3"
export const DEFAULT_THINKING: ThinkingLevel = "low"

export const findModel = (id: string) => MODELS.find((model) => model.id === id)

/** The default model, or the first one listed if the provider has retired it. */
export const defaultModelId = () => (findModel(DEFAULT_MODEL_ID) ? DEFAULT_MODEL_ID : (MODELS[0]?.id ?? DEFAULT_MODEL_ID))

/** Which subscription a chat's model runs on (a stored id that's no longer listed counts as ClinePass, as before). */
export const providerOf = (id: string): ModelProvider => findModel(id)?.provider ?? (id.startsWith("opencode-go/") ? "opencode-go" : "clinepass")

/** The same model on the other provider, when it offers it (switching providers keeps a chat's model). */
export const counterpart = (id: string, provider: ModelProvider) => {
  const model = findModel(id)
  if (!model || model.provider === provider) return model
  const slug = model.apiId.replace(/^cline-pass\//, "")
  return MODELS.find((candidate) => candidate.provider === provider && candidate.apiId.replace(/^cline-pass\//, "") === slug)
}

/**
 * A model that can run with the subscriptions connected: `id` if its own is, else the same model on a connected one,
 * else that one's first model. Unchanged when nothing is connected (the chat then says what to connect).
 */
export const usableModel = (id: string, connected: Readonly<Record<ModelProvider, boolean>>): string => {
  if (connected[providerOf(id)]) return id
  const other = (Object.keys(connected) as ModelProvider[]).find((provider) => connected[provider])
  if (!other) return id
  return (counterpart(id, other) ?? MODELS.find((model) => model.provider === other))?.id ?? id
}

/**
 * Levels the menu offers, by pi-ai's rules: null is rejected, a missing level up to `high` is the provider default,
 * and `xhigh` needs to be listed. A model whose top level is `max` offers it as `xhigh` (pi-ai rounds up to it).
 */
export const supportedThinkingLevels = (model: DexModel | undefined): ThinkingLevel[] => {
  if (!model) return []
  const map = model.thinkingLevelMap ?? {}
  return THINKING_LEVELS.filter((level) => {
    if (level === "xhigh") return (map.xhigh !== undefined && map.xhigh !== null) || (map.max !== undefined && map.max !== null)
    return map[level] !== null
  })
}

/** The requested level if the model supports it, else the nearest supported one. */
export const clampThinking = (model: DexModel | undefined, level: ThinkingLevel): ThinkingLevel => {
  const supported = supportedThinkingLevels(model)
  if (supported.length === 0 || supported.includes(level)) return level
  const target = THINKING_LEVELS.indexOf(level)
  return supported.reduce((best, candidate) =>
    Math.abs(THINKING_LEVELS.indexOf(candidate) - target) < Math.abs(THINKING_LEVELS.indexOf(best) - target) ? candidate : best
  )
}
