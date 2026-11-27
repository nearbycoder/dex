import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Link } from "@tanstack/react-router"
import { AlarmClock, AlertTriangle, ArrowDown, Brain, ChevronRight, Clock, ListChecks, LoaderCircle, MousePointerClick, Paperclip, RotateCw } from "lucide-react"
import { useParams } from "@tanstack/react-router"
import { toast } from "sonner"
import type { AttachedFile } from "~/shared/attachments"
import { FileIcon } from "~/client/components/file-icon"
import { lazy, memo, type ReactNode, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { type DisplayItem, displayItemsWithStreaming, type LiveTool, recordedDisplayItems, toolResults, type TranscriptState } from "~/client/lib/transcript"
import { splitMentionContext } from "~/shared/mentions"
import { invokedSkill } from "~/shared/skills"
import { parseUiAction } from "~/shared/ui-action"
import { splitUiNotes } from "~/shared/ui-notes"
import { parseSpaceUpdates, START_THREAD_TOOL } from "~/shared/spaces"
import { Collapse } from "./collapse"
import { ConfirmCard } from "./confirm-card"
import { Download } from "lucide-react"
import { AssetDownloadLink, mediaDownloadHref, MediaPlayer, videoSource } from "./media"
import { SpaceUpdates, ThreadCard } from "./space-panel"
import { Markdown } from "./markdown"
import { summarize, ToolCard, toolActivity, TranscriptImage } from "./tool-card"
import { useNow } from "./vm-status"

// Keep the generative UI renderer out of the Worker SSR bundle; chats are client-rendered anyway.
const OpenUIBlock = lazy(() =>
  import.meta.env.SSR
    ? Promise.resolve({ default: (() => null) as unknown as typeof import("./openui-block")["default"] })
    : import("./openui-block")
)
const EMPTY_TOOLS: Readonly<Record<string, LiveTool>> = {}

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

const isUi = (block: Block) => block.type === "toolCall" && block.name === "render_ui" && typeof block.arguments.code === "string"
/** Thinking and tool calls: the work behind a reply, folded into its activity row. */
const isWork = (block: Block) => (block.type === "thinking" && block.thinking.trim() !== "") || (block.type === "toolCall" && !isUi(block))

/** The latest non-empty line of some thinking or notes, scanned from the end so streaming stays O(line). */
const latestLine = (text: string) => {
  let end = text.length
  while (end > 0) {
    const start = text.lastIndexOf("\n", end - 1) + 1
    const line = text.slice(start, end).replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim()
    if (line) return line.slice(-200)
    end = start - 1
  }
  return ""
}

const duration = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/**
 * Everything the model did on the way to its answer, as one row: a status line that follows the current step (and
 * rotates while it thinks), counts, and time. Tap to see every thought, note, and tool call in order.
 */
const Activity = memo(function Activity(props: {
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
  const current = calls.findLast((call) => !results.has(call.id))

  // What's really happening: the running tool and its arguments; else the latest line of the model's thinking or
  // notes; else the tool it just ran.
  const latest = steps.findLast((step) => (step.block.type === "thinking" ? step.block.thinking.trim() : step.block.type !== "text" || step.block.text.trim()))
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
        {() => (
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
        )}
      </Collapse>
    </div>
  )
})

/** One reply: its work folded into an activity row, then what it shows you (answer text and UI cards). */
const AssistantTurn = memo(AssistantTurnView, (prev, next) => {
  // A finished reply never changes unless one of its own tool results arrives later: skip it while newer replies stream.
  if (prev.active || next.active || prev.streaming || next.streaming) return false
  if (prev.endedAt !== next.endedAt || prev.onSend !== next.onSend || prev.onContinue !== next.onContinue || prev.messages.length !== next.messages.length) return false
  if (!prev.messages.every((message, index) => message === next.messages[index])) return false
  if (prev.results === next.results) return true
  for (const message of prev.messages) {
    for (const block of message.content) {
      if (block.type === "toolCall" && prev.results.get(block.id) !== next.results.get(block.id)) return false
    }
  }
  return true
})

function AssistantTurnView(props: {
  messages: ReadonlyArray<AssistantMessage>
  streaming: boolean
  active: boolean
  endedAt: number | null
  results: Map<string, ToolResultMessage>
  tools: Readonly<Record<string, LiveTool>>
  onSend: (text: string) => void
  onContinue?: () => Promise<void>
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
  // A failed request the chat retried and got past isn't the reply's outcome: it's noted quietly with the work. Only a
  // failure the reply ended on shows as an error (while it's still running, the retry note below the chat says so).
  const failedLast = final?.stopReason === "error"
  const recovered = messages.filter((message, index) => message.stopReason === "error" && !(failedLast && index === messages.length - 1))
  // Memory feeds every future chat, so a change to it is never tucked away in the activity row.
  const touchedMemory = blocks.some(({ block }) => {
    if (block.type !== "toolCall") return false
    const args = block.arguments as Record<string, unknown>
    if (block.name === "write_file" || block.name === "edit_file") return /(^|\/)MEMORY\.md$/i.test(String(args.path ?? ""))
    if (block.name === "bash") return /MEMORY\.md/i.test(String(args.command ?? "")) && /(>|\btee\b|sed\s+-i)/.test(String(args.command ?? ""))
    return false
  })
  // Media the chat shared shows in the reply even if the model forgot to put its Markdown in the text.
  const shareCalls = blocks.filter((step) => step.block.type === "toolCall" && step.block.name === "share_media")
  const shownText = shareCalls.length > 0 ? shown.map(({ block }) => (block.type === "text" ? block.text : "")).join("\n") : ""
  const sharedMedia = shareCalls.flatMap((step) => {
    if (step.block.type !== "toolCall") return []
    const details = props.results.get(step.block.id)?.details as { media?: { url: string; name: string } } | undefined
    return details?.media && !shownText.includes(details.media.url) ? [details.media] : []
  })
  // Threads a space's coordinator started: each a live card in its reply.
  const threads = blocks.flatMap((step) => {
    if (step.block.type !== "toolCall" || step.block.name !== START_THREAD_TOOL) return []
    const details = props.results.get(step.block.id)?.details as { thread?: { id: string; title: string } } | undefined
    return details?.thread ? [details.thread] : []
  })
  // Admin operations and MCP tool approvals (direct or nested inside batch_tools) stay in view until answered.
  const confirmations = blocks.flatMap((step) => {
    if (step.block.type !== "toolCall") return []
    const { name } = step.block
    if (name !== "app_call" && name !== "batch_tools" && !name.includes("__")) return []
    const details = props.results.get(step.block.id)?.details as
      | { confirmation?: { id: string; summary: string }; confirmations?: ReadonlyArray<{ id: string; summary: string }> }
      | undefined
    if (details?.confirmations?.length) return [...details.confirmations]
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
      {recovered.length > 0 && <RecoveredErrors errors={recovered.map((message) => message.errorMessage ?? "The model request failed.")} />}
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
      {threads.map((thread) => (
        <ThreadCard key={thread.id} id={thread.id} title={thread.title} />
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
                streaming={step.live}
                card={block.id}
                onSend={props.onSend}
              />
            </Suspense>
          )
        }
        return null
      })}
      {failedLast && !props.active && (
        <ErrorNote className="my-2" text={final.errorMessage ?? "The model request failed."} onContinue={props.onContinue} />
      )}
      {final?.stopReason === "aborted" && <div className="my-1 text-xs text-zinc-500">Stopped.</div>}
    </div>
  )
}

/**
 * A message's text, with a leading `/skill` set off (that message invoked the skill), and the note Dex added about
 * what you did in the chat's UI since your last message shown as a note rather than as your words.
 */
function UserText({ text: raw }: { text: string }) {
  const { notes, text: withoutNotes } = splitUiNotes(raw)
  const { text, contexts } = splitMentionContext(withoutNotes)
  const action = parseUiAction(text)
  const skill = action ? null : invokedSkill(text)
  const at = skill ? text.indexOf(`/${skill}`) : -1
  return (
    <>
      {notes.length > 0 && (
        <span className="mb-1.5 flex items-start gap-1.5 text-xs text-zinc-400" title="Dex told the chat what you did with its UI since your last message">
          <MousePointerClick className="mt-0.5 size-3 shrink-0" />
          <span>In the UI: {notes.join("; ")}</span>
        </span>
      )}
      {action ? (
        // A button pressed in the chat's UI: what it does, and what it carried (form fields, the button's context).
        <>
          <span className="flex items-start gap-1.5" title="You pressed this in the chat's UI">
            <MousePointerClick className="mt-[3px] size-3.5 shrink-0 text-zinc-400" />
            <span className="min-w-0">{action.message}</span>
          </span>
          {action.details.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1 whitespace-normal">
              {action.details.map((detail) => (
                <span key={`${detail.label}:${detail.value}`} className="max-w-full rounded-md bg-zinc-950/40 px-1.5 py-0.5 text-xs text-zinc-300">
                  {detail.label && <span className="text-zinc-500">{detail.label} </span>}
                  {detail.value}
                </span>
              ))}
            </span>
          )}
        </>
      ) : skill && at !== -1 ? (
        <>
          {text.slice(0, at)}
          <span className="font-mono font-medium text-emerald-300">/{skill}</span>
          {text.slice(at + skill.length + 1)}
        </>
      ) : (
        text
      )}
      {contexts.length > 0 && (
        <span className="mt-2 flex flex-wrap gap-1 whitespace-normal">
          {contexts.map((ctx) => (
            <span
              key={ctx.label}
              title="Context resolved automatically from @mention"
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-emerald-950/60 px-1.5 py-0.5 text-[11px] text-emerald-300 ring-1 ring-emerald-800/40"
            >
              <Paperclip className="size-3 shrink-0" />
              <span className="truncate">{ctx.label}</span>
            </span>
          ))}
        </span>
      )}
    </>
  )
}

