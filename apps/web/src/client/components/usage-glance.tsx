import { Link } from "@tanstack/react-router"
import { BarChart3 } from "lucide-react"
import { useCallback, useEffect, useRef } from "react"
import { useCachedFetch } from "~/client/lib/cache"
import { useDex } from "~/client/lib/dex"
import type { UsageGlance, UsageMeter } from "~/shared/usage"

const tokenCount = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })

/** "2 h", "14 min", "Nov 9": how long until a window resets. */
export const untilReset = (iso: string | null) => {
  if (!iso) return null
  const ms = Date.parse(iso) - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return "now"
  const hours = ms / 3_600_000
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`
  if (hours < 48) return `${Math.round(hours)} h`
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" })
}

const tone = (meter: UsageMeter) => (meter.limited || meter.percent >= 100 ? "#ef4444" : meter.percent >= 80 ? "#f59e0b" : "#a1a1aa")

/**
 * The agent's usage at a glance, refreshed every two minutes while the page is visible, when it comes back into view,
 * and when a chat finishes. Undefined until it loads, and on an agent that predates `usageGlance`.
 */
export function useUsageGlance() {
  const { stub, connected, state } = useDex()
  const load = useCallback(() => stub.usageGlance() as Promise<UsageGlance>, [stub])
  const { data, refresh } = useCachedFetch("usage-glance", load, connected)
  const working = state?.sessions.filter((session) => session.busy).length ?? 0
  useEffect(() => {
    if (!connected) return
    const tick = () => document.visibilityState === "visible" && void refresh()
    const timer = setInterval(tick, 120_000)
    document.addEventListener("visibilitychange", tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [connected, refresh])
  // A reply just finished: its tokens count now.
  const previous = useRef(working)
  useEffect(() => {
    if (connected && working < previous.current) void refresh()
    previous.current = working
  }, [connected, working, refresh])
  return data
}

const percentLabel = (meter: UsageMeter) => {
  const percent = Math.min(100, Math.max(0, meter.percent))
  return meter.limited ? "Limit" : percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`
}

/** Every meter, one per line, for a tooltip. */
const describe = (glance: UsageGlance | undefined) =>
  glance
    ? [
        ...glance.meters.map((meter) => {
          const resets = untilReset(meter.resetsAt)
          return `${meter.service} · ${meter.window}: ${percentLabel(meter)}${meter.detail ? ` (${meter.detail})` : ""}${resets ? ` · resets ${resets === "now" ? "now" : `in ${resets}`}` : ""}`
        }),
        `${tokenCount.format(glance.today.tokens)} tokens today`
      ].join("\n")
    : "Usage"

/** The busiest allowance as a ring filled to its share used; a chart icon when no plan has one. */
export function UsageRing({ glance, className = "size-4" }: { glance: UsageGlance | undefined; className?: string }) {
  const top = glance?.meters[0]
  if (!top) return <BarChart3 className={className} />
  const percent = Math.min(100, Math.max(0, top.percent))
  const circumference = 2 * Math.PI * 6.5
  return (
    <svg viewBox="0 0 16 16" className={`${className} -rotate-90`} aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill="none" strokeWidth="2.5" className="stroke-zinc-800" />
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        stroke={tone(top)}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.max(percent, percent > 0 ? 4 : 0) / 100)}
        className="transition-[stroke-dashoffset] duration-500"
      />
    </svg>
  )
}

/**
 * The sidebar's way into Usage, beside Settings: a ring for the busiest allowance (OpenCode Go's 5 hours at 42%, say)
 * and its share, or today's tokens when no plan has one. Hover for every meter; one tap opens the page.
 */
export function UsageGlanceLink({ onPick }: { onPick: () => void }) {
  const glance = useUsageGlance()
  const top = glance?.meters[0]
  const label = top ? percentLabel(top) : glance ? tokenCount.format(glance.today.tokens) : null
  return (
    <Link
      to="/usage"
      onClick={onPick}
      title={describe(glance)}
      aria-label={top ? `Usage: ${top.service} ${top.window}, ${percentLabel(top)} used` : "Usage"}
      className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-zinc-400 tabular-nums hover:bg-zinc-900 hover:text-zinc-200 [&.active]:bg-zinc-900 [&.active]:text-zinc-100"
    >
      <UsageRing glance={glance} />
      {label && <span className={top?.limited ? "font-medium text-red-400" : top && top.percent >= 80 ? "text-amber-300" : ""}>{label}</span>}
    </Link>
  )
}

/** The Usage link in the settings list, with the ring as its icon. */
export function UsageSettingsIcon() {
  return <UsageRing glance={useUsageGlance()} />
}
