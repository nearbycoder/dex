import { attachmentSummary } from "~/shared/attachments"
import { ArrowDown, ArrowUp, Check, ChevronUp, Hourglass, Pause, Pencil, Trash2, Zap } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useDex } from "~/client/lib/dex"
import type { QueuedMessage } from "~/shared/protocol"

const iconButton = "rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-30"

function QueueItem({
  sessionId,
  item,
  index,
  count,
  running
}: {
  sessionId: string
  item: QueuedMessage
  index: number
  count: number
  running: boolean
}) {
  const { stub } = useDex()
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing === null) return
    const element = box.current
    if (!element) return
    element.style.height = "0px"
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`
  }, [editing])

  // Each action may find the message already sent (the run ended meanwhile): say so instead of failing quietly.
  const act = (work: () => Promise<unknown>) => {
    setError(null)
    work().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }

  if (editing !== null) {
    const save = () =>
      act(async () => {
        await stub.editQueued(sessionId, item.id, editing)
        setEditing(null)
      })
    return (
      <li className="px-3 py-2.5">
        <textarea
          ref={box}
          autoFocus
          value={editing}
          onChange={(event) => setEditing(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (editing.trim()) save()
            }
            if (event.key === "Escape") setEditing(null)
          }}
          className="block w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-base text-zinc-100 focus:border-emerald-600 focus:outline-none md:text-sm"
        />
        <div className="mt-2 flex justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="rounded-md px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!editing.trim()}
            onClick={save}
            className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            <Check className="size-3.5" /> Save
          </button>
        </div>
        {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
      </li>
    )
  }

  return (
    <li className="animate-fade px-3 py-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-medium text-zinc-400 tabular-nums">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          {item.text && <p className="line-clamp-3 text-sm whitespace-pre-wrap text-zinc-200 [overflow-wrap:anywhere]">{item.text}</p>}
          {item.attachments && item.attachments.length > 0 && (
            <p className="truncate text-xs text-zinc-500" title={item.attachments.map((file) => file.name).join(", ")}>
              Attached: {attachmentSummary(item.attachments)}
            </p>
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-0.5 pl-7">
        <button
          type="button"
          title="Move up"
          aria-label="Move up"
          disabled={index === 0}
          onClick={() => act(() => stub.moveQueued(sessionId, item.id, index - 1))}
          className={iconButton}
        >
          <ArrowUp className="size-3.5" />
        </button>
        <button
          type="button"
          title="Move down"
          aria-label="Move down"
          disabled={index === count - 1}
          onClick={() => act(() => stub.moveQueued(sessionId, item.id, index + 1))}
          className={iconButton}
        >
          <ArrowDown className="size-3.5" />
        </button>
        <button type="button" title="Edit" aria-label="Edit" onClick={() => setEditing(item.text)} className={iconButton}>
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          title="Delete"
          aria-label="Delete"
          onClick={() => act(() => stub.removeQueued(sessionId, item.id))}
          className={`${iconButton} hover:text-red-400`}
        >
          <Trash2 className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => act(() => stub.steerQueued(sessionId, item.id))}
          title={running ? "Send now, into the current run after its current step" : "Send now"}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-amber-300 hover:bg-amber-950/40"
        >
          <Zap className="size-3.5" /> {running ? "Steer" : "Send now"}
        </button>
      </div>
      {error && <p className="mt-1 pl-7 text-xs text-red-400">{error}</p>}
    </li>
  )
}

/**
 * Messages waiting for the chat, above the message box: collapsed to a count and the next one, open to edit,
 * reorder, delete, or steer them in now.
 */
export function QueuePanel({
  sessionId,
  items,
  held,
  running
}: {
  sessionId: string
  items: ReadonlyArray<QueuedMessage>
  held: boolean
  running: boolean
}) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  const next = items[0]!

  return (
    <div className="mb-2 animate-rise overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/70 backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        {held ? <Pause className="size-3.5 shrink-0 text-amber-400" /> : <Hourglass className="size-3.5 shrink-0 text-zinc-400" />}
        <span className="shrink-0 font-medium text-zinc-200">{items.length} queued</span>
        <span className="min-w-0 flex-1 truncate text-zinc-500">
          {held ? "Held since you stopped: send one, or a new message, to continue" : open ? "Sent in this order as the chat finishes" : next.text}
        </span>
        <ChevronUp className={`size-4 shrink-0 text-zinc-500 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
      {open && (
        <ul className="scrollbar-thin max-h-[45vh] divide-y divide-zinc-800/80 overflow-y-auto border-t border-zinc-800">
          {items.map((item, index) => (
            <QueueItem key={item.id} sessionId={sessionId} item={item} index={index} count={items.length} running={running} />
          ))}
        </ul>
      )}
    </div>
  )
}
