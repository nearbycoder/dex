import { useNavigate, useParams } from "@tanstack/react-router"
import { AlarmClock, AlarmClockOff, CheckCheck, Inbox, MoreHorizontal, Sparkles, Trash2 } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { useDex } from "~/client/lib/dex"
import type { SessionMeta } from "~/shared/protocol"

/** Where a chat sits: the inbox, snoozed until a time, or settled (done for now). */
export const inboxState = (session: SessionMeta, now: number) =>
  session.snoozedUntil && session.snoozedUntil > now ? "snoozed" : session.settledAt ? "settled" : "inbox"

const at = (base: Date, days: number, hour: number) => {
  const date = new Date(base)
  date.setDate(date.getDate() + days)
  date.setHours(hour, 0, 0, 0)
  return date
}

const when = (date: Date) => {
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  return sameDay ? time : `${date.toLocaleDateString([], { weekday: "short" })} ${time}`
}

/** Snooze choices in local time: in an hour, this evening, tomorrow morning, the weekend, next week. */
export function snoozeOptions(now = new Date()): Array<{ label: string; at: Date }> {
  const options = [{ label: "In 1 hour", at: new Date(now.getTime() + 60 * 60_000) }]
  const evening = at(now, 0, 18)
  if (evening.getTime() - now.getTime() > 90 * 60_000) options.push({ label: "This evening", at: evening })
  options.push({ label: "Tomorrow", at: at(now, 1, 9) })
  const day = now.getDay()
  if (day >= 1 && day <= 4) options.push({ label: "This weekend", at: at(now, 6 - day, 9) })
  options.push({ label: "Next week", at: at(now, (8 - day) % 7 || 7, 9) })
  return options
}

/** Chats whose title is being rewritten, so the header and sidebar can show it's on its way. */
const naming = new Set<string>()
const namingListeners = new Set<() => void>()
const setNaming = (sessionId: string, on: boolean) => {
  if (on) naming.add(sessionId)
  else naming.delete(sessionId)
  for (const listener of namingListeners) listener()
}
export const useNaming = (sessionId: string) =>
  useSyncExternalStore(
    (listener) => {
      namingListeners.add(listener)
      return () => namingListeners.delete(listener)
    },
    () => naming.has(sessionId),
    () => false
  )

/** Asks the agent for a new title from the chat's messages. */
export async function regenerateTitle(stub: { regenerateSessionTitle(sessionId: string): Promise<string> }, sessionId: string) {
  if (naming.has(sessionId)) return
  setNaming(sessionId, true)
  try {
    await stub.regenerateSessionTitle(sessionId)
  } catch (error) {
    alert(`Couldn't regenerate the title: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    setNaming(sessionId, false)
  }
}

export const snoozedLabel = (until: number) => `until ${when(new Date(until))}`

function MenuItem({ icon, children, onClick, danger = false }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${danger ? "text-zinc-300 hover:bg-red-950/50 hover:text-red-300" : "text-zinc-200 hover:bg-zinc-800"}`}
    >
      <span className="shrink-0 text-zinc-500">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  )
}

/**
 * A chat's menu: regenerate its title, settle it (done for now) or bring it back, snooze it until a time, or delete it. Rendered in a
 * portal so the sidebar's scroll area can't clip it.
 */
export function SessionMenu({ session, className = "", label = "Chat options" }: { session: SessionMeta; className?: string; label?: string }) {
  const { stub } = useDex()
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number; up: boolean } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const now = Date.now()
  const state = inboxState(session, now)

  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape") return
      if (event.type === "pointerdown" && (button.current?.contains(event.target as Node) || panel.current?.contains(event.target as Node))) return
      setOpen(false)
    }
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", close)
    window.addEventListener("resize", close)
    return () => {
      document.removeEventListener("pointerdown", close)
      document.removeEventListener("keydown", close)
      window.removeEventListener("resize", close)
    }
  }, [open])

  const toggle = () => {
    const rect = button.current?.getBoundingClientRect()
    if (rect) {
      const width = 232
      const up = rect.bottom + 320 > window.innerHeight
      setPosition({ top: up ? rect.top - 6 : rect.bottom + 6, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), up })
    }
    setOpen((value) => !value)
  }

  const run = (work: () => Promise<unknown>) => {
    setOpen(false)
    void work()
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          toggle()
        }}
        className={`rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 ${open ? "bg-zinc-800 text-zinc-200" : ""} ${className}`}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            style={{ left: position.left, ...(position.up ? { bottom: window.innerHeight - position.top } : { top: position.top }), width: 232 }}
            className="fixed z-50 animate-pop rounded-xl border border-zinc-700/80 bg-zinc-900 p-1 shadow-xl shadow-black/50"
          >
            <MenuItem icon={<Sparkles className="size-4" />} onClick={() => run(() => regenerateTitle(stub, session.id))}>
              Regenerate title
            </MenuItem>
            {state === "settled" ? (
              <MenuItem icon={<Inbox className="size-4" />} onClick={() => run(() => stub.triageSession(session.id, { settled: false }))}>
                Move to inbox
              </MenuItem>
            ) : (
              <MenuItem icon={<CheckCheck className="size-4" />} onClick={() => run(() => stub.triageSession(session.id, { settled: true }))}>
                Settle
              </MenuItem>
            )}
            {state === "snoozed" && (
              <MenuItem icon={<AlarmClockOff className="size-4" />} onClick={() => run(() => stub.triageSession(session.id, { snoozedUntil: null }))}>
                Unsnooze <span className="text-xs text-zinc-500">({snoozedLabel(session.snoozedUntil!)})</span>
              </MenuItem>
            )}
            <div className="mt-1 border-t border-zinc-800 px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
              Snooze until
            </div>
            {snoozeOptions().map((option) => (
              <MenuItem
                key={option.label}
                icon={<AlarmClock className="size-4" />}
                onClick={() => run(() => stub.triageSession(session.id, { snoozedUntil: option.at.getTime() }))}
              >
                <span className="flex items-baseline justify-between gap-2">
                  {option.label}
                  <span className="shrink-0 text-xs text-zinc-500">{when(option.at)}</span>
                </span>
              </MenuItem>
            ))}
            <div className="mt-1 border-t border-zinc-800 pt-1">
              <MenuItem
                danger
                icon={<Trash2 className="size-4" />}
                onClick={() =>
                  run(async () => {
                    if (!confirm(`Delete “${session.title}”?`)) return
                    await stub.deleteSession(session.id)
                    if ("sessionId" in params && params.sessionId === session.id) await navigate({ to: "/chat" })
                  })
                }
              >
                Delete
              </MenuItem>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