/** What was attached to one of your messages: its images as thumbnails, its other files as chips. */
function UserAttachments({
  images,
  files,
  spaced
}: {
  images: ReadonlyArray<{ readonly mimeType: string; readonly data: string; readonly ref?: string }>
  files: ReadonlyArray<AttachedFile>
  spaced: boolean
}) {
  const params = useParams({ strict: false })
  const chatId = "sessionId" in params ? params.sessionId : undefined
  // Each image has a tag naming it among the files, and the thumbnails stand for those. Images a text-only model
  // never got (no image part) show by name instead.
  const isImage = (file: AttachedFile) => file.mimeType.startsWith("image/") && file.mimeType !== "image/svg+xml"
  const imageFiles = files.filter(isImage)
  const others = [...imageFiles.slice(images.length), ...files.filter((file) => !isImage(file))]
  const thumb = "size-24 rounded-lg object-cover"
  return (
    <div className={`flex flex-wrap items-start gap-1.5 whitespace-normal ${spaced ? "mb-2" : ""}`}>
      {images.map((image, index) =>
        image.data ? (
          <span key={index} className="relative inline-block">
            <img src={`data:${image.mimeType};base64,${image.data}`} alt="Attached image" className={thumb} />
            <span className="absolute top-1 right-1">
              <AssetDownloadLink
                url={`data:${image.mimeType};base64,${image.data}`}
                title={imageFiles[index]?.name ?? `image-${index + 1}.${image.mimeType.split("/")[1] ?? "png"}`}
                label=""
                compact
                className="inline-flex items-center justify-center rounded-md bg-black/65 p-1 text-zinc-100 ring-1 ring-white/15 backdrop-blur hover:bg-black/85"
              />
            </span>
          </span>
        ) : image.ref && chatId ? (
          <TranscriptImage
            key={index}
            chatId={chatId}
            ref_={image.ref}
            alt="Attached image"
            className={thumb}
            placeholderClassName="flex size-24 items-center justify-center rounded-lg bg-zinc-900 text-[10px] text-zinc-500"
          />
        ) : null
      )}
      {others.map((file, index) => {
        const chip = "flex max-w-60 items-center gap-1.5 rounded-lg bg-zinc-900/80 px-2 py-1.5 text-xs text-zinc-300"
        const content = (
          <>
            <FileIcon mimeType={file.mimeType} name={file.name} className="size-3.5 shrink-0 text-zinc-400" />
            <span className="min-w-0 truncate">{file.name}</span>
          </>
        )
        // A stored file can be previewed or downloaded directly in one tap.
        return file.key ? (
          <span key={`file-${index}`} className="inline-flex max-w-64 items-center overflow-hidden rounded-lg bg-zinc-900/80 text-xs text-zinc-300">
            <a href={`/api/media/${file.key}`} target="_blank" rel="noreferrer" title={file.name} className="flex min-w-0 items-center gap-1.5 px-2 py-1.5 hover:bg-zinc-800">
              {content}
            </a>
            <a
              href={mediaDownloadHref(`/api/media/${file.key}`, file.name)}
              download={file.name}
              title={`Download ${file.name}`}
              aria-label={`Download ${file.name}`}
              className="flex shrink-0 items-center border-l border-zinc-800 px-2 py-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Download className="size-3.5" />
            </a>
          </span>
        ) : (
          <span key={`file-${index}`} title={file.name} className={chip}>
            {content}
          </span>
        )
      })}
    </div>
  )
}

