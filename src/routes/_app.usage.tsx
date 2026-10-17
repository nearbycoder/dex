import { createFileRoute, Link } from "@tanstack/react-router"
import { BarChart3, Cloud, Cpu, LoaderCircle, RefreshCw, Sparkles, Table2 } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ModelLogo } from "~/client/components/model-logo"
import { useDex } from "~/client/lib/dex"
import { MenuButton } from "~/client/lib/mobile-nav"
import { findModel } from "~/shared/models"
import { type DailySpend, PLAN_FEES, USAGE_RANGES, type UsageRange, type UsageReport } from "~/shared/usage"

export const Route = createFileRoute("/_app/usage")({ component: UsagePage })

/** Validated categorical slots 1–3 (dark mode) from the data-viz reference palette, in fixed order. */
const SERIES = [
  { key: "cline", label: "ClinePass", note: "at API list prices", color: "#3987e5" },
  { key: "boat", label: "boat.dev", note: "VM time", color: "#d95926" },
  { key: "cloudflare", label: "Cloudflare", note: "metered", color: "#199e70" }
] as const

const usd = (value: number) =>
  value === 0 ? "$0.00" : value < 0.01 ? "<$0.01" : value < 100 ? `$${value.toFixed(2)}` : `$${Math.round(value).toLocaleString()}`

const compact = (value: number) =>
  Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: value < 1000 ? 0 : 1 }).format(value)

const shortDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })

