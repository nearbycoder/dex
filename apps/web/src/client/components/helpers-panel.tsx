import { Link } from "@tanstack/react-router"
import { Bot, Check, ChevronUp, LayoutGrid, LoaderCircle, MonitorUp, Square, X } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import { useLatestActivity } from "~/client/lib/vm-activity"
import { type VmHelperInfo, vmKeyFor } from "~/shared/protocol"

/** "4m 12s": how long a helper has been at it. */
const elapsed = (from: number, to = Date.now()) => {
  const seconds = Math.max(0, Math.round((to - from) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/** Re-renders every second while `on`, for running clocks. */
function useTick(on: boolean) {
  const [, setNow] = useState(0)
  useEffect(() => {
    if (!on) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [on])
}

const STATUS: Record<VmHelperInfo["status"], { label: string; icon: ReactNode }> = {
  working: { label: "Working", icon: <LoaderCircle className="size-3.5 animate-spin text-emerald-400" /> },
  finished: { label: "Finished", icon: <Check className="size-3.5 text-emerald-400" /> },
  stopped: { label: "Stopped", icon: <X className="size-3.5 text-zinc-500" /> }
}

/**
 * A chat's helper agents (vm_agents), above the message box while any works: one per VM, with its task, how long it's
 * been going, and what it did last on its VM; open its VM, stop it, or watch them all in the control panel.
 */
export function HelpersPanel({ sessionId }: { sessionId: string }) {
  const { state, stub } = useDex()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const helpers = (state?.vmHelpers ?? []).filter((helper) => helper.chatId === sessionId).sort((a, b) => a.vm - b.vm)
  const working = helpers.filter((helper) => helper.status === "working")
  const latest = useLatestActivity(working.map((helper) => vmKeyFor(sessionId, helper.vm)))
  useTick(working.length > 0)
  // Shown while helpers work; once they're all done their reports are in the chat.
  if (!working.length) return null

  const stop = (vm?: number) => {
    setError(null)
    stub.stopVmHelpers(sessionId, vm).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }

  return (
    <div className="mb-2 animate-rise overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/70 backdrop-blur">
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <Bot className="size-3.5 shrink-0 text-emerald-400" />
          <span className="shrink-0 font-medium text-zinc-200">
            {working.length} helper{working.length === 1 ? "" : "s"} working
          </span>
          <span className="min-w-0 flex-1 truncate text-zinc-500">{working.map((helper) => `VM ${helper.vm}`).join(" · ")}</span>
          <ChevronUp className={`size-4 shrink-0 text-zinc-500 transition-transform ${open ? "" : "rotate-180"}`} />
        </button>
        <Link
          to="/control/$sessionId"
          params={{ sessionId }}
          title="Watch them in the control panel"
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <LayoutGrid className="size-3.5" /> <span className="hidden sm:inline">Watch</span>
        </Link>
      </div>
      {open && (
        <ul className="scrollbar-thin max-h-[45vh] divide-y divide-zinc-800/80 overflow-y-auto border-t border-zinc-800">
          {helpers.map((helper) => {
            const key = vmKeyFor(sessionId, helper.vm)
            const status = STATUS[helper.status]
            const live = helper.status === "working"
            return (
              <li key={helper.vm} className="flex items-start gap-2.5 px-3 py-2 text-xs">
                <span className="mt-0.5 shrink-0" title={status.label}>
                  {status.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-1.5">
                    <span className="shrink-0 font-medium text-zinc-200">VM {helper.vm}</span>
                    <span className="shrink-0 text-zinc-500 tabular-nums">
                      {live ? elapsed(helper.startedAt) : `${status.label} ${helper.endedAt ? timeAgo(helper.endedAt) : ""}`}
                    </span>
                  </p>
                  <p className="line-clamp-2 text-zinc-400 [overflow-wrap:anywhere]" title={helper.task}>
                    {helper.task}
                  </p>
                  {live && latest[key] && <p className="truncate font-mono text-[11px] text-zinc-500">{latest[key]}</p>}
                </div>
                <div className="flex shrink-0 items-center">
                  <Link
                    to="/machine/$vmKey"
                    params={{ vmKey: key }}
                    title={`Open VM ${helper.vm}`}
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    <MonitorUp className="size-3.5" />
                  </Link>
                  {live && (
                    <button
                      type="button"
                      onClick={() => stop(helper.vm)}
                      title="Stop this helper (its VM keeps running)"
                      className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                    >
                      <Square className="size-3.5" />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
          {working.length > 1 && (
            <li className="flex justify-end px-3 py-1.5">
              <button type="button" onClick={() => stop()} className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-red-400">
                Stop all helpers
              </button>
            </li>
          )}
        </ul>
      )}
      {error && <p className="border-t border-zinc-800 px-3 py-1.5 text-xs text-red-400">{error}</p>}
    </div>
  )
}