/** Memoized: the chat page re-renders on every synced-state change, but the transcript only on its own. */
/** How a scheduled prompt starts in the transcript (see runScheduledPrompt). */
const SCHEDULED_PREFIX = "[Scheduled task] "

export interface Speaker {
  readonly name: string
  /** Their face, 24px: still beside each reply, animated on the greeting and while a reply is coming. */
  readonly avatar: ReactNode
  readonly working?: ReactNode
  readonly greeter?: ReactNode
  readonly greeting?: string
}

/**
 * Where the model's context starts again: a summary of what came before (or a reset). The summary is what the model
 * was given in place of the messages above it; it opens from the divider.
 */
const ContextDivider = memo(function ContextDivider({ label, summary }: { label: string; summary?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <div className="flex items-center gap-3 text-xs text-zinc-600">
        <div className="h-px flex-1 bg-zinc-800" />
        {summary ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          >
            <ListChecks className="size-3.5" />
            {label}
            <ChevronRight className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        ) : (
          label
        )}
        <div className="h-px flex-1 bg-zinc-800" />
      </div>
      {summary && (
        <Collapse open={open}>
          {() => (
            <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-300">
              <p className="mb-2 text-xs text-zinc-500">What the model was given in place of the messages above</p>
              <Markdown>{summary}</Markdown>
            </div>
          )}
        </Collapse>
      )}
    </div>
  )
})