function Tile(props: { icon: ReactNode; label: string; value: string; detail: ReactNode; swatch?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        {props.swatch && <span className="size-2.5 rounded-sm" style={{ background: props.swatch }} />}
        {props.icon}
        {props.label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50 tabular-nums">{props.value}</div>
      <div className="mt-1 text-xs leading-relaxed text-zinc-500">{props.detail}</div>
    </div>
  )
}

function Section({ title, icon, children, aside }: { title: string; icon: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-sm">
        {icon}
        <h2 className="font-medium text-zinc-200">{title}</h2>
        <div className="ml-auto text-xs text-zinc-500">{aside}</div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

/** Daily usage as stacked bars: thin marks, 2px gaps between segments, rounded tops, hover tooltip. */
function DailyChart({ daily }: { daily: ReadonlyArray<DailySpend> }) {
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
  const totals = daily.map((day) => day.cline + day.boat + day.cloudflare)
  const max = Math.max(...totals, 0.0001)
  const niceMax = (() => {
    const step = 10 ** Math.floor(Math.log10(max))
    return Math.ceil(max / step) * step
  })()
  const ticks = [0, niceMax / 2, niceMax]
  const slot = plotW / Math.max(1, daily.length)
  const barW = Math.max(2, Math.min(22, slot * 0.6))
  const y = (value: number) => pad.top + plotH - (value / niceMax) * plotH
  const labelEvery = Math.ceil(daily.length / Math.max(1, Math.floor(plotW / 56)))

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
          const segments = SERIES.map((series) => {
            const value = day[series.key]
            const segment = { series, value, from: base }
            base += value
            return segment
          }).filter((segment) => segment.value > 0)
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
      </svg>
      {hover !== null && daily[hover] && (
        <div
          className="pointer-events-none absolute top-0 z-10 w-44 rounded-lg border border-zinc-700 bg-zinc-950/95 p-2.5 text-xs shadow-xl"
          style={{ left: Math.min(Math.max(0, pad.left + hover * slot - 70), width - 180) }}
        >
          <div className="mb-1.5 font-medium text-zinc-200">{shortDate(daily[hover].date)}</div>
          {SERIES.map((series) => (
            <div key={series.key} className="flex items-center gap-2 py-0.5 text-zinc-400">
              <span className="size-2 rounded-sm" style={{ background: series.color }} />
              {series.label}
              <span className="ml-auto text-zinc-200 tabular-nums">{usd(daily[hover]![series.key])}</span>
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

function DailyTable({ daily }: { daily: ReadonlyArray<DailySpend> }) {
  return (
    <div className="scrollbar-thin max-h-72 overflow-auto">
      <table className="w-full text-xs tabular-nums">
        <thead className="sticky top-0 bg-zinc-950 text-zinc-500">
          <tr>
            <th className="py-1.5 text-left font-normal">Date</th>
            {SERIES.map((series) => (
              <th key={series.key} className="py-1.5 text-right font-normal">
                {series.label}
              </th>
            ))}
            <th className="py-1.5 text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody className="text-zinc-300">
          {[...daily].reverse().map((day) => (
            <tr key={day.date} className="border-t border-zinc-900">
              <td className="py-1.5">{shortDate(day.date)}</td>
              <td className="py-1.5 text-right">{usd(day.cline)}</td>
              <td className="py-1.5 text-right">{usd(day.boat)}</td>
              <td className="py-1.5 text-right">{usd(day.cloudflare)}</td>
              <td className="py-1.5 text-right text-zinc-100">{usd(day.cline + day.boat + day.cloudflare)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UsagePage() {
  const { stub, connected } = useDex()
  const [range, setRange] = useState<UsageRange>("month")
  const [report, setReport] = useState<UsageReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<"chart" | "table">("chart")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setReport(await stub.usageReport(range))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [range, stub])

  useEffect(() => {
    if (connected) void load()
  }, [connected, load])

  const isMonth = range === "month"
  const plans = PLAN_FEES.clinePass + PLAN_FEES.workersPaid

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-900 px-4">
        <MenuButton />
        <span className="text-sm font-medium">Usage</span>
        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-lg border border-zinc-800 p-0.5">
            {USAGE_RANGES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setRange(option.id)}
                className={`rounded-md px-2 py-1 text-xs ${range === option.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void load()} title="Refresh" className="rounded-md p-1.5 text-zinc-500 hover:text-zinc-200">
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-4 p-4">
          {error && <p className="rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}
          {!report ? (
            <div className="flex items-center gap-2 p-8 text-sm text-zinc-500">
              <LoaderCircle className="size-4 animate-spin" /> Loading usage…
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Tile
                  icon={<BarChart3 className="size-3.5" />}
                  label={isMonth ? "Estimated bill this month" : "Variable spend"}
                  value={usd(isMonth ? plans + report.boat.cost : report.boat.cost)}
                  detail={
                    isMonth
                      ? `Plans ${usd(plans)} (ClinePass + Workers Paid) + boat.dev ${usd(report.boat.cost)}`
                      : `boat.dev VM time. Plans add ${usd(plans)}/month.`
                  }
                />
                <Tile
                  swatch={SERIES[0].color}
                  icon={<Sparkles className="size-3.5" />}
                  label="ClinePass"
                  value={`${usd(PLAN_FEES.clinePass)}/mo`}
                  detail={`${compact(report.cline.totalTokens)} tokens in ${report.cline.responses} responses · worth ${usd(report.cline.listCost)} at API list prices`}
                />
                <Tile
                  swatch={SERIES[1].color}
                  icon={<Cpu className="size-3.5" />}
                  label="boat.dev"
                  value={usd(report.boat.cost)}
                  detail={
                    <>
                      {report.boat.hours.toFixed(1)} h of VM time
                      {report.boat.running && <span className="ml-1 text-emerald-400">· running now</span>}
                    </>
                  }
                />
                <Tile
                  swatch={SERIES[2].color}
                  icon={<Cloud className="size-3.5" />}
                  label="Cloudflare"
                  value={`${usd(PLAN_FEES.workersPaid)}/mo`}
                  detail={
                    report.cloudflare.configured
                      ? report.cloudflare.error
                        ? "Analytics unavailable right now"
                        : `${usd(report.cloudflare.meteredCost)} of metered usage, inside the plan's included allowance`
                      : "Add an analytics token to see usage"
                  }
                />
              </div>

              <Section
                title="Daily usage"
                icon={<BarChart3 className="size-4 text-zinc-500" />}
                aside={
                  <div className="flex items-center gap-3">
                    {/* Legend: identity is never color alone. */}
                    {SERIES.map((series) => (
                      <span key={series.key} className="hidden items-center gap-1.5 text-zinc-400 sm:flex">
                        <span className="size-2.5 rounded-sm" style={{ background: series.color }} />
                        {series.label}
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() => setView(view === "chart" ? "table" : "chart")}
                      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      {view === "chart" ? <Table2 className="size-3.5" /> : <BarChart3 className="size-3.5" />}
                      {view === "chart" ? "Table" : "Chart"}
                    </button>
                  </div>
                }
              >
                <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 sm:hidden">
                  {SERIES.map((series) => (
                    <span key={series.key} className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-sm" style={{ background: series.color }} />
                      {series.label}
                    </span>
                  ))}
                </div>
                {view === "chart" ? <DailyChart daily={report.daily} /> : <DailyTable daily={report.daily} />}
                <p className="mt-2 text-[11px] text-zinc-600">
                  ClinePass is shown at what its tokens would cost at API list prices; you pay the flat plan. Cloudflare is metered usage at
                  list rates before the included allowance.
                </p>
              </Section>

              <div className="grid gap-4 lg:grid-cols-2">
                <Section title="ClinePass by model" icon={<span className="size-2.5 rounded-sm" style={{ background: SERIES[0].color }} />} aside={`${compact(report.cline.totalTokens)} tokens`}>
                  {report.cline.byModel.length === 0 ? (
                    <p className="text-sm text-zinc-500">No model usage in this period.</p>
                  ) : (
                    <table className="w-full text-sm tabular-nums">
                      <thead className="text-xs text-zinc-500">
                        <tr>
                          <th className="pb-2 text-left font-normal">Model</th>
                          <th className="pb-2 text-right font-normal">Responses</th>
                          <th className="pb-2 text-right font-normal">Tokens</th>
                          <th className="pb-2 text-right font-normal">List price</th>
                        </tr>
                      </thead>
                      <tbody className="text-zinc-300">
                        {report.cline.byModel.map((row) => (
                          <tr key={row.model} className="border-t border-zinc-800/70">
                            <td className="py-2">
                              <span className="flex items-center gap-2">
                                <ModelLogo modelId={row.model} className="size-4" />
                                {findModel(row.model)?.name ?? row.model}
                              </span>
                            </td>
                            <td className="py-2 text-right">{row.responses}</td>
                            <td className="py-2 text-right">{compact(row.totalTokens)}</td>
                            <td className="py-2 text-right">{usd(row.listCost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {report.cline.byChat.length > 0 && (
                    <>
                      <h3 className="mt-5 mb-2 text-xs font-medium text-zinc-400">Top chats</h3>
                      <ul className="space-y-1 text-sm">
                        {report.cline.byChat.map((chat) => (
                          <li key={chat.sessionId} className="flex items-center gap-3">
                            {chat.title === "Deleted chat" ? (
                              <span className="truncate text-zinc-500">{chat.title}</span>
                            ) : (
                              <Link to="/chat/$sessionId" params={{ sessionId: chat.sessionId }} className="truncate text-zinc-300 hover:text-zinc-100 hover:underline">
                                {chat.title}
                              </Link>
                            )}
                            <span className="ml-auto shrink-0 text-xs text-zinc-500 tabular-nums">
                              {compact(chat.totalTokens)} · {usd(chat.listCost)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </Section>

                <Section title="boat.dev VM time" icon={<span className="size-2.5 rounded-sm" style={{ background: SERIES[1].color }} />} aside="billed per second">
                  {report.boat.runs.length === 0 ? (
                    <p className="text-sm text-zinc-500">The VM did not run in this period.</p>
                  ) : (
                    <>
                      <div className="mb-4 flex flex-wrap gap-2">
                        {report.boat.bySize.map((size) => (
                          <span key={size.size} className="rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300 tabular-nums">
                            {size.size} · {size.hours.toFixed(1)} h · {usd(size.cost)}
                          </span>
                        ))}
                      </div>
                      <table className="w-full text-sm tabular-nums">
                        <thead className="text-xs text-zinc-500">
                          <tr>
                            <th className="pb-2 text-left font-normal">Started</th>
                            <th className="pb-2 text-right font-normal">Duration</th>
                            <th className="pb-2 text-right font-normal">Cost</th>
                          </tr>
                        </thead>
                        <tbody className="text-zinc-300">
                          {report.boat.runs.map((run) => (
                            <tr key={run.startedAt} className="border-t border-zinc-800/70">
                              <td className="py-2">
                                {new Date(run.startedAt).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                                {run.endedAt === null && <span className="ml-1.5 text-xs text-emerald-400">running</span>}
                              </td>
                              <td className="py-2 text-right">{run.hours < 1 ? `${Math.round(run.hours * 60)} min` : `${run.hours.toFixed(1)} h`}</td>
                              <td className="py-2 text-right">{usd(run.cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </Section>
              </div>

              <Section
                title="Cloudflare"
                icon={<span className="size-2.5 rounded-sm" style={{ background: SERIES[2].color }} />}
                aside={report.cloudflare.configured ? `since ${shortDate(new Date(report.cloudflare.since).toISOString().slice(0, 10))}` : undefined}
              >
                {!report.cloudflare.configured ? (
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
                ) : report.cloudflare.error ? (
                  <p className="text-sm text-amber-300">{report.cloudflare.error}</p>
                ) : (
                  <table className="w-full text-sm tabular-nums">
                    <thead className="text-xs text-zinc-500">
                      <tr>
                        <th className="pb-2 text-left font-normal">Meter</th>
                        <th className="pb-2 text-right font-normal">Used</th>
                        <th className="hidden pb-2 pl-4 text-left font-normal sm:table-cell">Of monthly allowance</th>
                        <th className="pb-2 text-right font-normal">At list rate</th>
                      </tr>
                    </thead>
                    <tbody className="text-zinc-300">
                      {report.cloudflare.lines.map((line) => (
                        <tr key={line.label} className="border-t border-zinc-800/70">
                          <td className="py-2">
                            {line.label}
                            {line.accountWide && <span className="ml-1.5 text-[10px] text-zinc-500">whole account</span>}
                          </td>
                          <td className="py-2 text-right">
                            {compact(line.quantity)} <span className="text-xs text-zinc-500">{line.unit}</span>
                          </td>
                          <td className="hidden py-2 pl-4 sm:table-cell">
                            {line.allowanceUsed !== null && (
                              <span className="flex items-center gap-2">
                                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-800">
                                  <span
                                    className="block h-full rounded-full"
                                    style={{ width: `${Math.min(100, Math.max(1, line.allowanceUsed * 100))}%`, background: SERIES[2].color }}
                                  />
                                </span>
                                <span className="text-xs text-zinc-500">
                                  {line.allowanceUsed < 0.001 ? "<0.1%" : `${(line.allowanceUsed * 100).toFixed(1)}%`}
                                </span>
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right">{usd(line.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              <p className="text-[11px] leading-relaxed text-zinc-600">
                Estimates from Dex's own records (model responses, VM run times) and Cloudflare's analytics, priced at public list rates
                (ClinePass {usd(PLAN_FEES.clinePass)}/mo, Workers Paid {usd(PLAN_FEES.workersPaid)}/mo, boat.dev small $0.018/h). Your invoices are
                the source of truth. VM time before usage tracking started is not included.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
