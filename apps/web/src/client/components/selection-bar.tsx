import { useNavigate } from "@tanstack/react-router"
import { AlarmClock, AlarmClockOff, CheckCheck, CircleCheck, Inbox, Trash2, X } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { useDex } from "~/client/lib/dex"
import type { SessionMeta } from "~/shared/protocol"
import { ask } from "./confirm-dialog"
import { inboxState, snoozeOptions, when } from "./session-menu"

function Action({ icon, label, onClick, danger = false, active = false }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] ${
        danger ? "text-zinc-300 hover:bg-red-950/50 hover:text-red-300" : active ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}

/**
 * What to do with the chats shift-clicked in the sidebar: settle them (or bring them back to the inbox), snooze them,
 * mark them read, or delete them. Each acts on every selected chat, then the selection clears.
 */
export function SelectionBar({ sessions, activeId, onClear }: { sessions: ReadonlyArray<SessionMeta>; activeId: string | undefined; onClear: () => void }) {
  const { stub } = useDex()
  const navigate = useNavigate()
  const [snoozing, setSnoozing] = useState(false)
  const [working, setWorking] = useState(false)
  const bar = useRef<HTMLDivElement>(null)
  const now = Date.now()
  const states = sessions.map((session) => inboxState(session, now))
  const allSettled = states.every((state) => state === "settled")
  const anySnoozed = states.includes("snoozed")
  const unread = sessions.filter((session) => session.unread)
  const count = sessions.length
  const chats = `${count} chat${count === 1 ? "" : "s"}`

  useEffect(() => {
    if (!snoozing) return
    const close = (event: PointerEvent) => bar.current?.contains(event.target as Node) || setSnoozing(false)
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [snoozing])

  const each = async (work: (session: SessionMeta) => Promise<unknown>, list: ReadonlyArray<SessionMeta> = sessions) => {
    setSnoozing(false)
    setWorking(true)
    const results = await Promise.allSettled(list.map(work))
    setWorking(false)
    const failed = results.filter((result) => result.status === "rejected").length
    if (failed) alert(`${failed} of ${list.length} didn't go through. Try those again.`)
    onClear()
  }

  const remove = async () => {
    if (!(await ask({ title: `Delete ${chats}?`, body: `Their messages go, and their VMs with everything on the disks. This can't be undone.`, confirm: `Delete ${count}` }))) return
    setWorking(true)
    let failed = 0
    // One at a time: each delete also stops and removes that chat's VM.
    for (const session of sessions) await stub.deleteSession(session.id).catch(() => failed++)
    setWorking(false)
    if (failed) alert(`${failed} of ${count} couldn't be deleted. Try those again.`)
    if (activeId && sessions.some((session) => session.id === activeId)) await navigate({ to: "/chat" })
    onClear()
  }

  return (
    <div ref={bar} className={`relative mx-3 mb-2 animate-pop rounded-xl border border-zinc-800 bg-zinc-900/80 p-1.5 ${working ? "pointer-events-none opacity-60" : ""}`}>
      <div className="flex items-center px-1.5 pb-1">
        <span className="text-xs font-medium text-zinc-200">{count} selected</span>
        <span className="ml-2 hidden text-[11px] text-zinc-600 [@media(hover:hover)]:inline">Shift-click for more</span>
        <button type="button" onClick={onClear} title="Clear selection (Esc)" aria-label="Clear selection" className="-mr-0.5 ml-auto rounded-md p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex gap-0.5">
        {allSettled ? (
          <Action icon={<Inbox className="size-4" />} label="Inbox" onClick={() => void each((session) => stub.triageSession(session.id, { settled: false }))} />
        ) : (
          <Action
            icon={<CheckCheck className="size-4" />}
            label="Settle"
            onClick={() => void each((session) => stub.triageSession(session.id, { settled: true }), sessions.filter((session) => !session.settledAt))}
          />
        )}
        <Action icon={<AlarmClock className="size-4" />} label="Snooze" active={snoozing} onClick={() => setSnoozing((open) => !open)} />
        {unread.length > 0 && <Action icon={<CircleCheck className="size-4" />} label="Read" onClick={() => void each((session) => stub.markSessionRead(session.id), unread)} />}
        <Action danger icon={<Trash2 className="size-4" />} label="Delete" onClick={() => void remove()} />
      </div>
      {snoozing && (
        <div role="menu" className="absolute inset-x-0 bottom-full z-50 mb-1.5 animate-pop rounded-xl border border-zinc-700/80 bg-zinc-900 p-1 shadow-xl shadow-black/50">
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">Snooze {chats} until</div>
          {snoozeOptions().map((option) => (
            <button
              key={option.label}
              type="button"
              role="menuitem"
              onClick={() => void each((session) => stub.triageSession(session.id, { snoozedUntil: option.at.getTime() }))}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
            >
              <AlarmClock className="size-4 shrink-0 text-zinc-500" />
              <span className="flex-1">{option.label}</span>
              <span className="text-xs text-zinc-500">{when(option.at)}</span>
            </button>
          ))}
          {anySnoozed && (
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                void each(
                  (session) => stub.triageSession(session.id, { snoozedUntil: null }),
                  sessions.filter((session) => inboxState(session, Date.now()) === "snoozed")
                )
              }
              className="mt-1 flex w-full items-center gap-2.5 rounded-lg border-t border-zinc-800 px-2.5 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
            >
              <AlarmClockOff className="size-4 shrink-0 text-zinc-500" />
              Unsnooze
            </button>
          )}
        </div>
      )}
    </div>
  )
}
