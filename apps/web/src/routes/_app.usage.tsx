import { createFileRoute, Link } from "@tanstack/react-router"
import { BarChart3, ChevronRight, RefreshCw, Table2 } from "lucide-react"
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react"
import { InfoTip } from "~/client/components/info-tip"
import { ModelLogo } from "~/client/components/model-logo"
import { UsageSkeleton } from "~/client/components/skeleton"
import { useCachedFetch } from "~/client/lib/cache"
import { useDex } from "~/client/lib/dex"
import { MenuButton } from "~/client/lib/mobile-nav"
import { findModel, type ModelProvider } from "~/shared/models"
import {
  type ClineUsage,
  COMMANDCODE_LIMITS,
  type CommandCodeUsage,
  type DailySpend,
  type OpenCodeUsage,
  type OpenCodeWindow,
  PLAN_FEES,
  USAGE_RANGES,
  type UsageRange,
  type UsageReport
} from "~/shared/usage"

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "models", label: "Models" },
  { id: "machines", label: "Machines" },
  { id: "cloudflare", label: "Cloudflare" }
] as const
type Tab = (typeof TABS)[number]["id"]

interface UsageSearch {
  tab?: Exclude<Tab, "overview">
  /** On the Models tab: one subscription instead of all of them. */
  provider?: ModelProvider
}

const PROVIDER_IDS: ReadonlyArray<ModelProvider> = ["clinepass", "opencode-go", "chatgpt", "commandcode"]

export const Route = createFileRoute("/_app/usage")({
  component: UsagePage,
  validateSearch: (search: Record<string, unknown>): UsageSearch => ({
    ...(TABS.some((tab) => tab.id !== "overview" && tab.id === search.tab) && {
      tab: search.tab as UsageSearch["tab"]
    }),
    ...(PROVIDER_IDS.includes(search.provider as ModelProvider) && {
      provider: search.provider as ModelProvider
    })
  })
})

/** Validated categorical slots from the data-viz reference palette (dark mode), in fixed order. */
const SERIES = [
  { key: "cline", label: "ClinePass", color: "#3987e5" },
  { key: "boat", label: "boat.dev", color: "#d95926" },
  { key: "cloudflare", label: "Cloudflare", color: "#199e70" },
  { key: "opencode", label: "OpenCode Go", color: "#c98500" },
  { key: "chatgpt", label: "ChatGPT", color: "#d55181" },
  { key: "commandcode", label: "Command Code", color: "#8b6fe0" }
] as const
type Series = (typeof SERIES)[number]
type SeriesKey = Series["key"]
const series = (key: SeriesKey) => SERIES.find((item) => item.key === key)!

/** The model subscriptions: which part of the report is theirs, and how their token costs are priced. */
const SUBSCRIPTIONS = [
  {
    id: "clinepass",
    key: "cline",
    rates: "at API list prices",
    column: "List price",
    fee: PLAN_FEES.clinePass
  },
  {
    id: "opencode-go",
    key: "opencode",
    rates: "at Go's rates",
    column: "Go rates",
    fee: PLAN_FEES.openCodeGo
  },
  {
    id: "commandcode",
    key: "commandcode",
    rates: "at the plan's rates",
    column: "Plan rates",
    fee: PLAN_FEES.commandCode
  },
  // Paid for with your ChatGPT plan, outside Dex's estimate.
  {
    id: "chatgpt",
    key: "chatgpt",
    rates: "at API list prices",
    column: "List price",
    fee: null
  }
] as const satisfies ReadonlyArray<{
  id: ModelProvider
  key: SeriesKey
  rates: string
  column: string
  fee: number | null
}>
type Subscription = (typeof SUBSCRIPTIONS)[number]

const tokensOf = (report: UsageReport, subscription: Subscription): ClineUsage | undefined => report[subscription.key]

const usd = (value: number) => (value === 0 ? "$0.00" : value < 0.01 ? "<$0.01" : value < 100 ? `$${value.toFixed(2)}` : `$${Math.round(value).toLocaleString()}`)

const compact = (value: number) =>
  Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: value < 1000 ? 0 : 1
  }).format(value)

/** A model's name, or its id without the subscription and maker prefixes if this app's list doesn't have it (yet). */
const modelName = (id: string) => findModel(id)?.name ?? id.split("/").pop()!

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  })

const Swatch = ({ color, className = "size-2.5" }: { color: string; className?: string }) => (
  <span className={`shrink-0 rounded-sm ${className}`} style={{ background: color }} />
)

function Card({
  title,
  icon,
  info,
  children,
  aside,
  flush
}: {
  title?: string
  icon?: ReactNode
  info?: ReactNode
  children: ReactNode
  aside?: ReactNode
  flush?: boolean
}) {
  return (
    <section className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/40">
      {title && (
        <div className="flex min-h-[45px] items-center gap-2 border-b border-zinc-800 px-4 py-2.5 text-sm">
          {icon}
          <h2 className="min-w-0 truncate font-medium text-zinc-200">{title}</h2>
          {info && <InfoTip label={`About ${title}`}>{info}</InfoTip>}
          <div className="ml-auto shrink-0 text-xs text-zinc-500">{aside}</div>
        </div>
      )}
      <div className={flush ? "min-w-0" : "min-w-0 p-4"}>{children}</div>
    </section>
  )
}

/** A row of headline numbers. */
function Stats({ items }: { items: ReadonlyArray<{ label: string; value: string; detail?: ReactNode }> }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 bg-zinc-950 px-4 py-3">
          <div className="truncate text-xs text-zinc-500">{item.label}</div>
          <div className="mt-1 truncate text-lg font-semibold tracking-tight text-zinc-50 tabular-nums">{item.value}</div>
          {item.detail && <div className="mt-0.5 truncate text-xs text-zinc-500">{item.detail}</div>}
        </div>
      ))}
    </div>
  )
}

