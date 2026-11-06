import { Link, useNavigate } from "@tanstack/react-router"
import { AlertTriangle, ArrowLeft, ArrowUpRight, Check, ChevronDown, CircleDashed, GitBranch, Hand, LoaderCircle, MessageSquareText, Orbit, Send, Sparkles, Square, X } from "lucide-react"
import { createContext, type ReactNode, useContext, useEffect, useState } from "react"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import type { SessionMeta } from "~/shared/protocol"
import {
  type ParsedSpaceUpdate,
  type SpaceProfile,
  spaceThreads,
  THREAD_STATUS_LABELS,
  THREAD_STATUS_ORDER,
  type ThreadStatus,
  threadStatus
} from "~/shared/spaces"
import { Markdown } from "./markdown"

/** A space's mark: an orbit on violet, the same everywhere a space shows. */
export function SpaceGlyph({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/25 ring-inset ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
    >
      <Orbit style={{ width: size * 0.58, height: size * 0.58 }} />
    </span>
  )
}

const STATUS_STYLE: Record<ThreadStatus, { icon: ReactNode; text: string }> = {
  working: { icon: <LoaderCircle className="size-3 animate-spin" />, text: "text-emerald-300" },
  needs_you: { icon: <Hand className="size-3" />, text: "text-amber-300" },
  failed: { icon: <AlertTriangle className="size-3" />, text: "text-red-300" },
  done: { icon: <Check className="size-3" />, text: "text-zinc-300" },
  new: { icon: <CircleDashed className="size-3" />, text: "text-zinc-500" }
}

