import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai"
import { Predicate } from "effect"
import { AlertTriangle, ChevronRight, ListChecks, LoaderCircle } from "lucide-react"
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { displayItems, type LiveTool, toolResults, type TranscriptState } from "~/client/lib/transcript"
import { Collapse } from "./collapse"
import { ConfirmCard } from "./confirm-card"
import { Markdown } from "./markdown"
import { summarize, ToolCard, toolActivity } from "./tool-card"
import { useNow } from "./vm-status"

const OpenUIBlock = lazy(() => import("./openui-block"))

function Thinking({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  if (!text.trim()) return null
  return (
    <div className="my-1.5 text-xs text-zinc-500">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex items-center gap-1 hover:text-zinc-300">
        <ChevronRight className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} />
        {streaming ? "Thinking…" : "Thought"}
      </button>
      <Collapse open={open}>
        <div className="mt-1 border-l border-zinc-800 pl-3 whitespace-pre-wrap">{text}</div>
      </Collapse>
    </div>
  )
}

type Block = AssistantMessage["content"][number]

interface Step {
  readonly key: string
  readonly block: Block
  /** The block is the end of the message still streaming. */
  readonly live: boolean
}

const isUi = (block: Block) => block.type === "toolCall" && block.name === "render_ui" && Predicate.isString(block.arguments.code)
/** Thinking and tool calls: the work behind a reply, folded into its activity row. */
const isWork = (block: Block) => (block.type === "thinking" && block.thinking.trim() !== "") || (block.type === "toolCall" && !isUi(block))

/** While the model is thinking or between steps, the status line cycles through these. */
const PHRASES = ["Thinking", "Working through it", "Looking closer", "Connecting the dots", "Checking the details", "Putting it together"]

const duration = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/**
 * Everything the model did on the way to its answer, as one row: a status line that follows the current step (and
 * rotates while it thinks), counts, and time. Tap to see every thought, note, and tool call in order.
 */
function Activity(props: {
  steps: ReadonlyArray<Step>
  /** Still on the work (no answer text yet). */
  active: boolean
  /** The reply is still going, answer included: the clock keeps running. */
  running: boolean
  startedAt: number
  endedAt: number | null
  results: Map<string, ToolResultMessage>
  tools: Readonly<Record<string, LiveTool>>
}) {
  const { steps, active, results, tools } = props
  const [open, setOpen] = useState(false)
  const [phrase, setPhrase] = useState(0)
  // Only a reply that's still going has a clock to tick; finished ones show their fixed duration.
  const now = useNow(props.running || props.endedAt === null ? 1_000 : 0)

  const calls = steps.flatMap((step) => (step.block.type === "toolCall" ? [step.block] : []))
  const thoughts = steps.filter((step) => step.block.type === "thinking").length
  const failed = calls.filter((call) => results.get(call.id)?.isError).length
  const current = [...calls].reverse().find((call) => !results.has(call.id))
  const last = steps.at(-1)
  const thinking = last?.live && last.block.type === "thinking"

  // A running tool says what it's doing; otherwise the line rotates so a long think still feels alive.
  const rotating = active && !current
  // Each new step starts the cycle over at "Thinking".
  useEffect(() => setPhrase(0), [calls.length])
  useEffect(() => {
    if (!rotating) return
    const timer = setInterval(() => setPhrase((index) => index + 1), 2_400)
    return () => clearInterval(timer)
  }, [rotating])

  const status = !active
    ? `Worked for ${duration((props.endedAt ?? now) - props.startedAt)}`
    : current
      ? toolActivity(current.name)
      : thinking && phrase === 0
        ? "Thinking"
        : PHRASES[phrase % PHRASES.length]!
  const detail = active && current ? summarize(current.arguments) : ""
  const counts = [
    calls.length > 0 && plural(calls.length, "tool"),
    thoughts > 0 && plural(thoughts, "thought"),
    failed > 0 && `${failed} failed`,
    active && duration(now - props.startedAt)
  ].filter(Boolean)

  return (
    <div className="my-1.5 animate-fade overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60 text-xs">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/50">
        <ChevronRight className={`size-3.5 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`} />
        {active ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-emerald-400" />
        ) : failed > 0 ? (
          <AlertTriangle className="size-3.5 shrink-0 text-amber-400" />
        ) : (
          <ListChecks className="size-3.5 shrink-0 text-emerald-400" />
        )}
        <span className="flex min-w-[8.5rem] flex-1 items-baseline gap-1.5 overflow-hidden">
          <span key={status} className={`shrink-0 font-medium text-zinc-300 ${active ? "animate-rise" : ""}`}>
            {status}
            {active && "…"}
          </span>
          {detail && <span className="truncate font-mono text-zinc-500">{detail}</span>}
        </span>
        <span className="min-w-0 truncate text-zinc-500 tabular-nums">{counts.join(" · ")}</span>
      </button>
      <Collapse open={open}>
        <div className="border-t border-zinc-800 px-3 py-1">
          {steps.map((step) => {
            const { block } = step
            switch (block.type) {
              case "thinking":
                return <Thinking key={step.key} text={block.thinking} streaming={step.live} />
              case "text":
                return block.text.trim() ? (
                  <div key={step.key} className="my-2 text-zinc-400 [&_p]:text-xs">
                    <Markdown>{block.text}</Markdown>
                  </div>
                ) : null
              case "toolCall":
                return <ToolCard key={step.key} call={block} result={results.get(block.id)} live={tools[block.id]} />
            }
          })}
        </div>
      </Collapse>
    </div>
  )
}