/** A share-used meter: amber nearing the limit, red at it, with the words alongside. */
function Meter({ label, percent, value, limited, color }: { label: string; percent: number; value: ReactNode; limited?: boolean; color: string }) {
  const clamped = Math.min(100, Math.max(0, percent))
  const tone = limited || clamped >= 100 ? "#ef4444" : clamped >= 80 ? "#f59e0b" : color
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
        <span className="text-zinc-300">{label}</span>
        <span className="text-right text-zinc-500 tabular-nums">{value}</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-zinc-800"
        role="meter"
        aria-label={`${label}: ${Math.round(clamped)}% used`}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(clamped, clamped > 0 ? 2 : 0)}%`,
            background: tone
          }}
        />
      </div>
    </div>
  )
}

// ── Daily chart ─────────────────────────────────────────────────────────────

/** Daily usage as stacked bars: thin marks, 2px gaps between segments, rounded tops, hover tooltip. */
function DailyChart({ daily, shown, through }: { daily: ReadonlyArray<DailySpend>; shown: ReadonlyArray<Series>; through?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const height = 200
  const pad = { top: 8, right: 4, bottom: 22, left: 44 }
  const plotW = Math.max(1, width - pad.left - pad.right)
  const plotH = height - pad.top - pad.bottom
  const totals = daily.map((day) => shown.reduce((sum, item) => sum + (day[item.key] ?? 0), 0))
  const max = Math.max(...totals, 0)
  // With nothing to draw, a $0–$1 axis instead of ticks too small to tell apart.
  const niceMax =
    max === 0
      ? 1
      : (() => {
          const step = 10 ** Math.floor(Math.log10(max))
          return Math.ceil(max / step) * step
        })()
  const ticks = [0, niceMax / 2, niceMax]
  // Days still to come in the period (the rest of this month) keep their place on the axis.
  const last = daily.at(-1)?.date
  const ahead = last
    ? Array.from({ length: Math.max(0, (through ?? daily.length) - daily.length) }, (_, index) =>
        new Date(Date.parse(`${last}T00:00:00Z`) + (index + 1) * 86_400_000).toISOString().slice(0, 10)
      )
    : []
  const columns = daily.length + ahead.length
  const slot = plotW / Math.max(1, columns)
  const barW = Math.max(2, Math.min(22, slot * 0.6))
  const y = (value: number) => pad.top + plotH - (value / niceMax) * plotH
  const labelEvery = Math.ceil(columns / Math.max(1, Math.floor(plotW / 56)))

  return (
    <div ref={box} className="relative">
      <svg width={width} height={height} role="img" aria-label="Daily usage cost by service">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="#27272a" strokeWidth={1} />
            <text x={pad.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-zinc-500 text-[10px] tabular-nums">
              {usd(tick)}
            </text>
          </g>
        ))}
        {daily.map((day, index) => {
          const x = pad.left + index * slot + (slot - barW) / 2
          let base = 0
          const segments = shown
            .map((item) => {
              const value = day[item.key] ?? 0
              const segment = { series: item, value, from: base }
              base += value
              return segment
            })
            .filter((segment) => segment.value > 0)
          return (
            <g key={day.date} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}>
              {/* Hit target: the whole column, bigger than the mark. */}
              <rect x={pad.left + index * slot} y={pad.top} width={slot} height={plotH} fill="transparent" />
              {segments.map((segment, segmentIndex) => {
                const top = y(segment.from + segment.value)
                const bottom = y(segment.from)
                const isTop = segmentIndex === segments.length - 1
                // 2px surface gap between stacked fills.
                const h = Math.max(1, bottom - top - (segmentIndex > 0 ? 2 : 0))
                return (
                  <rect
                    key={segment.series.key}
                    x={x}
                    y={top}
                    width={barW}
                    height={h}
                    rx={isTop ? Math.min(4, barW / 2) : 0}
                    fill={segment.series.color}
                    opacity={hover === null || hover === index ? 1 : 0.45}
                  />
                )
              })}
              {index % labelEvery === 0 && (
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" className="fill-zinc-500 text-[10px]">
                  {shortDate(day.date)}
                </text>
              )}
            </g>
          )
        })}
        {ahead.map((date, offset) => {
          const index = daily.length + offset
          return (
            index % labelEvery === 0 && (
              <text key={date} x={pad.left + index * slot + slot / 2} y={height - 6} textAnchor="middle" className="fill-zinc-700 text-[10px]">
                {shortDate(date)}
              </text>
            )
          )
        })}
      </svg>
      {hover !== null && daily[hover] && (
        <div
          className="pointer-events-none absolute top-0 z-10 w-48 rounded-lg border border-zinc-700 bg-zinc-950/95 p-2.5 text-xs shadow-xl"
          style={{
            left: Math.min(Math.max(0, pad.left + hover * slot - 70), width - 196)
          }}
        >
          <div className="mb-1.5 font-medium text-zinc-200">{shortDate(daily[hover].date)}</div>
          {shown.map((item) => (
            <div key={item.key} className="flex items-center gap-2 py-0.5 text-zinc-400">
              <Swatch color={item.color} className="size-2" />
              {item.label}
              <span className="ml-auto text-zinc-200 tabular-nums">{usd(daily[hover]![item.key] ?? 0)}</span>
            </div>
          ))}
          <div className="mt-1 flex border-t border-zinc-800 pt-1 text-zinc-300">
            Total <span className="ml-auto tabular-nums">{usd(totals[hover] ?? 0)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function DailyTable({ daily, shown }: { daily: ReadonlyArray<DailySpend>; shown: ReadonlyArray<Series> }) {
  return (
    <div className="scrollbar-thin max-h-72 overflow-auto">
      <table className="w-full text-xs tabular-nums">
        <thead className="sticky top-0 bg-zinc-950 text-zinc-500">
          <tr>
            <th className="py-1.5 text-left font-normal">Date</th>
            {shown.map((item) => (
              <th key={item.key} className="py-1.5 pl-3 text-right font-normal whitespace-nowrap">
                {item.label}
              </th>
            ))}
            <th className="py-1.5 pl-3 text-right font-normal whitespace-nowrap">Total</th>
          </tr>
        </thead>
        <tbody className="text-zinc-300">
          {[...daily].reverse().map((day) => (
            <tr key={day.date} className="border-t border-zinc-900">
              <td className="py-1.5">{shortDate(day.date)}</td>
              {shown.map((item) => (
                <td key={item.key} className="py-1.5 pl-3 text-right whitespace-nowrap">
                  {usd(day[item.key] ?? 0)}
                </td>
              ))}
              <td className="py-1.5 pl-3 text-right whitespace-nowrap text-zinc-100">{usd(shown.reduce((sum, item) => sum + (day[item.key] ?? 0), 0))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Daily spend, with a legend that doubles as a filter: tap a service to hide or show it. */
function DailyUsage({ daily, available, through }: { daily: ReadonlyArray<DailySpend>; available: ReadonlyArray<Series>; through?: number }) {
  const [view, setView] = useState<"chart" | "table">("chart")
  const [hidden, setHidden] = useState<ReadonlySet<SeriesKey>>(new Set())
  const shown = available.filter((item) => !hidden.has(item.key))
  const toggle = (key: SeriesKey) =>
    setHidden((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  return (
    <Card
      title="Daily usage"
      info="Model subscriptions are shown at what their tokens cost at each model's rates (API list prices, or the rates the plan counts against its allowance); you pay their flat plans. Cloudflare is metered usage at list rates, before the plan's included allowance."
      icon={<BarChart3 className="size-4 text-zinc-500" />}
      aside={
        <button
          type="button"
          onClick={() => setView(view === "chart" ? "table" : "chart")}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          {view === "chart" ? <Table2 className="size-3.5" /> : <BarChart3 className="size-3.5" />}
          {view === "chart" ? "Table" : "Chart"}
        </button>
      }
    >
      {/* Legend: identity is never color alone. */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {available.map((item) => {
          const on = !hidden.has(item.key)
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(item.key)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                on ? "border-zinc-700 text-zinc-300 hover:border-zinc-600" : "border-zinc-800 text-zinc-600 line-through hover:text-zinc-400"
              }`}
            >
              <Swatch color={on ? item.color : "#3f3f46"} className="size-2" />
              {item.label}
            </button>
          )
        })}
      </div>
      {view === "chart" ? <DailyChart daily={daily} shown={shown} through={through} /> : <DailyTable daily={daily} shown={shown} />}
    </Card>
  )
}