const UserRow = memo(function UserRow({ item }: { item: Extract<DisplayItem, { kind: "user" }> }) {
  // Threads reporting back to a space's coordinator: event rows, not something you said.
  const updates = item.text ? parseSpaceUpdates(item.text) : null
  if (updates?.length) return <SpaceUpdates updates={updates} />
  // A prompt that ran on a schedule: the chat reaching out on its own, not something you said.
  if (item.text?.startsWith(SCHEDULED_PREFIX)) {
    return (
      <div className="flex animate-fade items-center justify-center gap-1.5 text-xs text-zinc-500">
        <AlarmClock className="size-3.5 shrink-0" />
        <span className="truncate" title={item.text.slice(SCHEDULED_PREFIX.length)}>
          Scheduled: {item.text.slice(SCHEDULED_PREFIX.length)}
        </span>
      </div>
    )
  }
  return (
    <div className="flex animate-rise justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-800 px-4 py-2.5 text-sm whitespace-pre-wrap text-zinc-100 [overflow-wrap:anywhere]">
        {(item.imageParts || item.files) && <UserAttachments images={item.imageParts ?? []} files={item.files ?? []} spaced={Boolean(item.text)} />}
        {item.text && <UserText text={item.text} />}
      </div>
    </div>
  )
})

const hasUiTool = (message: AssistantMessage) =>
  message.content.some((block) => block.type === "toolCall" && (block.name === "load_ui_guide" || block.name === "render_ui"))