/** One reply: its work folded into an activity row, then what it shows you (answer text and UI cards). */
const AssistantTurn = memo(AssistantTurnView, (prev, next) => {
  // A finished reply never changes: skip it entirely while a newer one streams, however long the chat.
  if (prev.active || next.active || prev.streaming || next.streaming) return false
  return (
    prev.endedAt === next.endedAt &&
    prev.onSend === next.onSend &&
    prev.messages.length === next.messages.length &&
    prev.messages.every((message, index) => message === next.messages[index])
  )
})

function AssistantTurnView(props: {
  messages: ReadonlyArray<AssistantMessage>
  streaming: boolean
  active: boolean
  endedAt: number | null
  results: Map<string, ToolResultMessage>
  tools: Readonly<Record<string, LiveTool>>
  onSend: (text: string) => void
}) {
  const { messages } = props
  const blocks: Step[] = messages.flatMap((message, m) =>
    message.content.map((block, index) => ({
      key: `${m}:${index}`,
      block,
      live: props.streaming && m === messages.length - 1 && index === message.content.length - 1
    }))
  )
  const lastWork = blocks.findLastIndex((step) => isWork(step.block))
  // Notes the model wrote between steps stay with the work; UI cards and the final answer stay in view.
  const steps = blocks.slice(0, lastWork + 1).filter((step) => !isUi(step.block))
  const shown = [...blocks.slice(0, lastWork + 1).filter((step) => isUi(step.block)), ...blocks.slice(lastWork + 1)]
  const final = messages.at(-1)
  const errors = messages.filter((message) => message.stopReason === "error")
  // Admin operations the chat asked for stay in view until you answer them.
  const confirmations = blocks.flatMap((step) => {
    if (step.block.type !== "toolCall" || step.block.name !== "app_call") return []
    const details = props.results.get(step.block.id)?.details as { confirmation?: { id: string; summary: string } } | undefined
    return details?.confirmation ? [details.confirmation] : []
  })

  return (
    <div className="min-w-0 flex-1">
      {steps.length > 0 && (
        <Activity
          steps={steps}
          active={props.active && shown.every((step) => step.block.type !== "text" || !step.block.text)}
          running={props.active}
          startedAt={messages[0]!.timestamp}
          endedAt={props.endedAt}
          results={props.results}
          tools={props.tools}
        />
      )}
      {confirmations.map((confirmation) => (
        <ConfirmCard key={confirmation.id} id={confirmation.id} summary={confirmation.summary} />
      ))}
      {shown.map((step) => {
        const { block } = step
        if (block.type === "text") return block.text ? <Markdown key={step.key}>{block.text}</Markdown> : null
        if (block.type === "thinking") return <Thinking key={step.key} text={block.thinking} streaming={step.live} />
        if (isUi(block)) {
          return (
            <Suspense key={step.key} fallback={<div className="my-3 h-24 animate-pulse rounded-xl bg-zinc-900" />}>
              <OpenUIBlock code={block.arguments.code as string} streaming={props.streaming} onSend={props.onSend} />
            </Suspense>
          )
        }
        return null
      })}
      {errors.map((message, index) => (
        <div key={index} className="my-2 flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-words">{message.errorMessage ?? "The model request failed."}</span>
        </div>
      ))}
      {final?.stopReason === "aborted" && <div className="my-1 text-xs text-zinc-500">Stopped.</div>}
    </div>
  )
}