// ── Models ──────────────────────────────────────────────────────────────────

function ModelTable({ rows, column, showProvider }: { rows: ReadonlyArray<ClineUsage["byModel"][number] & { color?: string }>; column: string; showProvider?: boolean }) {
  if (rows.length === 0) return <p className="p-4 text-sm text-zinc-500">No model usage in this period.</p>
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="px-4 py-2 text-left font-normal">Model</th>
            <th className="hidden py-2 pl-4 text-right font-normal whitespace-nowrap sm:table-cell">Responses</th>
            <th className="py-2 pl-4 text-right font-normal whitespace-nowrap">Tokens</th>
            <th className="py-2 pr-4 pl-4 text-right font-normal whitespace-nowrap">{column}</th>
          </tr>
        </thead>
        <tbody className="text-zinc-300">
          {rows.map((row) => (
            <tr key={row.model} className="border-t border-zinc-800/70">
              <td className="w-full max-w-0 px-4 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <ModelLogo modelId={row.model} className="size-4" />
                  <span className="truncate" title={row.model}>
                    {modelName(row.model)}
                  </span>
                  {showProvider && row.color && <Swatch color={row.color} className="size-2" />}
                </span>
              </td>
              <td className="hidden py-2 pl-4 text-right whitespace-nowrap text-zinc-400 sm:table-cell">{row.responses}</td>
              <td className="py-2 pl-4 text-right whitespace-nowrap">{compact(row.totalTokens)}</td>
              <td className="py-2 pr-4 pl-4 text-right whitespace-nowrap">{usd(row.listCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TopChats({ chats }: { chats: ClineUsage["byChat"] }) {
  return (
    <Card title="Top chats" flush>
      {chats.length === 0 ? (
        <p className="p-4 text-sm text-zinc-500">No chats used models in this period.</p>
      ) : (
        <ul className="divide-y divide-zinc-800/70 text-sm">
          {chats.map((chat) => (
            <li key={chat.sessionId} className="flex items-center gap-3 px-4 py-2">
              {chat.title === "Deleted chat" ? (
                <span className="min-w-0 truncate text-zinc-500">{chat.title}</span>
              ) : (
                <Link to="/chat/$sessionId" params={{ sessionId: chat.sessionId }} className="min-w-0 truncate text-zinc-300 hover:text-zinc-100 hover:underline">
                  {chat.title}
                </Link>
              )}
              <span className="ml-auto shrink-0 text-xs text-zinc-500 tabular-nums">
                {compact(chat.totalTokens)} · {usd(chat.listCost)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

const resetsIn = (iso: string) => {
  const ms = Date.parse(iso) - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return "resetting now"
  const hours = ms / 3_600_000
  if (hours < 1) return `resets in ${Math.max(1, Math.round(ms / 60_000))} min`
  if (hours < 48) return `resets in ${Math.round(hours)} h`
  return `resets ${new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" })}`
}

function OpenCodeWindowMeter({ label, window: value }: { label: string; window: OpenCodeWindow }) {
  return (
    <Meter
      label={label}
      percent={value.percent}
      limited={value.limited}
      color={series("opencode").color}
      value={
        <>
          <span className={value.limited ? "font-medium text-red-400" : "text-zinc-200"}>{value.limited ? "Limit reached" : `${Math.round(value.percent)}% used`}</span>
          {" · "}
          {resetsIn(value.resetsAt)}
        </>
      }
    />
  )
}

/** OpenCode Go's allowance, read live from OpenCode. */
function OpenCodeAllowance({ usage }: { usage: OpenCodeUsage }) {
  return (
    <Card
      title="Allowance"
      info="Go's included usage is a dollar amount per month, counted at each model's rates. Any 5 hours may use up to 20% of it and any week 50%. Read live from OpenCode."
      icon={<Swatch color={series("opencode").color} />}
      aside={
        <a href="https://opencode.ai/auth" target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-zinc-200 hover:underline">
          Console
        </a>
      }
    >
      {usage.limits ? (
        <div className="space-y-3">
          <OpenCodeWindowMeter label="5-hour window" window={usage.limits.rolling} />
          <OpenCodeWindowMeter label="This week" window={usage.limits.weekly} />
          <OpenCodeWindowMeter label="This month" window={usage.limits.monthly} />
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          {usage.limitsError ? `Couldn't read it from OpenCode: ${usage.limitsError}` : "Connect OpenCode Go in Settings to see it."}
        </p>
      )}
    </Card>
  )
}

/** Command Code's Goat allowance against what Dex used; Command Code has no API for its own meters. */
function CommandCodeAllowance({ usage }: { usage: CommandCodeUsage }) {
  const windows = [
    {
      label: "Last 5 hours",
      spent: usage.spent.fiveHours,
      cap: COMMANDCODE_LIMITS.fiveHours
    },
    {
      label: "Last 7 days",
      spent: usage.spent.week,
      cap: COMMANDCODE_LIMITS.week
    },
    {
      label: "Last 30 days",
      spent: usage.spent.month,
      cap: COMMANDCODE_LIMITS.month
    }
  ]
  return (
    <Card
      title="Allowance"
      info={`The Goat plan includes up to ${usd(COMMANDCODE_LIMITS.month)} of usage a month at each model's API rates, with up to ${usd(COMMANDCODE_LIMITS.fiveHours)} in any 5 hours and ${usd(COMMANDCODE_LIMITS.week)} in any week. These are Dex's own chats; Command Code's CLI and other clients count too, and its windows start at your first request. Studio shows the exact meters.`}
      icon={<Swatch color={series("commandcode").color} />}
      aside={
        <a href="https://commandcode.ai/usage" target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-zinc-200 hover:underline">
          Studio
        </a>
      }
    >
      <div className="space-y-3">
        {windows.map((window) => (
          <Meter
            key={window.label}
            label={window.label}
            percent={(window.spent / window.cap) * 100}
            color={series("commandcode").color}
            value={
              <>
                <span className="text-zinc-200">{usd(window.spent)}</span> of {usd(window.cap)}
              </>
            }
          />
        ))}
        <p className="text-xs text-zinc-500">Estimated from Dex's chats only.</p>
      </div>
    </Card>
  )
}

function ModelsTab({ report, visible, provider }: { report: UsageReport; visible: ReadonlyArray<Subscription>; provider: ModelProvider | undefined }) {
  const chosen = visible.find((subscription) => subscription.id === provider)
  const all = visible.flatMap((subscription) => {
    const usage = tokensOf(report, subscription)
    return usage ? [{ subscription, usage }] : []
  })
  const sum = (pick: (usage: ClineUsage) => number) => all.reduce((total, { usage }) => total + pick(usage), 0)

  return (
    <div className="space-y-4">
      {/* Filter: one subscription, or all of them together. */}
      <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4">
        {[undefined, ...visible].map((subscription) => {
          const selected = subscription?.id === chosen?.id
          const tokens = subscription ? (tokensOf(report, subscription)?.totalTokens ?? 0) : sum((usage) => usage.totalTokens)
          return (
            <Link
              key={subscription?.id ?? "all"}
              to="/usage"
              search={{
                tab: "models",
                ...(subscription && { provider: subscription.id })
              }}
              replace
              aria-current={selected ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${
                selected ? "bg-zinc-100 text-zinc-900" : "border border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              }`}
            >
              {subscription && <Swatch color={series(subscription.key).color} className="size-2" />}
              {subscription ? series(subscription.key).label : "All"}
              <span className={selected ? "text-zinc-500" : "text-zinc-600"}>{compact(tokens)}</span>
            </Link>
          )
        })}
      </div>

      {chosen ? (
        <SubscriptionDetail report={report} subscription={chosen} />
      ) : (
        <>
          <Stats
            items={[
              {
                label: "Responses",
                value: compact(sum((usage) => usage.responses))
              },
              {
                label: "Tokens",
                value: compact(sum((usage) => usage.totalTokens)),
                detail: `${compact(sum((usage) => usage.outputTokens))} output`
              },
              {
                label: "Cached input",
                value: compact(sum((usage) => usage.cacheReadTokens))
              },
              {
                label: "Worth at model rates",
                value: usd(sum((usage) => usage.listCost)),
                detail: "covered by your plans"
              }
            ]}
          />
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <Card
              title="By model"
              flush
              aside={
                <span className="flex items-center gap-1">
                  Value{" "}
                  <InfoTip label="About value">
                    Each subscription's tokens at its rates: API list prices for ClinePass and ChatGPT, the plans' own rates for OpenCode Go and Command Code.
                  </InfoTip>
                </span>
              }
            >
              <ModelTable
                column="Value"
                showProvider
                rows={all
                  .flatMap(({ subscription, usage }) =>
                    usage.byModel.map((row) => ({
                      ...row,
                      color: series(subscription.key).color
                    }))
                  )
                  .sort((a, b) => b.listCost - a.listCost)}
              />
            </Card>
            <TopChats
              chats={[
                ...all
                  .flatMap(({ usage }) => usage.byChat)
                  .reduce((chats, chat) => {
                    const merged = chats.get(chat.sessionId)
                    chats.set(
                      chat.sessionId,
                      merged
                        ? {
                            ...merged,
                            totalTokens: merged.totalTokens + chat.totalTokens,
                            listCost: merged.listCost + chat.listCost
                          }
                        : chat
                    )
                    return chats
                  }, new Map<string, ClineUsage["byChat"][number]>())
                  .values()
              ]
                .sort((a, b) => b.listCost - a.listCost)
                .slice(0, 10)}
            />
          </div>
        </>
      )}
    </div>
  )
}

function SubscriptionDetail({ report, subscription }: { report: UsageReport; subscription: Subscription }) {
  const usage = tokensOf(report, subscription)
  if (!usage) return <p className="text-sm text-zinc-500">Dex needs an update to report this subscription.</p>
  const allowance =
    subscription.id === "opencode-go" ? (
      <OpenCodeAllowance usage={report.opencode} />
    ) : subscription.id === "commandcode" && report.commandcode ? (
      <CommandCodeAllowance usage={report.commandcode} />
    ) : null
  return (
    <>
      <Stats
        items={[
          {
            label: "Plan",
            value: subscription.fee === null ? "ChatGPT" : `${usd(subscription.fee)}/mo`,
            detail: subscription.fee === null ? "your ChatGPT plan" : "flat fee"
          },
          { label: "Responses", value: compact(usage.responses) },
          {
            label: "Tokens",
            value: compact(usage.totalTokens),
            detail: `${compact(usage.inputTokens + usage.cacheReadTokens)} in · ${compact(usage.outputTokens)} out`
          },
          {
            label: "Worth",
            value: usd(usage.listCost),
            detail: subscription.rates
          }
        ]}
      />
      {allowance}
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card title="By model" flush>
          <ModelTable rows={usage.byModel} column={subscription.column} />
        </Card>
        <TopChats chats={usage.byChat} />
      </div>
    </>
  )
}

// ── Machines and Cloudflare ─────────────────────────────────────────────────

const duration = (hours: number) => (hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} h`)

function MachinesTab({ report }: { report: UsageReport }) {
  const { boat } = report
  return (
    <div className="space-y-4">
      <Stats
        items={[
          {
            label: "VM time cost",
            value: usd(boat.cost),
            detail: "billed per second"
          },
          { label: "Hours", value: boat.hours.toFixed(1) },
          {
            label: "Runs",
            value: String(boat.runs.length),
            detail: boat.runs.length >= 20 ? "latest 20 below" : undefined
          },
          { label: "Now", value: boat.running ? "Running" : "Stopped" }
        ]}
      />
      <Card
        title="boat.dev VM runs"
        icon={<Swatch color={series("boat").color} />}
        flush
        aside={boat.bySize.map((size) => `${size.size} ${duration(size.hours)}`).join(" · ")}
      >
        {boat.runs.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">The VM did not run in this period.</p>
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-2 text-left font-normal">Started</th>
                  <th className="py-2 pl-4 text-left font-normal">Size</th>
                  <th className="py-2 pl-4 text-right font-normal whitespace-nowrap">Duration</th>
                  <th className="py-2 pr-4 pl-4 text-right font-normal whitespace-nowrap">Cost</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {boat.runs.map((run) => (
                  <tr key={run.startedAt} className="border-t border-zinc-800/70">
                    <td className="px-4 py-2 whitespace-nowrap">
                      {new Date(run.startedAt).toLocaleString("en", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit"
                      })}
                      {run.endedAt === null && <span className="ml-1.5 text-xs text-emerald-400">running</span>}
                    </td>
                    <td className="py-2 pl-4 text-zinc-400">{run.size}</td>
                    <td className="py-2 pl-4 text-right whitespace-nowrap">{duration(run.hours)}</td>
                    <td className="py-2 pr-4 pl-4 text-right whitespace-nowrap">{usd(run.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function CloudflareTab({ report }: { report: UsageReport }) {
  const { cloudflare } = report
  return (
    <div className="space-y-4">
      <Stats
        items={[
          {
            label: "Plan",
            value: `${usd(PLAN_FEES.workersPaid)}/mo`,
            detail: "Workers Paid"
          },
          {
            label: "Metered",
            value: cloudflare.configured && !cloudflare.error ? usd(cloudflare.meteredCost) : "—",
            detail: "at list rates"
          },
          {
            label: "Most used allowance",
            value: (() => {
              const top = Math.max(0, ...cloudflare.lines.map((line) => line.allowanceUsed ?? 0))
              return cloudflare.configured && !cloudflare.error && report.range !== "all" ? (top < 0.001 ? "<0.1%" : `${(top * 100).toFixed(1)}%`) : "—"
            })()
          },
          {
            label: "Since",
            value: shortDate(new Date(cloudflare.since).toISOString().slice(0, 10)),
            detail: "Cloudflare keeps ~30 days"
          }
        ]}
      />
      <Card title="Meters" icon={<Swatch color={series("cloudflare").color} />} flush={cloudflare.configured && !cloudflare.error}>
        {!cloudflare.configured ? (
          <div className="space-y-2 text-sm text-zinc-400">
            <p>Cloudflare usage comes from its Analytics API, which needs a read-only token:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token with{" "}
                <span className="text-zinc-200">Account · Account Analytics · Read</span>
              </li>
              <li>
                Run <code className="rounded bg-zinc-800 px-1 text-zinc-200">npx wrangler secret put CLOUDFLARE_API_TOKEN</code> and paste it
              </li>
            </ol>
          </div>
        ) : cloudflare.error ? (
          <p className="text-sm text-amber-300">{cloudflare.error}</p>
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-2 text-left font-normal">Meter</th>
                  <th className="py-2 text-right font-normal">Used</th>
                  <th className="hidden py-2 pl-4 text-left font-normal sm:table-cell">Of monthly allowance</th>
                  <th className="py-2 pr-4 pl-4 text-right font-normal">At list rate</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {cloudflare.lines.map((line) => (
                  <tr key={line.label} className="border-t border-zinc-800/70">
                    <td className="px-4 py-2">
                      {line.label}
                      {line.accountWide && <span className="ml-1.5 text-[10px] text-zinc-500">whole account</span>}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {compact(line.quantity)} <span className="text-xs text-zinc-500">{line.unit}</span>
                    </td>
                    <td className="hidden py-2 pl-4 sm:table-cell">
                      {line.allowanceUsed !== null && (
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-800">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${Math.min(100, Math.max(1, line.allowanceUsed * 100))}%`,
                                background: series("cloudflare").color
                              }}
                            />
                          </span>
                          <span className="text-xs text-zinc-500">{line.allowanceUsed < 0.001 ? "<0.1%" : `${(line.allowanceUsed * 100).toFixed(1)}%`}</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 pl-4 text-right">{usd(line.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Overview ────────────────────────────────────────────────────────────────

/** A trend under a headline number: one thin bar per day, no axes (the number above says what it is). */
function MiniBars({ values, color, label }: { values: ReadonlyArray<number>; color: string; label: string }) {
  const max = Math.max(...values, 0)
  return (
    <div className="flex h-8 items-end gap-[2px]" role="img" aria-label={label}>
      {values.map((value, index) => (
        <div
          key={index}
          className="max-w-3 min-w-px flex-1 rounded-t-[2px]"
          style={{ height: max > 0 && value > 0 ? `${Math.max(8, (value / max) * 100)}%` : "2px", background: max > 0 && value > 0 ? color : "#27272a" }}
        />
      ))}
    </div>
  )
}

/** A headline number with its trend over the period. */
function Kpi({
  label,
  value,
  detail,
  trend,
  color,
  to
}: {
  label: string
  value: string
  detail: ReactNode
  trend?: ReadonlyArray<number>
  color: string
  to?: UsageSearch
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span className="truncate">{label}</span>
        {to && <ChevronRight className="size-3.5 shrink-0 text-zinc-700 transition-colors group-hover:text-zinc-400" />}
      </div>
      <div className="mt-1.5 truncate text-2xl font-semibold tracking-tight text-zinc-50 tabular-nums">{value}</div>
      <div className="mt-0.5 truncate text-xs text-zinc-500">{detail}</div>
      <div className="mt-3">{trend ? <MiniBars values={trend} color={color} label={`${label} by day`} /> : <div className="h-8" />}</div>
    </>
  )
  const className = "group block min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
  return to ? (
    <Link to="/usage" search={to} replace className={`${className} transition-colors hover:border-zinc-700 hover:bg-zinc-900/70`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

/** Ranked rows with a thin bar each, sized against the largest. */
function BarList({
  rows,
  empty
}: {
  rows: ReadonlyArray<{ key: string; label: ReactNode; value: number; display: string; detail?: string; color: string; icon?: ReactNode; link?: ReactNode }>
  empty: string
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-zinc-500">{empty}</p>
  const max = Math.max(...rows.map((row) => row.value), 0)
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.key} className="min-w-0">
          <div className="flex items-center gap-2 text-sm">
            {row.icon}
            <span className="min-w-0 flex-1 truncate text-zinc-200">{row.link ?? row.label}</span>
            {row.detail && <span className="hidden shrink-0 text-xs text-zinc-500 tabular-nums sm:inline">{row.detail}</span>}
            <span className="w-16 shrink-0 text-right text-zinc-100 tabular-nums">{row.display}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800/70">
            <div className="h-full rounded-full" style={{ width: `${max > 0 ? Math.max(2, (row.value / max) * 100) : 0}%`, background: row.color }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** One window of an allowance, compact: name, share used, when it resets. */
function WindowRow({ label, percent, note, limited, color }: { label: string; percent: number; note: string; limited?: boolean; color: string }) {
  const clamped = Math.min(100, Math.max(0, percent))
  const tone = limited || clamped >= 100 ? "#ef4444" : clamped >= 80 ? "#f59e0b" : color
  return (
    <div>
      <div className="flex items-baseline gap-2 text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="ml-auto text-zinc-600">{note}</span>
        <span className={`w-12 text-right tabular-nums ${limited ? "font-medium text-red-400" : clamped >= 80 ? "text-amber-300" : "text-zinc-200"}`}>
          {limited ? "Limit" : clamped > 0 && clamped < 1 ? "<1%" : `${Math.round(clamped)}%`}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800"
        role="meter"
        aria-label={`${label}: ${Math.round(clamped)}% used`}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full" style={{ width: `${Math.max(clamped, clamped > 0 ? 2 : 0)}%`, background: tone }} />
      </div>
    </div>
  )
}

/** Every allowance in one place: OpenCode Go's live windows, Command Code's estimate, Cloudflare's busiest meter. */
function Status({ report, working, unread }: { report: UsageReport; working: number; unread: number }) {
  const groups: Array<{ key: SeriesKey; title: string; note?: string; search: UsageSearch; rows: ReactNode }> = []
  const opencode = series("opencode").color
  if (report.opencode.limits) {
    const { rolling, weekly, monthly } = report.opencode.limits
    groups.push({
      key: "opencode",
      title: "OpenCode Go",
      note: "live",
      search: { tab: "models", provider: "opencode-go" },
      rows: (
        <>
          <WindowRow label="5 hours" percent={rolling.percent} limited={rolling.limited} note={resetsIn(rolling.resetsAt)} color={opencode} />
          <WindowRow label="Week" percent={weekly.percent} limited={weekly.limited} note={resetsIn(weekly.resetsAt)} color={opencode} />
          <WindowRow label="Month" percent={monthly.percent} limited={monthly.limited} note={resetsIn(monthly.resetsAt)} color={opencode} />
        </>
      )
    })
  }
  if (report.commandcode?.connected) {
    const { spent } = report.commandcode
    const color = series("commandcode").color
    groups.push({
      key: "commandcode",
      title: "Command Code",
      note: "estimated",
      search: { tab: "models", provider: "commandcode" },
      rows: (
        <>
          <WindowRow
            label="5 hours"
            percent={(spent.fiveHours / COMMANDCODE_LIMITS.fiveHours) * 100}
            note={`${usd(spent.fiveHours)} of ${usd(COMMANDCODE_LIMITS.fiveHours)}`}
            color={color}
          />
          <WindowRow label="7 days" percent={(spent.week / COMMANDCODE_LIMITS.week) * 100} note={`${usd(spent.week)} of ${usd(COMMANDCODE_LIMITS.week)}`} color={color} />
          <WindowRow
            label="30 days"
            percent={(spent.month / COMMANDCODE_LIMITS.month) * 100}
            note={`${usd(spent.month)} of ${usd(COMMANDCODE_LIMITS.month)}`}
            color={color}
          />
        </>
      )
    })
  }
  if (report.cloudflare.configured && !report.cloudflare.error && report.range !== "all") {
    const busiest = [...report.cloudflare.lines].filter((line) => line.allowanceUsed !== null).sort((a, b) => (b.allowanceUsed ?? 0) - (a.allowanceUsed ?? 0))[0]
    if (busiest)
      groups.push({
        key: "cloudflare",
        title: "Cloudflare",
        note: "busiest meter",
        search: { tab: "cloudflare" },
        rows: <WindowRow label={busiest.label} percent={(busiest.allowanceUsed ?? 0) * 100} note="of the monthly allowance" color={series("cloudflare").color} />
      })
  }
  return (
    <Card
      title="Status"
      info="What's running now, and how much of each plan's included usage is used. OpenCode Go's is read live; Command Code's is estimated from Dex's chats (its CLI and other clients count too)."
    >
      {/* Right now. */}
      <div className="mb-5 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 text-center">
        {[
          { label: "Working", value: String(working), live: working > 0 },
          { label: "Unread", value: String(unread), live: false },
          { label: "VM", value: report.boat.running ? "On" : "Off", live: report.boat.running }
        ].map((item) => (
          <div key={item.label} className="bg-zinc-950 px-2 py-2.5">
            <div className="flex items-center justify-center gap-1.5 text-base font-semibold text-zinc-100 tabular-nums">
              {item.live && <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />}
              {item.value}
            </div>
            <div className="text-[11px] text-zinc-500">{item.label}</div>
          </div>
        ))}
      </div>
      {groups.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-500">No plan with an allowance is connected.</p>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.key} className="space-y-2.5">
              <Link to="/usage" search={group.search} replace className="group flex items-center gap-2 text-xs">
                <Swatch color={series(group.key).color} className="size-2" />
                <span className="font-medium text-zinc-300 group-hover:text-zinc-100">{group.title}</span>
                {group.note && <span className="text-zinc-600">{group.note}</span>}
                <ChevronRight className="ml-auto size-3.5 text-zinc-700 group-hover:text-zinc-400" />
              </Link>
              {group.rows}
            </section>
          ))}
        </div>
      )}
    </Card>
  )
}

function OverviewTab({ report, visible, clineConnected }: { report: UsageReport; visible: ReadonlyArray<Subscription>; clineConnected: boolean }) {
  const { state } = useDex()
  const isMonth = report.range === "month"
  const usages = visible.flatMap((subscription) => {
    const usage = tokensOf(report, subscription)
    return usage ? [{ subscription, usage }] : []
  })
  const sum = (pick: (usage: ClineUsage) => number) => usages.reduce((total, { usage }) => total + pick(usage), 0)
  const worth = sum((usage) => usage.listCost)
  const tokens = sum((usage) => usage.totalTokens)
  const responses = sum((usage) => usage.responses)
  const cached = sum((usage) => usage.cacheReadTokens)
  const input = sum((usage) => usage.inputTokens) + cached

  // What the bill is made of: the flat plans Dex knows about, plus VM time.
  const connectedPlan = (subscription: Subscription) =>
    subscription.id === "clinepass"
      ? clineConnected
      : subscription.id === "opencode-go"
        ? report.opencode.connected
        : subscription.id === "commandcode" && Boolean(report.commandcode?.connected)
  const parts = [
    ...SUBSCRIPTIONS.flatMap((subscription) =>
      subscription.fee !== null && connectedPlan(subscription) ? [{ key: subscription.key as SeriesKey, value: subscription.fee }] : []
    ),
    { key: "cloudflare" as SeriesKey, value: PLAN_FEES.workersPaid },
    { key: "boat" as SeriesKey, value: report.boat.cost }
  ]
  const plans = parts.filter((part) => part.key !== "boat").reduce((total, part) => total + part.value, 0)
  const modelPlans = parts.filter((part) => part.key !== "boat" && part.key !== "cloudflare").reduce((total, part) => total + part.value, 0)

  // Insights.
  const modelKeys = visible.map((subscription) => subscription.key)
  const dayModelValue = (day: DailySpend) => modelKeys.reduce((total, key) => total + (day[key] ?? 0), 0)
  const busiest = [...report.daily].sort((a, b) => dayModelValue(b) + b.boat - (dayModelValue(a) + a.boat))[0]
  const models = usages.flatMap(({ subscription, usage }) => usage.byModel.map((row) => ({ ...row, subscription }))).sort((a, b) => b.listCost - a.listCost)
  const topByTokens = [...models].sort((a, b) => b.totalTokens - a.totalTokens)[0]
  const chats = [
    ...usages
      .flatMap(({ usage }) => usage.byChat)
      .reduce((all, chat) => {
        const merged = all.get(chat.sessionId)
        all.set(chat.sessionId, merged ? { ...merged, totalTokens: merged.totalTokens + chat.totalTokens, listCost: merged.listCost + chat.listCost } : chat)
        return all
      }, new Map<string, ClineUsage["byChat"][number]>())
      .values()
  ].sort((a, b) => b.listCost - a.listCost)

  const sessions = state?.sessions ?? []
  const working = sessions.filter((session) => session.busy).length
  const unread = sessions.filter((session) => session.unread).length
  const accent = "#34d399"
  // This month's trends span the whole month, so a few days in don't read as a full trend.
  const daysInMonth = new Date(Date.UTC(new Date(report.until).getUTCFullYear(), new Date(report.until).getUTCMonth() + 1, 0)).getUTCDate()
  const trend = (pick: (day: DailySpend) => number) => [
    ...report.daily.map(pick),
    ...Array.from({ length: isMonth ? Math.max(0, daysInMonth - report.daily.length) : 0 }, () => 0)
  ]
  const monthName = new Date(report.until).toLocaleDateString("en", { month: "long" })

  const insights = [
    modelPlans > 0 &&
      worth > 0 && {
        label: worth >= modelPlans ? "Your plans are worth" : "Plan value used",
        value: worth >= modelPlans ? `${(worth / modelPlans).toFixed(worth / modelPlans >= 10 ? 0 : 1)}× their price` : `${Math.round((worth / modelPlans) * 100)}%`,
        detail: `${usd(worth)} at model rates · ${usd(modelPlans)}/mo in plans`
      },
    busiest &&
      dayModelValue(busiest) + busiest.boat > 0 && {
        label: "Busiest day",
        value: shortDate(busiest.date),
        detail: `${usd(dayModelValue(busiest))} of models${busiest.boat > 0 ? ` · ${usd(busiest.boat)} of VM time` : ""}${busiest.tokens ? ` · ${compact(busiest.tokens)} tokens` : ""}`
      },
    topByTokens &&
      tokens > 0 && {
        label: "Most used model",
        value: modelName(topByTokens.model),
        detail: `${Math.round((topByTokens.totalTokens / tokens) * 100)}% of tokens · ${series(topByTokens.subscription.key).label}`
      }
  ].filter(Boolean) as Array<{ label: string; value: string; detail: string }>

  const services = [
    ...visible.map((subscription) => {
      const usage = tokensOf(report, subscription)!
      return {
        key: subscription.key as SeriesKey,
        price: subscription.fee === null ? "ChatGPT plan" : `${usd(subscription.fee)}/mo`,
        summary: `${compact(usage.totalTokens)} tokens · worth ${usd(usage.listCost)}`,
        search: { tab: "models", provider: subscription.id } as UsageSearch
      }
    }),
    {
      key: "boat" as SeriesKey,
      price: usd(report.boat.cost),
      summary: `${duration(report.boat.hours)} of VM time${report.boat.running ? " · running now" : ""}`,
      search: { tab: "machines" } as UsageSearch
    },
    {
      key: "cloudflare" as SeriesKey,
      price: `${usd(PLAN_FEES.workersPaid)}/mo`,
      summary: report.cloudflare.configured
        ? report.cloudflare.error
          ? "Analytics unavailable"
          : `${usd(report.cloudflare.meteredCost)} metered, in the allowance`
        : "Add an analytics token",
      search: { tab: "cloudflare" } as UsageSearch
    }
  ]

  return (
    <div className="space-y-4">
      {/* The bill, and what stands out. */}
      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
        <div className="flex min-w-0 flex-col gap-5 p-5">
          <div>
            <div className="text-xs text-zinc-400">{isMonth ? `Estimated bill for ${monthName}` : `Plans, plus VM time in this period`}</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="text-4xl font-semibold tracking-tight text-zinc-50 tabular-nums">{usd(isMonth ? plans + report.boat.cost : report.boat.cost)}</span>
              <span className="text-sm text-zinc-500">
                {isMonth ? `${usd(plans)} in plans + ${usd(report.boat.cost)} of VM time` : `VM time · plans add ${usd(plans)} a month`}
              </span>
            </div>
          </div>
          <div>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-zinc-800" role="img" aria-label="What the bill is made of">
              {parts
                .filter((part) => part.value > 0)
                .map((part) => (
                  <div key={part.key} style={{ flexGrow: part.value, background: series(part.key).color }} />
                ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
              {parts.map((part) => (
                <span key={part.key} className="flex items-center gap-1.5 text-zinc-400">
                  <Swatch color={series(part.key).color} className="size-2" />
                  {series(part.key).label}
                  <span className="text-zinc-200 tabular-nums">{usd(part.value)}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <dl className="grid min-w-0 gap-4 border-t border-zinc-800 p-5 sm:grid-cols-3 sm:gap-6">
          {insights.length === 0 ? (
            <p className="text-sm text-zinc-500">Insights show up once your chats have used some models.</p>
          ) : (
            insights.map((insight) => (
              <div key={insight.label} className="min-w-0">
                <dt className="text-xs text-zinc-500">{insight.label}</dt>
                <dd className="mt-0.5 truncate text-lg font-semibold tracking-tight text-zinc-100">{insight.value}</dd>
                <dd className="truncate text-xs text-zinc-500" title={insight.detail}>
                  {insight.detail}
                </dd>
              </div>
            ))
          )}
        </dl>
      </section>

      {/* Headline numbers. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Model usage" value={usd(worth)} detail="at model rates, covered by plans" trend={trend(dayModelValue)} color={accent} to={{ tab: "models" }} />
        <Kpi
          label="Tokens"
          value={compact(tokens)}
          detail={input > 0 ? `${Math.round((cached / input) * 100)}% of input from cache` : "input and output"}
          trend={report.daily.some((day) => day.tokens !== undefined) ? trend((day) => day.tokens ?? 0) : undefined}
          color={accent}
          to={{ tab: "models" }}
        />
        <Kpi
          label="VM time"
          value={duration(report.boat.hours)}
          detail={`${usd(report.boat.cost)}${report.boat.running ? " · running now" : ` · ${report.boat.runs.length} ${report.boat.runs.length === 1 ? "run" : "runs"}`}`}
          trend={trend((day) => day.boat)}
          color={series("boat").color}
          to={{ tab: "machines" }}
        />
        <Kpi
          label="Responses"
          value={compact(responses)}
          detail={responses > 0 ? `${compact(tokens / responses)} tokens each, on average` : "model replies and tool steps"}
          trend={trend((day) => day.responses ?? 0)}
          color={accent}
          to={{ tab: "models" }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <DailyUsage
            daily={report.daily}
            through={isMonth ? daysInMonth : undefined}
            available={SERIES.filter((item) => item.key === "boat" || item.key === "cloudflare" || modelKeys.includes(item.key))}
          />
        </div>
        <Status report={report} working={working} unread={unread} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Top models"
          aside={
            <Link to="/usage" search={{ tab: "models" }} replace className="text-zinc-400 hover:text-zinc-200">
              All models
            </Link>
          }
        >
          <BarList
            empty="No model usage in this period."
            rows={models.slice(0, 5).map((row) => ({
              key: row.model,
              label: <span title={row.model}>{modelName(row.model)}</span>,
              icon: <ModelLogo modelId={row.model} className="size-4" />,
              value: row.listCost || row.totalTokens / 1e9,
              display: usd(row.listCost),
              detail: `${compact(row.totalTokens)} tokens`,
              color: series(row.subscription.key).color
            }))}
          />
        </Card>
        <Card title="Top chats" aside={<span>by model usage</span>}>
          <BarList
            empty="No chats used models in this period."
            rows={chats.slice(0, 5).map((chat) => ({
              key: chat.sessionId,
              label: chat.title,
              link:
                chat.title === "Deleted chat" ? (
                  <span className="text-zinc-500">{chat.title}</span>
                ) : (
                  <Link to="/chat/$sessionId" params={{ sessionId: chat.sessionId }} className="hover:underline">
                    {chat.title}
                  </Link>
                ),
              value: chat.listCost || chat.totalTokens / 1e9,
              display: usd(chat.listCost),
              detail: `${compact(chat.totalTokens)} tokens`,
              color: accent
            }))}
          />
        </Card>
      </div>

      <section>
        <h2 className="mb-2 px-1 text-xs font-medium text-zinc-500">Services</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => (
            <Link
              key={service.key}
              to="/usage"
              search={service.search}
              replace
              className="group flex min-w-0 items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 transition-colors hover:border-zinc-700 hover:bg-zinc-900/70"
            >
              <Swatch color={series(service.key).color} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm text-zinc-100">{series(service.key).label}</span>
                  <span className="ml-auto shrink-0 text-sm text-zinc-300 tabular-nums">{service.price}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-zinc-500">{service.summary}</div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-zinc-700 group-hover:text-zinc-400" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

function UsagePage() {
  const { stub, connected, state } = useDex()
  const { tab = "overview", provider } = Route.useSearch()
  const [range, setRange] = useState<UsageRange>("month")
  const fetchReport = useCallback(() => stub.usageReport(range) as Promise<UsageReport>, [range, stub])
  const { data: report, loading, error, refresh: load } = useCachedFetch(`usage:${range}`, fetchReport, connected)

  // A subscription appears once it's connected or was used in the period.
  const clineConnected = state?.cline.connected ?? true
  const visible = report
    ? SUBSCRIPTIONS.filter((subscription) => {
        const usage = tokensOf(report, subscription)
        if (!usage) return false
        const linked =
          subscription.id === "clinepass"
            ? clineConnected
            : subscription.id === "opencode-go"
              ? report.opencode.connected
              : subscription.id === "chatgpt"
                ? report.chatgpt?.connected
                : report.commandcode?.connected
        return linked || usage.totalTokens > 0
      })
    : []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="dex-chrome dex-topbar flex h-12 shrink-0 items-center gap-3 border-b border-zinc-900 px-4">
        <MenuButton />
        <span className="text-sm font-medium">Usage</span>
        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-lg border border-zinc-800 p-0.5">
            {USAGE_RANGES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setRange(option.id)}
                aria-pressed={range === option.id}
                className={`rounded-md px-2 py-1 text-xs whitespace-nowrap ${range === option.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {/* Short on the narrowest phones, where the full labels push the header off screen. */}
                <span className="min-[380px]:hidden">{option.id === "month" ? "Month" : option.id === "30d" ? "30 days" : "All"}</span>
                <span className="max-[379px]:hidden">{option.label}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void load()} title="Refresh" aria-label="Refresh" className="rounded-md p-1.5 text-zinc-500 hover:text-zinc-200">
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <nav className="scrollbar-none shrink-0 overflow-x-auto border-b border-zinc-900" aria-label="Usage sections">
        {/* Lined up with the content below. */}
        <div className="mx-auto flex max-w-6xl gap-1 px-2">
          {TABS.map((item) => {
            const selected = item.id === tab
            return (
              <Link
                key={item.id}
                to="/usage"
                search={item.id === "overview" ? {} : { tab: item.id }}
                replace
                aria-current={selected ? "page" : undefined}
                className={`-mb-px shrink-0 border-b-2 px-2.5 py-2.5 text-sm ${selected ? "border-zinc-100 text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      </nav>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {error && <p className="rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}
          {!report ? (
            <UsageSkeleton />
          ) : (
            <>
              {tab === "overview" && <OverviewTab report={report} visible={visible} clineConnected={clineConnected} />}
              {tab === "models" && <ModelsTab report={report} visible={visible} provider={provider} />}
              {tab === "machines" && <MachinesTab report={report} />}
              {tab === "cloudflare" && <CloudflareTab report={report} />}
              <p className="text-[11px] leading-relaxed text-zinc-600">
                Estimates from Dex's own records (model responses, VM run times) and Cloudflare's analytics, priced at public list rates (ClinePass{" "}
                {usd(PLAN_FEES.clinePass)}/mo, OpenCode Go {usd(PLAN_FEES.openCodeGo)}/mo, Command Code Goat {usd(PLAN_FEES.commandCode)}/mo plus a processing fee,
                Workers Paid {usd(PLAN_FEES.workersPaid)}/mo, boat.dev small $0.018/h). Your invoices are the source of truth. VM time before usage tracking started is
                not included.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
