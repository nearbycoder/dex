/** Spending and usage across ClinePass, OpenCode Go, ChatGPT, Command Code, boat.dev, and Cloudflare, as the Usage page shows it. */

export type UsageRange = "month" | "30d" | "all"

export const USAGE_RANGES: ReadonlyArray<{ readonly id: UsageRange; readonly label: string }> = [
  { id: "month", label: "This month" },
  { id: "30d", label: "Last 30 days" },
  { id: "all", label: "All time" }
]

/** Plan fees, in USD per month. Usage is measured; these are the flat parts of each bill. */
export const PLAN_FEES = {
  clinePass: 9.99,
  /** OpenCode Go; Go Plus is $40. */
  openCodeGo: 10,
  /** Command Code's Goat plan (plus a processing fee). */
  commandCode: 10,
  workersPaid: 5
} as const

/**
 * Command Code's Goat allowance, in dollars of usage at each model's API rates: any 5 hours may use $20, any 7 days $50,
 * and the month $100 (https://commandcode.ai/docs/plans/goat). Command Code has no API for the live meters.
 */
export const COMMANDCODE_LIMITS = { fiveHours: 20, week: 50, month: 100 } as const

/** boat.dev compute, USD per hour while a VM runs (billed per second). */
export const BOAT_HOURLY: Readonly<Record<string, number>> = {
  small: 0.018,
  default: 0.036,
  large: 0.072,
  xlarge: 0.2
}

/** Cloudflare Workers Paid list rates (Oct 2026) and the monthly allowance the $5 plan includes. */
export const CLOUDFLARE_RATES = {
  workerRequests: { perMillion: 0.3, includedMonthly: 10_000_000 },
  cpuMs: { perMillion: 0.02, includedMonthly: 30_000_000 },
  doRequests: { perMillion: 0.15, includedMonthly: 1_000_000 },
  doGbSeconds: { perMillion: 12.5, includedMonthly: 400_000 },
  rowsRead: { perMillion: 0.001, includedMonthly: 25_000_000_000 },
  rowsWritten: { perMillion: 1, includedMonthly: 50_000_000 },
  aiNeurons: { perThousand: 0.011, includedDaily: 10_000 }
} as const

export interface DailySpend {
  /** UTC date, YYYY-MM-DD. */
  readonly date: string
  readonly cline: number
  readonly opencode: number
  /** At API list prices; the ChatGPT plan is a flat fee. Missing from an older agent's report. */
  readonly chatgpt?: number
  /** At Command Code's rates, which count against the plan's allowance. Missing from an older agent's report. */
  readonly commandcode?: number
  /** OpenRouter's free models cost nothing, so this is 0 unless a paid one ran. Missing from an older agent's report. */
  readonly openrouter?: number
  readonly boat: number
  readonly cloudflare: number
  /** Model tokens and responses across every subscription. Missing from an older agent's report. */
  readonly tokens?: number
  readonly responses?: number
}

export interface ClineUsage {
  readonly responses: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly totalTokens: number
  /** What these tokens cost at the models' rates (API list prices for ClinePass, Go's rates for OpenCode). Both plans are flat fees. */
  readonly listCost: number
  readonly byModel: ReadonlyArray<{ readonly model: string; readonly responses: number; readonly totalTokens: number; readonly listCost: number }>
  readonly byChat: ReadonlyArray<{ readonly sessionId: string; readonly title: string; readonly totalTokens: number; readonly listCost: number }>
}

/** One of OpenCode Go's allowance windows: share used (0–100) and when it resets. */
export interface OpenCodeWindow {
  readonly percent: number
  readonly resetsAt: string
  /** Requests are blocked until it resets (or fall back to the console balance, if enabled). */
  readonly limited: boolean
}

/** OpenCode Go's allowance: 5-hour (20% of the month's), weekly (50%), and monthly windows. */
export interface OpenCodeLimits {
  readonly rolling: OpenCodeWindow
  readonly weekly: OpenCodeWindow
  readonly monthly: OpenCodeWindow
}

export interface OpenCodeUsage extends ClineUsage {
  readonly connected: boolean
  /** Live from OpenCode; null when it couldn't be read (see `limitsError`) or no key is connected. */
  readonly limits: OpenCodeLimits | null
  readonly limitsError: string | null
}