export function ThreadStatusChip({ status }: { status: ThreadStatus }) {
  const style = STATUS_STYLE[status]
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-medium ${style.text}`}>
      {style.icon}
      {THREAD_STATUS_LABELS[status]}
    </span>
  )
}

/** The space a chat belongs to, whether it's the coordinator, and its threads with their statuses. */
export function useSpaceOf(session: SessionMeta | undefined) {
  const { state } = useDex()
  const space = session?.spaceId ? state?.spaces?.find((candidate) => candidate.id === session.spaceId) : undefined
  if (!space || !state) return null
  const pending = state.access.pending
  const threads = spaceThreads(space, state.sessions).map((thread) => ({ thread, status: threadStatus(thread, pending) }))
  return { space, coordinator: space.sessionId === session!.id, threads }
}

/** How the coordinator's page shows a thread when a card or row is picked: in its panel, or by opening it. */
export const SpaceSelectContext = createContext<((threadId: string) => void) | null>(null)

function useOpenThread() {
  const select = useContext(SpaceSelectContext)
  const navigate = useNavigate()
  return (threadId: string) => (select ? select(threadId) : void navigate({ to: "/chat/$sessionId", params: { sessionId: threadId } }))
}

/** A thread the coordinator started, as a card in its reply: title, live status, the latest of what it said. */
export function ThreadCard({ id, title }: { id: string; title: string }) {
  const { state } = useDex()
  const open = useOpenThread()
  const session = state?.sessions.find((candidate) => candidate.id === id)
  const status = session ? threadStatus(session, state?.access.pending) : null
  return (
    <button
      type="button"
      onClick={() => open(id)}
      className="my-1.5 flex w-full max-w-md items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
    >
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-400">
        <ArrowUpRight className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-zinc-100">{session?.title ?? title}</span>
          {status ? <span className="ml-auto"><ThreadStatusChip status={status} /></span> : <span className="ml-auto text-[11px] text-zinc-600">Deleted</span>}
        </span>
        {session?.lastReply && status !== "working" && <span className="mt-0.5 line-clamp-2 block text-xs text-zinc-500">{session.lastReply}</span>}
        {status === "working" && <span className="mt-0.5 block text-xs text-zinc-500">Working on it…</span>}
      </span>
    </button>
  )
}

const OUTCOME: Record<ParsedSpaceUpdate["outcome"], { icon: ReactNode; verb: string; tone: string }> = {
  finished: { icon: <Check className="size-3.5" />, verb: "finished", tone: "text-emerald-400" },
  failed: { icon: <AlertTriangle className="size-3.5" />, verb: "hit a problem", tone: "text-red-400" },
  stopped: { icon: <Square className="size-3" />, verb: "stopped", tone: "text-zinc-400" }
}

/** What the coordinator was told when threads finished: a quiet row each, its report folded away. */
export function SpaceUpdates({ updates }: { updates: ReadonlyArray<ParsedSpaceUpdate> }) {
  const open = useOpenThread()
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <div className="space-y-1">
      {updates.map((update) => {
        const outcome = OUTCOME[update.outcome]
        const key = `${update.threadId}:${update.outcome}`
        return (
          <div key={key} className="animate-fade">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className={`shrink-0 ${outcome.tone}`}>{outcome.icon}</span>
              <span className="min-w-0 truncate">
                <button type="button" onClick={() => open(update.threadId)} className="font-medium text-zinc-300 hover:text-zinc-100 hover:underline">
                  {update.title}
                </button>{" "}
                {outcome.verb}
              </span>
              {update.body && (
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === key ? null : key)}
                  aria-expanded={expanded === key}
                  className="flex shrink-0 items-center gap-0.5 rounded px-1 text-zinc-600 hover:text-zinc-300"
                >
                  Report <ChevronDown className={`size-3 transition-transform ${expanded === key ? "rotate-180" : ""}`} />
                </button>
              )}
            </div>
            {expanded === key && (
              <div className="mt-1.5 mb-2 ml-5 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2 text-sm">
                <Markdown>{update.body}</Markdown>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * A space before its first message: what it's for, how it works, and a few ways to start that fill the message box
 * (to edit before sending).
 */
export function SpaceIntro({ space, projectName, onPick }: { space: SpaceProfile; projectName: string | null; onPick: (text: string) => void }) {
  const suggestions = [
    space.goal ? `Make a plan for this and start on it: ${space.goal}` : "Help me plan the work for this space, then split it into threads.",
    projectName
      ? `Review ${projectName} for bugs and security issues, one area per thread, and keep a summary in your notes.`
      : "Research the options side by side, one thread each, and compare what they find.",
    "Check on this every morning and tell me what changed."
  ]
  const steps = [
    { icon: <MessageSquareText className="size-4" />, title: "Ask", text: "Tell it what you want, as you would a colleague." },
    { icon: <GitBranch className="size-4" />, title: "It splits the work", text: "Each piece runs as its own thread, in parallel." },
    { icon: <Sparkles className="size-4" />, title: "Results come back", text: "Threads report here; it follows up and keeps notes." }
  ]
  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto my-auto w-full max-w-xl animate-rise px-4 py-6 sm:px-5 sm:py-8">
        <div className="flex flex-col items-center text-center">
          <SpaceGlyph size={52} />
          <h2 className="mt-4 text-xl font-semibold tracking-tight text-zinc-100">{space.name}</h2>
          {space.goal && <p className="mt-1.5 max-w-md text-sm leading-relaxed text-zinc-400">{space.goal}</p>}
          {projectName && (
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-zinc-800 px-2.5 py-0.5 text-[11px] text-zinc-400">
              <GitBranch className="size-3" /> Threads work in {projectName}
            </span>
          )}
        </div>
        {/* Three small tiles on a phone; with room, each says a little more. */}
        <ol className="mt-6 grid grid-cols-3 gap-2 sm:mt-7">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-2.5 sm:p-3">
              <div className="flex items-center gap-2 text-violet-300">
                {step.icon}
                <span className="hidden text-[11px] font-medium tracking-wide text-zinc-500 uppercase sm:inline">{index + 1}</span>
              </div>
              <div className="mt-1.5 text-xs leading-snug font-medium text-zinc-100 sm:mt-2 sm:text-sm">{step.title}</div>
              <div className="mt-0.5 hidden text-xs leading-relaxed text-zinc-500 sm:block">{step.text}</div>
            </li>
          ))}
        </ol>
        <div className="mt-6 space-y-1.5">
          <div className="px-1 text-[11px] font-medium tracking-wide text-zinc-600 uppercase">Try</div>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onPick(suggestion)}
              className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-left text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <span className="min-w-0 flex-1">{suggestion}</span>
              <ArrowUpRight className="size-3.5 shrink-0 text-zinc-600" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

type Tab = "threads" | "notes"

/**
 * Beside the coordinator's chat: its threads by status (pick one to see its latest reply, message it, stop it, or open
 * it), and the coordinator's notes.
 */
export function SpacePanel({
  space,
  threads,
  selected,
  onSelect,
  onClose,
  coordinatorRunning
}: {
  space: SpaceProfile
  threads: ReadonlyArray<{ thread: SessionMeta; status: ThreadStatus }>
  selected: string | null
  onSelect: (threadId: string | null) => void
  onClose: () => void
  coordinatorRunning: boolean
}) {
  const [tab, setTab] = useState<Tab>("threads")
  const picked = selected ? threads.find((entry) => entry.thread.id === selected) : undefined
  return (
    <aside aria-label={`${space.name} threads`} className="absolute inset-0 z-20 flex min-h-0 flex-col border-l border-zinc-800 bg-zinc-950 lg:relative lg:inset-auto lg:w-[24rem] lg:shrink-0">
      <div className="dex-chrome flex h-12 shrink-0 items-center gap-1 border-b border-zinc-900 px-2">
        {(["threads", "notes"] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key && !picked}
            onClick={() => {
              setTab(key)
              onSelect(null)
            }}
            className={`rounded-md px-2.5 py-1 text-sm ${tab === key && !picked ? "bg-zinc-900 text-zinc-100" : "text-zinc-500 hover:text-zinc-200"}`}
          >
            {key === "threads" ? `Threads${threads.length ? ` ${threads.length}` : ""}` : "Notes"}
          </button>
        ))}
        <button type="button" onClick={onClose} aria-label="Close panel" className="ml-auto rounded-md p-2 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200">
          <X className="size-4" />
        </button>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {picked ? (
          <ThreadPeek thread={picked.thread} status={picked.status} onBack={() => onSelect(null)} />
        ) : tab === "threads" ? (
          <ThreadList threads={threads} onSelect={onSelect} />
        ) : (
          <SpaceNotes space={space} refreshKey={coordinatorRunning} />
        )}
      </div>
    </aside>
  )
}

function ThreadList({ threads, onSelect }: { threads: ReadonlyArray<{ thread: SessionMeta; status: ThreadStatus }>; onSelect: (threadId: string) => void }) {
  if (!threads.length) {
    return (
      <div className="px-5 py-10 text-center text-sm text-zinc-500">
        <SpaceGlyph size={36} className="mb-3" />
        <p>No threads yet.</p>
        <p className="mt-1 text-xs text-zinc-600">Tell the space what to work on; it starts a thread for each piece of work.</p>
      </div>
    )
  }
  return (
    <div className="py-2">
      {THREAD_STATUS_ORDER.map((status) => {
        const group = threads.filter((entry) => entry.status === status)
        if (!group.length) return null
        return (
          <section key={status} className="mb-2">
            <div className="flex items-center gap-1.5 px-4 pt-2 pb-1 text-[11px] font-medium tracking-wide text-zinc-600 uppercase">
              {THREAD_STATUS_LABELS[status]} <span className="font-normal">{group.length}</span>
            </div>
            {group.map(({ thread, status: threadState }) => (
              <button key={thread.id} type="button" onClick={() => onSelect(thread.id)} className="block w-full px-4 py-2 text-left hover:bg-zinc-900/70">
                <span className="flex items-center gap-2">
                  <span className={`min-w-0 truncate text-sm ${thread.unread ? "font-semibold text-zinc-50" : "text-zinc-200"}`}>{thread.title}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-zinc-600">{timeAgo(thread.updatedAt)}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <ThreadStatusChip status={threadState} />
                  {thread.lastReply && threadState !== "working" && <span className="min-w-0 truncate text-xs text-zinc-500">{thread.lastReply}</span>}
                </span>
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}

/** One thread up close: its status and latest reply, a line to send it, and the way into the full chat. */
function ThreadPeek({ thread, status, onBack }: { thread: SessionMeta; status: ThreadStatus; onBack: () => void }) {
  const { stub } = useDex()
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)
  const send = async () => {
    const text = message.trim()
    if (!text) return
    setSending(true)
    try {
      await stub.sendMessage(thread.id, text)
      setMessage("")
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="p-4">
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200">
        <ArrowLeft className="size-3.5" /> All threads
      </button>
      <h2 className="text-base font-medium text-zinc-100">{thread.title}</h2>
      <div className="mt-1 flex items-center gap-2">
        <ThreadStatusChip status={status} />
        <span className="text-[11px] text-zinc-600">Started {timeAgo(thread.createdAt)}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <Link
          to="/chat/$sessionId"
          params={{ sessionId: thread.id }}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white"
        >
          Open thread <ArrowUpRight className="size-3.5" />
        </Link>
        {status === "working" && (
          <button
            type="button"
            onClick={() => void stub.abort(thread.id)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
          >
            <Square className="size-3" /> Stop
          </button>
        )}
      </div>
      <div className="mt-4 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3 py-2.5 text-sm">
        {status === "working" ? (
          <p className="flex items-center gap-2 text-xs text-zinc-500">
            <LoaderCircle className="size-3.5 animate-spin" /> Working. Its report comes back to the space when it's done.
          </p>
        ) : thread.lastReply ? (
          <Markdown>{thread.lastReply}</Markdown>
        ) : (
          <p className="text-xs text-zinc-500">Nothing from it yet.</p>
        )}
      </div>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          rows={2}
          placeholder={status === "working" ? "Queue a message for this thread…" : "Message this thread…"}
          className="min-h-0 flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none md:text-sm"
        />
        <button type="submit" disabled={sending || !message.trim()} aria-label="Send to thread" className="rounded-lg bg-zinc-100 p-2.5 text-zinc-900 hover:bg-white disabled:opacity-40">
          <Send className="size-4" />
        </button>
      </form>
    </div>
  )
}

/** The coordinator's notes, read again whenever it finishes a reply. */
function SpaceNotes({ space, refreshKey }: { space: SpaceProfile; refreshKey: boolean }) {
  const { stub } = useDex()
  const [notes, setNotes] = useState<string | null>(null)
  useEffect(() => {
    if (refreshKey) return
    let live = true
    stub
      .spaceNotes(space.id)
      .then((text: string) => live && setNotes(text))
      .catch(() => live && setNotes(""))
    return () => {
      live = false
    }
  }, [stub, space.id, refreshKey])
  if (notes === null) return <p className="px-4 py-6 text-xs text-zinc-600">Loading notes…</p>
  if (!notes.trim()) {
    return (
      <div className="px-5 py-10 text-center text-sm text-zinc-500">
        <p>No notes yet.</p>
        <p className="mt-1 text-xs text-zinc-600">The space keeps a summary here as work happens: where things stand, decisions, and each thread's outcome.</p>
      </div>
    )
  }
  return (
    <div className="px-4 py-4 text-sm">
      <Markdown>{notes}</Markdown>
    </div>
  )
}