/** Memoized: the chat page re-renders on every synced-state change, but the transcript only on its own. */
export const MessageList = memo(function MessageList({ transcript, onSend }: { transcript: TranscriptState; onSend: (text: string) => void }) {
  const items = useMemo(() => displayItems(transcript), [transcript])
  const results = useMemo(() => toolResults(transcript.entries), [transcript.entries])
  const bottom = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const scroller = useRef<HTMLDivElement>(null)
  const count = useRef(0)

  // A new message glides into view; streaming text that grows the last one keeps the bottom pinned instantly.
  // At most once a frame, however fast tokens arrive.
  const frame = useRef(0)
  useEffect(() => {
    const added = count.current > 0 && items.length > count.current
    count.current = items.length
    if (!pinned.current) return
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: "end", behavior: added ? "smooth" : "auto" }))
  }, [items])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  // load_ui_guide comes right before render_ui: start fetching the UI renderer then, so the card doesn't wait on it.
  const wantsUi = useMemo(
    () => items.some((item) => item.kind === "assistant" && item.messages.some((message) => message.content.some((block) => block.type === "toolCall" && (block.name === "load_ui_guide" || block.name === "render_ui")))),
    [items]
  )
  useEffect(() => {
    if (wantsUi) void import("./openui-block")
  }, [wantsUi])

  return (
    <div
      ref={scroller}
      className="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto overscroll-x-none"
      onScroll={(event) => {
        const element = event.currentTarget
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
      }}
    >
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {items.map((item, index) => {
          switch (item.kind) {
            case "user":
              return (
                <div key={item.id} className="flex animate-rise justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-800 px-4 py-2.5 text-sm whitespace-pre-wrap text-zinc-100 [overflow-wrap:anywhere]">
                    {item.text}
                    {item.images > 0 && <div className="mt-1 text-xs text-zinc-400">+{item.images} image(s)</div>}
                  </div>
                </div>
              )
            case "assistant":
              return (
                <div key={item.id} className="flex animate-rise gap-3">
                  <img src="/favicon.svg" alt="Dex" className="mt-0.5 size-6 shrink-0" />
                  <AssistantTurn
                    messages={item.messages}
                    streaming={item.streaming}
                    active={transcript.running && index === items.length - 1}
                    endedAt={item.endedAt}
                    results={results}
                    tools={transcript.tools}
                    onSend={onSend}
                  />
                </div>
              )
            case "divider":
              return (
                <div key={item.id} className="flex items-center gap-3 text-xs text-zinc-600">
                  <div className="h-px flex-1 bg-zinc-800" />
                  {item.label}
                  <div className="h-px flex-1 bg-zinc-800" />
                </div>
              )
          }
        })}
        {transcript.running && items.at(-1)?.kind !== "assistant" && (
          <div className="flex animate-fade items-center gap-2 pl-9 text-xs text-zinc-500">
            <LoaderCircle className="size-3.5 animate-spin" /> Working…
          </div>
        )}
        {transcript.retry && (
          <div className="pl-9 text-xs text-amber-400/80">Retrying after an error: {transcript.retry.error}</div>
        )}
        {transcript.error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span className="break-words">{transcript.error}</span>
          </div>
        )}
        <div ref={bottom} />
      </div>
    </div>
  )
})
