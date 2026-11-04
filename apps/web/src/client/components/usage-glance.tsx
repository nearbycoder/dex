import { Link } from "@tanstack/react-router"
import { BarChart3, ChevronRight } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
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

/** Windows in reading order within a plan. */
const WINDOW_ORDER = ["5 hours", "Week", "7 days", "Month", "30 days"]

/** The hover card: each plan's windows with a small bar and when they reset, and today's tokens. */
function GlanceCard({ glance }: { glance: UsageGlance | undefined }) {
  const services = [...new Set(glance?.meters.map((meter) => meter.service))]
  const rank = (window: string) => (WINDOW_ORDER.includes(window) ? WINDOW_ORDER.indexOf(window) : WINDOW_ORDER.length)
  return (
    <>
      <div className="flex items-center justify-between pb-2 text-xs font-medium text-zinc-200">
        Usage
        <span className="flex items-center gap-0.5 font-normal text-zinc-500">
          Details <ChevronRight className="size-3" />
        </span>
      </div>
      {!glance ? (
        <p className="py-1 text-xs text-zinc-500">Loading…</p>
      ) : (
        <div className="space-y-3">
          {services.map((service) => {
            const meters = glance.meters.filter((meter) => meter.service === service).sort((a, b) => rank(a.window) - rank(b.window))
            return (
              <section key={service} className="space-y-1.5">
                <div className="flex items-baseline gap-1.5 text-[11px]">
                  <span className="font-medium text-zinc-300">{service}</span>
                  <span className="text-zinc-600">{meters[0]?.estimated ? "estimated" : "live"}</span>
                </div>
                {meters.map((meter) => {
                  const percent = Math.min(100, Math.max(0, meter.percent))
                  const resets = untilReset(meter.resetsAt)
                  return (
                    <div key={meter.window}>
                      <div className="flex items-baseline gap-2 text-[11px]">
                        <span className="text-zinc-400">{meter.window}</span>
                        <span className="ml-auto truncate text-zinc-600">{meter.detail ?? (resets && `resets ${resets === "now" ? "now" : `in ${resets}`}`)}</span>
                        <span className={`w-9 text-right tabular-nums ${meter.limited ? "font-medium text-red-400" : percent >= 80 ? "text-amber-300" : "text-zinc-200"}`}>
                          {percentLabel(meter)}
                        </span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(percent, percent > 0 ? 2 : 0)}%`, background: tone(meter) }} />
                      </div>
                    </div>
                  )
                })}
              </section>
            )
          })}
          {services.length === 0 && <p className="text-[11px] text-zinc-500">No plan with an allowance is connected.</p>}
          <div className="border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
            <span className="text-zinc-300 tabular-nums">{tokenCount.format(glance.today.tokens)}</span> tokens ·{" "}
            <span className="text-zinc-300 tabular-nums">{glance.today.responses.toLocaleString("en")}</span> responses today
          </div>
        </div>
      )}
    </>
  )
}

/**
 * The sidebar's way into Usage, beside Settings: a ring for the busiest allowance (OpenCode Go's 5 hours at 42%, say)
 * and its share, or today's tokens when no plan has one. Hovering shows every meter in a card beside the sidebar; one
 * tap opens the page.
 */
export function UsageGlanceLink({ onPick }: { onPick: () => void }) {
  const glance = useUsageGlance()
  const top = glance?.meters[0]
  const label = top ? percentLabel(top) : glance ? tokenCount.format(glance.today.tokens) : null
  const link = useRef<HTMLAnchorElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [card, setCard] = useState<{ left: number; bottom: number } | null>(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const show = () => {
    // Touch screens have no hover; the tap just opens the page.
    if (!window.matchMedia("(hover: hover)").matches) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const rect = link.current?.getBoundingClientRect()
      if (!rect) return
      const width = 256
      // Beside the sidebar when there's room, else above the button.
      const beside = rect.right + 12 + width <= window.innerWidth
      setCard(
        beside
          ? { left: rect.right + 12, bottom: Math.max(12, window.innerHeight - rect.bottom) }
          : { left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), bottom: window.innerHeight - rect.top + 8 }
      )
    }, 200)
  }
  const hide = () => {
    clearTimeout(timer.current)
    setCard(null)
  }

  return (
    <>
      <Link
        ref={link}
        to="/usage"
        onClick={() => {
          hide()
          onPick()
        }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-label={top ? `Usage: ${top.service} ${top.window}, ${percentLabel(top)} used` : "Usage"}
        className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-zinc-400 tabular-nums hover:bg-zinc-900 hover:text-zinc-200 [&.active]:bg-zinc-900 [&.active]:text-zinc-100"
      >
        <UsageRing glance={glance} />
        {label && <span className={top?.limited ? "font-medium text-red-400" : top && top.percent >= 80 ? "text-amber-300" : ""}>{label}</span>}
      </Link>
      {card &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-50 w-64 animate-fade rounded-xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-2xl shadow-black/60 backdrop-blur"
            style={{ left: card.left, bottom: card.bottom }}
          >
            <GlanceCard glance={glance} />
          </div>,
          document.body
        )}
    </>
  )
}

/** The Usage link in the settings list, with the ring as its icon. */
export function UsageSettingsIcon() {
  return <UsageRing glance={useUsageGlance()} />
}