export const MessageList = memo(function MessageList({
  transcript,
  onSend,
  onLoadEarlier,
  onContinue,
  pending = [],
  speaker
}: {
  transcript: TranscriptState
  onSend: (text: string) => void
  /** Loads the chat's older messages (shown while `transcript.earlier`). */
  onLoadEarlier?: () => Promise<void>
  /** Resumes the chat from the last failed or interrupted run without adding a new user turn. */
  onContinue?: () => Promise<void>
  /** Messages just sent that the agent hasn't recorded yet, shown at once (see the chat page). */
  pending?: readonly string[]
  /** Who answers, when it isn't Dex (a character): their face beside replies, and their greeting first. */
  speaker?: Speaker
}) {
  const recorded = useMemo(() => recordedDisplayItems(transcript.entries), [transcript.entries])
  const items = useMemo(() => displayItemsWithStreaming(recorded, transcript.streaming), [recorded, transcript.streaming])
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
      if (Date.now() - clickedAt.current < 400) {
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

  // Older messages go in above what you're reading without moving it: keep the distance from the bottom.
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [earlierError, setEarlierError] = useState<string | null>(null)
  const restoreFromBottom = useRef<number | null>(null)
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element || restoreFromBottom.current === null) return
    element.scrollTop = element.scrollHeight - restoreFromBottom.current
    restoreFromBottom.current = null
  }, [items])
  const loadEarlier = async () => {
    const element = scroller.current
    if (!onLoadEarlier || loadingEarlier) return
    setLoadingEarlier(true)
    setEarlierError(null)
    try {
      if (element) restoreFromBottom.current = element.scrollHeight - element.scrollTop
      await onLoadEarlier()
    } catch (error) {
      restoreFromBottom.current = null
      setEarlierError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingEarlier(false)
    }
  }

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
  const recordedHasUi = useMemo(
    () => recorded.some((item) => item.kind === "assistant" && item.messages.some(hasUiTool)),
    [recorded]
  )
  const wantsUi = recordedHasUi || (transcript.streaming ? hasUiTool(transcript.streaming) : false)
  useEffect(() => {
    if (wantsUi && !import.meta.env.SSR) void import("./openui-block")
  }, [wantsUi])

  // Virtualize marathon chats (60+ turns) so DOM node count stays flat while short chats avoid measurement overhead.
  const virtualized = items.length >= 60
  const virtualizer = useVirtualizer({
    count: virtualized ? items.length : 0,
    getScrollElement: () => scroller.current,
    estimateSize: () => 180,
    overscan: 8,
    gap: 20
  })

  const renderItem = (item: DisplayItem, index: number) => {
    const isLast = index === items.length - 1
    // Historical turns skip off-screen browser layout & paint via content-visibility while preserving scroll accuracy.
    const historical = !virtualized && !isLast ? "[content-visibility:auto] [contain-intrinsic-size:auto_120px]" : ""
    switch (item.kind) {
      case "user":
        return (
          <div key={item.id} className={historical}>
            <UserRow item={item} />
          </div>
        )
      case "assistant": {
        // Keep a stable React key across streaming ("streaming") -> committed ("42:0") so turns never unmount/remount.
        const prevAnchor = index > 0 ? items[index - 1]!.id : "start"
        const turnKey = `assistant-after-${prevAnchor}`
        return (
          <div key={turnKey} className={`flex animate-rise gap-3 ${historical}`}>
            {speaker ? (
              <span className="mt-0.5 shrink-0" title={speaker.name}>
                {transcript.running && isLast ? (speaker.working ?? speaker.avatar) : speaker.avatar}
              </span>
            ) : (
              <img src="/favicon.svg" alt="Dex" className="mt-0.5 size-6 shrink-0" />
            )}
            <AssistantTurn
              messages={item.messages}
              streaming={item.streaming}
              active={transcript.running && isLast}
              endedAt={item.endedAt}
              results={results}
              tools={isLast ? transcript.tools : EMPTY_TOOLS}
              onSend={onSend}
              onContinue={isLast && !transcript.running ? onContinue : undefined}
            />
          </div>
        )
      }
      case "divider":
        return <ContextDivider key={item.id} label={item.label} summary={item.summary} />
    }
  }

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
        <div
          ref={content}
          onClickCapture={(event) => {
            // Only interactive toggles (accordions, disclosures) suppress auto-scroll; selecting text or empty clicks don't.
            if (event.target instanceof Element && event.target.closest("button, summary, [role='button']")) {
              clickedAt.current = Date.now()
            }
          }}
          className="mx-auto max-w-3xl space-y-5 px-4 py-6"
        >
          {transcript.earlier && onLoadEarlier && (
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => void loadEarlier()}
                disabled={loadingEarlier}
                className="flex items-center gap-1.5 rounded-full border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-60"
              >
                {loadingEarlier && <LoaderCircle className="size-3.5 animate-spin" />}
                Show earlier messages
              </button>
              {earlierError && <ErrorNote text={earlierError} className="text-center" />}
            </div>
          )}
          {speaker?.greeting && (
            <div className="flex animate-rise gap-3">
              <span className="mt-0.5 shrink-0" title={speaker.name}>{speaker.greeter ?? speaker.avatar}</span>
              <div className="min-w-0 flex-1 pt-0.5 text-sm leading-relaxed whitespace-pre-wrap text-zinc-200 [overflow-wrap:anywhere]">{speaker.greeting}</div>
            </div>
          )}
          {virtualized ? (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
              {virtualizer.getVirtualItems().map((vItem) => {
                const item = items[vItem.index]
                if (!item) return null
                return (
                  <div
                    key={vItem.key}
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vItem.start}px)` }}
                  >
                    {renderItem(item, vItem.index)}
                  </div>
                )
              })}
            </div>
          ) : (
            items.map((item, index) => renderItem(item, index))
          )}
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
          {transcript.running &&
            items.at(-1)?.kind !== "assistant" &&
            // A sidekick with nothing to say yet: just their face, hopping while they work.
            (speaker?.working ? (
              <div className="flex animate-fade" title={`${speaker.name} is working`} aria-label={`${speaker.name} is working`}>
                {speaker.working}
              </div>
            ) : (
              <div className="flex animate-fade items-center gap-2 pl-9 text-xs text-zinc-500">
                <LoaderCircle className="size-3.5 animate-spin" /> Working…
              </div>
            ))}
          {transcript.retry && (
            <div className="line-clamp-2 pl-9 text-xs text-amber-400/80 [overflow-wrap:anywhere]" title={transcript.retry.error}>
              Retrying after an error: {transcript.retry.error}
            </div>
          )}
          {transcript.error && <ErrorNote text={transcript.error} onContinue={!transcript.running ? onContinue : undefined} />}
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

/** Requests that failed and were retried, folded into one line; open, each different error once with its count. */
function RecoveredErrors({ errors }: { errors: readonly string[] }) {
  const [open, setOpen] = useState(false)
  const counts = new Map<string, number>()
  for (const error of errors) counts.set(error, (counts.get(error) ?? 0) + 1)
  return (
    <div className="my-1 text-xs text-amber-400/70">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1.5 hover:text-amber-300">
        <AlertTriangle className="size-3.5 shrink-0" />
        Retried after {errors.length === 1 ? "an error" : `${errors.length} errors`}
        <ChevronRight className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <ul className="mt-1 space-y-1 pl-5 text-amber-300/70">
          {[...counts].map(([error, count]) => (
            <li key={error} className="line-clamp-3 [overflow-wrap:anywhere]" title={error}>
              {count > 1 && <span className="text-amber-400/90">{count}× </span>}
              {error}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * A failed request, in the chat's column: providers' errors carry long unbroken JSON and URLs, so it wraps anywhere,
 * and a long one shows its first lines until opened.
 */
function ErrorNote({ text, className = "", onContinue }: { text: string; className?: string; onContinue?: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const long = text.length > 240
  return (
    <div className={`flex min-w-0 items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300 ${className}`}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className={`[overflow-wrap:anywhere] whitespace-pre-wrap ${long && !open ? "line-clamp-3" : ""}`}>{text}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          {onContinue && (
            <button
              type="button"
              disabled={retrying}
              onClick={async () => {
                setRetrying(true)
                try {
                  await onContinue()
                } catch (cause) {
                  toast.error(cause instanceof Error ? cause.message : "Could not continue this run")
                } finally {
                  setRetrying(false)
                }
              }}
              className="inline-flex items-center gap-1 rounded-md border border-red-800/70 bg-red-900/40 px-2 py-0.5 text-[11px] font-medium text-red-100 hover:bg-red-900/70 disabled:opacity-50"
            >
              {retrying ? <LoaderCircle className="size-3 animate-spin" /> : <RotateCw className="size-3" />}
              Continue
            </button>
          )}
          {long && (
            <button type="button" onClick={() => setOpen(!open)} className="text-red-400/80 hover:text-red-200">
              {open ? "Show less" : "Show all"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
