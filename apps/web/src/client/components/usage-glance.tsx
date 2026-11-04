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

/**
 * The sidebar's way into Usage: the most used allowance as a meter (OpenCode Go's 5 hours at 42%, say), or today's
 * tokens when no plan has one. One tap opens the Usage page, the way other apps keep a usage meter by the account.
 */
export function UsageGlanceLink({ onPick }: { onPick: () => void }) {
  const glance = useUsageGlance()
  const top = glance?.meters[0]
  const percent = top ? Math.min(100, Math.max(0, top.percent)) : 0
  const resets = top && untilReset(top.resetsAt)
  const caption = top
    ? `${top.service} · ${top.window}${top.limited ? " · limit reached" : resets ? ` · resets ${resets === "now" ? "now" : `in ${resets}`}` : ""}`
    : glance
      ? `${tokenCount.format(glance.today.tokens)} tokens today`
      : null
  return (
    <Link
      to="/usage"
      onClick={onPick}
      title={glance?.meters.map((meter) => `${meter.service} · ${meter.window}: ${Math.round(meter.percent)}%${meter.detail ? ` (${meter.detail})` : ""}`).join("\n") || "Usage"}
      className="block rounded-lg px-2.5 py-2 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 [&.active]:bg-zinc-900 [&.active]:text-zinc-100"
    >
      <span className="flex items-center gap-2.5">
        <BarChart3 className="size-4" /> Usage
        {top ? (
          <span className={`ml-auto text-xs tabular-nums ${top.limited ? "font-medium text-red-400" : percent >= 80 ? "text-amber-300" : "text-zinc-300"}`}>
            {top.limited ? "Limit" : percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`}
          </span>
        ) : (
          glance && <span className="ml-auto text-xs text-zinc-500 tabular-nums">{tokenCount.format(glance.today.tokens)}</span>
        )}
      </span>
      {top && (
        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-zinc-800" aria-hidden="true">
          <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(percent, percent > 0 ? 2 : 0)}%`, background: tone(top) }} />
        </span>
      )}
      {caption && <span className="mt-1 block truncate text-[11px] text-zinc-500">{caption}</span>}
    </Link>
  )
}
