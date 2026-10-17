/**
 * ClinePass model catalog. IDs are the slugs Cline's API expects; context
 * windows and thinking maps follow jellydn/pi-clinepass-provider, which was
 * tested against the live API. `null` marks a thinking level the model rejects.
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

export type ModelMaker = "zai" | "moonshot" | "deepseek" | "qwen" | "minimax" | "xiaomi" | "meta"

/** Who makes each model family, with a logo under /public/models. */
export const MODEL_MAKERS: Readonly<Record<ModelMaker, { readonly name: string; readonly logo: string }>> = {
  zai: { name: "Z.ai", logo: "/models/zai.svg" },
  moonshot: { name: "Moonshot AI", logo: "/models/moonshot.svg" },
  deepseek: { name: "DeepSeek", logo: "/models/deepseek.svg" },
  qwen: { name: "Alibaba Qwen", logo: "/models/qwen.svg" },
  minimax: { name: "MiniMax", logo: "/models/minimax.svg" },
  xiaomi: { name: "Xiaomi", logo: "/models/xiaomi.svg" },
  meta: { name: "Meta", logo: "/models/meta.svg" }
}

export interface ClinePassModel {
  readonly id: string
  readonly name: string
  readonly maker: ModelMaker
  readonly input: ReadonlyArray<"text" | "image">
  readonly contextWindow: number
  readonly maxTokens: number
  readonly cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
  readonly thinkingLevelMap: Readonly<Record<ThinkingLevel, string | null>>
}

const standard = { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: null } as const
const glm = { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: "max" } as const
const deepseek = { off: "none", minimal: null, low: null, medium: null, high: "high", xhigh: "high" } as const

export const CLINEPASS_MODELS: ReadonlyArray<ClinePassModel> = [
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

export const DEFAULT_MODEL_ID = "cline-pass/glm-5.3"
export const DEFAULT_THINKING: ThinkingLevel = "low"

export const findModel = (id: string) => CLINEPASS_MODELS.find((model) => model.id === id)

export const supportedThinkingLevels = (model: ClinePassModel | undefined): ThinkingLevel[] =>
  model ? THINKING_LEVELS.filter((level) => model.thinkingLevelMap[level] !== null) : []

/** The requested level if the model supports it, else the nearest supported one. */
export const clampThinking = (model: ClinePassModel | undefined, level: ThinkingLevel): ThinkingLevel => {
  const supported = supportedThinkingLevels(model)
  if (supported.length === 0 || supported.includes(level)) return level
  const target = THINKING_LEVELS.indexOf(level)
  return supported.reduce((best, candidate) =>
    Math.abs(THINKING_LEVELS.indexOf(candidate) - target) < Math.abs(THINKING_LEVELS.indexOf(best) - target) ? candidate : best
  )
}