/**
 * Command Code tokens, at the rates its plan counts against the allowance. `spent` is what Dex used in the last 5
 * hours, 7 days, and 30 days, to set against COMMANDCODE_LIMITS; Command Code's own windows open on a first request and
 * also count its CLI and other clients, so these are estimates.
 */
export interface CommandCodeUsage extends ClineUsage {
  readonly connected: boolean
  readonly spent: { readonly fiveHours: number; readonly week: number; readonly month: number }
}

/** OpenRouter's own numbers for the connected key (GET /key and /credits), across every app that uses the key. */
export interface OpenRouterAccount {
  /** Free-model requests today (UTC) against the account's daily allowance: 50, or 1,000 once it has bought $10 of credits. */
  readonly freeRequests: { readonly used: number; readonly limit: number } | null
  /** USD this key spent today, this week, and this month (UTC), and in all. */
  readonly spent: { readonly day: number; readonly week: number; readonly month: number; readonly total: number }
  /** The key's own spending cap and what's left of it; null when it has none. */
  readonly keyLimit: { readonly limit: number; readonly remaining: number } | null
  /** The account's credits: bought, and used. Null when the key can't read them. */
  readonly credits: { readonly total: number; readonly used: number } | null
}

/** OpenRouter tokens (its free models, at $0), with the account's live numbers when they could be read. */
export interface OpenRouterUsage extends ClineUsage {
  readonly connected: boolean
  readonly account: OpenRouterAccount | null
  readonly accountError: string | null
}

export interface BoatUsage {
  readonly hours: number
  readonly cost: number
  readonly running: boolean
  readonly bySize: ReadonlyArray<{ readonly size: string; readonly hours: number; readonly cost: number }>
  readonly runs: ReadonlyArray<{
    readonly startedAt: number
    readonly endedAt: number | null
    readonly size: string
    readonly hours: number
    readonly cost: number
  }>
}

export interface CloudflareLine {
  readonly label: string
  readonly quantity: number
  readonly unit: string
  /** Cost at list rates, before the plan's included allowance. */
  readonly cost: number
  /** Share of the monthly included allowance used, 0–1, when the range is a month or shorter. */
  readonly allowanceUsed: number | null
  readonly accountWide?: boolean
}

export interface CloudflareUsage {
  /** False until CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are set. */
  readonly configured: boolean
  readonly error: string | null
  /** Cloudflare keeps these analytics for about a month, so longer ranges are clipped. */
  readonly since: number
  readonly lines: ReadonlyArray<CloudflareLine>
  /** Metered cost at list rates, before the included allowance. */
  readonly meteredCost: number
}

export interface UsageReport {
  readonly range: UsageRange
  readonly since: number
  readonly until: number
  readonly cline: ClineUsage
  /** Its token costs are at Go's rates, which is what counts against the plan's allowance. */
  readonly opencode: OpenCodeUsage
  /** Tokens on the ChatGPT plan, at API list prices. Missing from an older agent's report. */
  readonly chatgpt?: ClineUsage & { readonly connected: boolean }
  /** Missing from an older agent's report. */
  readonly commandcode?: CommandCodeUsage
  /** Missing from an older agent's report. */
  readonly openrouter?: OpenRouterUsage
  readonly boat: BoatUsage
  readonly cloudflare: CloudflareUsage
  readonly daily: ReadonlyArray<DailySpend>
}

/** One allowance window at a glance, e.g. OpenCode Go's 5 hours at 42%. */
export interface UsageMeter {
  /** The subscription it belongs to: "opencode-go", "commandcode", or "openrouter". */
  readonly provider: string
  /** "OpenCode Go" */
  readonly service: string
  /** "5 hours", "Week", "Free requests today" */
  readonly window: string
  /** Share used, 0–100 (can pass 100 for an estimate). */
  readonly percent: number
  /** Requests are blocked until it resets. */
  readonly limited: boolean
  /** When it resets (ISO 8601), when the service says. */
  readonly resetsAt: string | null
  /** "$4.20 of $20", "12 of 1,000"; null when the percentage is all there is. */
  readonly detail: string | null
  /** Worked out from Dex's own chats rather than read from the service. */
  readonly estimated: boolean
}

/** What the sidebar and the apps' usage buttons show: the allowances, most used first, and today's tokens. Cheap to ask for. */
export interface UsageGlance {
  readonly meters: ReadonlyArray<UsageMeter>
  /** Model tokens and responses today (UTC), across every subscription. */
  readonly today: { readonly tokens: number; readonly responses: number }
}
