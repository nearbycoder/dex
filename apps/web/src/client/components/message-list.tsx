import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai"
import { Predicate } from "effect"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, ArrowDown, Brain, ChevronRight, Clock, ListChecks, LoaderCircle, MousePointerClick } from "lucide-react"
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { displayItems, type LiveTool, toolResults, type TranscriptState } from "~/client/lib/transcript"
import { invokedSkill } from "~/shared/skills"
import { splitUiNotes } from "~/shared/ui-notes"
import { Collapse } from "./collapse"
import { ConfirmCard } from "./confirm-card"
import { MediaPlayer, videoSource } from "./media"
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
/** The latest line of some thinking or notes, as plain text, for the activity row. */
const latestLine = (text: string) =>
  (
    text
      .split("\n")
      .map((line) => line.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .at(-1) ?? ""
  ).slice(-200)

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
  // Only a reply that's still going has a clock to tick; finished ones show their fixed duration.
  const now = useNow(props.running || props.endedAt === null ? 1_000 : 0)

  const calls = steps.flatMap((step) => (step.block.type === "toolCall" ? [step.block] : []))
  const thoughts = steps.filter((step) => step.block.type === "thinking").length
  const failed = calls.filter((call) => results.get(call.id)?.isError).length
  const current = [...calls].reverse().find((call) => !results.has(call.id))

  // What's really happening: the running tool and its arguments; else the latest line of the model's thinking or
  // notes; else the tool it just ran.
  const latest = [...steps].reverse().find((step) => (step.block.type === "thinking" ? step.block.thinking.trim() : step.block.type !== "text" || step.block.text.trim()))
  const status = !active ? `Worked for ${duration((props.endedAt ?? now) - props.startedAt)}` : current ? toolActivity(current.name) : "Thinking"
  const detail = !active
    ? ""
    : current
      ? summarize(current.arguments)
      : latest?.block.type === "thinking"
        ? latestLine(latest.block.thinking)
        : latest?.block.type === "text"
          ? latestLine(latest.block.text)
          : latest?.block.type === "toolCall"
            ? `${latest.block.name} ${summarize(latest.block.arguments)}`
            : ""
  const counts = [
    calls.length > 0 && plural(calls.length, "tool"),
    thoughts > 0 && plural(thoughts, "thought"),
    failed > 0 && `${failed} failed`,
    active && duration(now - props.startedAt)
  ].filter(Boolean)

  return (
    <div className="my-1.5 animate-fade overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60 text-xs">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/50"
      >
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
          {detail && <span className={`truncate text-zinc-500 ${current || latest?.block.type === "toolCall" ? "font-mono" : "italic"}`}>{detail}</span>}
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
  // Memory feeds every future chat, so a change to it is never tucked away in the activity row.
  const touchedMemory = blocks.some(({ block }) => {
    if (block.type !== "toolCall") return false
    const args = block.arguments as Record<string, unknown>
    if (block.name === "write_file" || block.name === "edit_file") return /(^|\/)MEMORY\.md$/i.test(String(args.path ?? ""))
    if (block.name === "bash") return /MEMORY\.md/i.test(String(args.command ?? "")) && /(>|\btee\b|sed\s+-i)/.test(String(args.command ?? ""))
    return false
  })
  // Media the chat shared shows in the reply even if the model forgot to put its Markdown in the text.
  const shownText = shown.map(({ block }) => (block.type === "text" ? block.text : "")).join("\n")
  const sharedMedia = blocks.flatMap((step) => {
    if (step.block.type !== "toolCall" || step.block.name !== "share_media") return []
    const details = props.results.get(step.block.id)?.details as { media?: { url: string; name: string } } | undefined
    return details?.media && !shownText.includes(details.media.url) ? [details.media] : []
  })
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
      {touchedMemory && (
        <Link
          to="/files"
          className="my-1.5 inline-flex items-center gap-1.5 rounded-lg border border-sky-900/60 bg-sky-950/30 px-2.5 py-1 text-xs text-sky-200 hover:bg-sky-950/60"
          title="Memory is added to every chat. Review what changed."
        >
          <Brain className="size-3.5" /> Memory updated
        </Link>
      )}
      {sharedMedia.map((media) => {
        const source = videoSource(media.url)
        return source ? <MediaPlayer key={media.url} source={source} title={media.name} /> : null
      })}
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
              <OpenUIBlock
                code={block.arguments.code as string}
                streaming={props.streaming}
                card={block.id}
                onSend={props.onSend}
              />
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

/**
 * A message's text, with a leading `/skill` set off (that message invoked the skill), and the note Dex added about
 * what you did in the chat's UI since your last message shown as a note rather than as your words.
 */
function UserText({ text: raw }: { text: string }) {
  const { notes, text } = splitUiNotes(raw)
  const skill = invokedSkill(text)
  const at = skill ? text.indexOf(`/${skill}`) : -1
  return (
    <>
      {notes.length > 0 && (
        <span className="mb-1.5 flex items-start gap-1.5 text-xs text-zinc-400" title="Dex told the chat what you did with its UI since your last message">
          <MousePointerClick className="mt-0.5 size-3 shrink-0" />
          <span>In the UI: {notes.join("; ")}</span>
        </span>
      )}
      {skill && at !== -1 ? (
        <>
          {text.slice(0, at)}
          <span className="font-mono font-medium text-emerald-300">/{skill}</span>
          {text.slice(at + skill.length + 1)}
        </>
      ) : (
        text
      )}
    </>
  )
}

/** Memoized: the chat page re-renders on every synced-state change, but the transcript only on its own. */
export const MessageList = memo(function MessageList({
  transcript,
  onSend,
  pending = []
}: {
  transcript: TranscriptState
  onSend: (text: string) => void
  /** Messages just sent that the agent hasn't recorded yet, shown at once (see the chat page). */
  pending?: readonly string[]
}) {
  const items = useMemo(() => displayItems(transcript), [transcript])
  const results = useMemo(() => toolResults(transcript.entries), [transcript.entries])
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  // Following the bottom. Only scrolling up yourself lets go of it; reaching the bottom again takes it back.
  const pinned = useRef(true)
  const lastTop = useRef(0)
  const clickedAt = useRef(0)
  const [atBottom, setAtBottom] = useState(true)

  const toBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = scroller.current
    if (element) element.scrollTo({ top: element.scrollHeight, behavior })
  }, [])

  // A chat opens at its latest message, before the first paint (the page remounts this per chat).
  useLayoutEffect(() => toBottom(), [toBottom])

  // While pinned, anything that grows keeps the bottom in view: streaming text, new messages, and media and cards
  // that size themselves after they load, or the keyboard shrinking the view. Growth from a tap (opening an
  // activity row) stays where you tapped.
  useEffect(() => {
    const element = scroller.current
    const inner = content.current
    if (!element || !inner) return
    const observer = new ResizeObserver(() => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight
      if (Date.now() - clickedAt.current < 1_000) {
        pinned.current = distance < 80
        setAtBottom(distance < 120)
      } else if (pinned.current) {
        element.scrollTop = element.scrollHeight
      }
    })
    observer.observe(inner)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Sending a message always brings you to the bottom.
  const lastUser = `${items.findLast((item) => item.kind === "user")?.id ?? ""}:${pending.length}`
  const seenUser = useRef(lastUser)
  useEffect(() => {
    if (lastUser === seenUser.current) return
    seenUser.current = lastUser
    pinned.current = true
    toBottom()
  }, [lastUser, toBottom])

  // load_ui_guide comes right before render_ui: start fetching the UI renderer then, so the card doesn't wait on it.
  const wantsUi = useMemo(
    () =>
      items.some(
        (item) =>
          item.kind === "assistant" &&
          item.messages.some((message) =>
            message.content.some((block) => block.type === "toolCall" && (block.name === "load_ui_guide" || block.name === "render_ui"))
          )
      ),
    [items]
  )
  useEffect(() => {
    if (wantsUi) void import("./openui-block")
  }, [wantsUi])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto overscroll-x-none"
        onScroll={(event) => {
          const element = event.currentTarget
          const distance = element.scrollHeight - element.scrollTop - element.clientHeight
          if (distance < 80) pinned.current = true
          else if (element.scrollTop < lastTop.current - 1) pinned.current = false
          lastTop.current = element.scrollTop
          setAtBottom(distance < 120)
        }}
      >
        <div ref={content} onClickCapture={() => (clickedAt.current = Date.now())} className="mx-auto max-w-3xl space-y-5 px-4 py-6">
          {items.map((item, index) => {
            switch (item.kind) {
              case "user":
                return (
                  <div key={item.id} className="flex animate-rise justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-800 px-4 py-2.5 text-sm whitespace-pre-wrap text-zinc-100 [overflow-wrap:anywhere]">
                      <UserText text={item.text} />
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
          {pending.map((text, index) => (
            <div key={`pending-${index}`} className="flex animate-rise justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-800/70 px-4 py-2.5 text-sm whitespace-pre-wrap text-zinc-300 [overflow-wrap:anywhere]">
                <UserText text={text} />
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-zinc-500">
                  <Clock className="size-3" /> Sending
                </div>
              </div>
            </div>
          ))}
          {transcript.running && items.at(-1)?.kind !== "assistant" && (
            <div className="flex animate-fade items-center gap-2 pl-9 text-xs text-zinc-500">
              <LoaderCircle className="size-3.5 animate-spin" /> Working…
            </div>
          )}
          {transcript.retry && <div className="pl-9 text-xs text-amber-400/80">Retrying after an error: {transcript.retry.error}</div>}
          {transcript.error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span className="break-words">{transcript.error}</span>
            </div>
          )}
        </div>
      </div>
      {!atBottom && (
        <button
          type="button"
          aria-label="Scroll to the latest message"
          title="Latest message"
          onClick={() => {
            pinned.current = true
            toBottom("smooth")
          }}
          className="absolute bottom-3 left-1/2 flex size-9 -translate-x-1/2 animate-fade items-center justify-center rounded-full border border-zinc-700/80 bg-zinc-900/90 text-zinc-200 shadow-lg shadow-black/40 backdrop-blur hover:bg-zinc-800"
        >
          <ArrowDown className="size-4" />
          {transcript.running && (
            <span className="absolute -top-0.5 -right-0.5 size-2.5 animate-pulse rounded-full bg-emerald-500 ring-2 ring-zinc-950" />
          )}
        </button>
      )}
    </div>
  )
})
