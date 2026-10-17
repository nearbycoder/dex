import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai"
import { Predicate } from "effect"
import { AlertTriangle, ChevronRight, LoaderCircle, Sparkles } from "lucide-react"
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { displayItems, type LiveTool, toolResults, type TranscriptState } from "~/client/lib/transcript"
import { Markdown } from "./markdown"
import { ToolCard } from "./tool-card"

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
      {open && <div className="mt-1 border-l border-zinc-800 pl-3 whitespace-pre-wrap">{text}</div>}
    </div>
  )
}

function AssistantBlocks(props: {
  message: AssistantMessage
  streaming: boolean
  results: Map<string, ToolResultMessage>
  tools: Readonly<Record<string, LiveTool>>
  onSend: (text: string) => void
}) {
  const { message } = props
  return (
    <div className="min-w-0">
      {message.content.map((block, index) => {
        const last = index === message.content.length - 1
        switch (block.type) {
          case "thinking":
            return <Thinking key={index} text={block.thinking} streaming={props.streaming && last} />
          case "text":
            return block.text ? <Markdown key={index}>{block.text}</Markdown> : null
          case "toolCall": {
            const code = block.arguments.code
            if (block.name === "render_ui" && Predicate.isString(code)) {
              return (
                <Suspense key={block.id || index} fallback={<div className="my-3 h-24 animate-pulse rounded-xl bg-zinc-900" />}>
                  <OpenUIBlock code={code} streaming={props.streaming} onSend={props.onSend} />
                </Suspense>
              )
            }
            return <ToolCard key={block.id || index} call={block} result={props.results.get(block.id)} live={props.tools[block.id]} />
          }
        }
      })}
      {message.stopReason === "error" && (
        <div className="my-2 flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-words">{message.errorMessage ?? "The model request failed."}</span>
        </div>
      )}
      {message.stopReason === "aborted" && <div className="my-1 text-xs text-zinc-500">Stopped.</div>}
    </div>
  )
}

export function MessageList({ transcript, onSend }: { transcript: TranscriptState; onSend: (text: string) => void }) {
  const items = useMemo(() => displayItems(transcript), [transcript])
  const results = useMemo(() => toolResults(transcript.entries), [transcript.entries])
  const bottom = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pinned.current) bottom.current?.scrollIntoView({ block: "end" })
  }, [items])

  return (
    <div
      ref={scroller}
      className="scrollbar-thin flex-1 overflow-y-auto"
      onScroll={(event) => {
        const element = event.currentTarget
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
      }}
    >
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {items.map((item) => {
          switch (item.kind) {
            case "user":
              return (
                <div key={item.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-800 px-4 py-2.5 text-sm whitespace-pre-wrap text-zinc-100">
                    {item.text}
                    {item.images > 0 && <div className="mt-1 text-xs text-zinc-400">+{item.images} image(s)</div>}
                  </div>
                </div>
              )
            case "assistant":
              return (
                <div key={item.id} className="flex gap-3">
                  <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-emerald-600/15 text-emerald-400">
                    <Sparkles className="size-3.5" />
                  </div>
                  <AssistantBlocks
                    message={item.message}
                    streaming={item.streaming}
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
        {transcript.running && !transcript.streaming && (
          <div className="flex items-center gap-2 pl-9 text-xs text-zinc-500">
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
}
