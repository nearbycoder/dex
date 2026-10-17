import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai"
import { Predicate } from "effect"
import {
  BookOpen,
  ChevronRight,
  Clock,
  FilePen,
  FileText,
  Globe,
  LoaderCircle,
  type LucideIcon,
  Search,
  Terminal,
  Wrench
} from "lucide-react"
import { useState } from "react"
import type { LiveTool } from "~/client/lib/transcript"

const icons: Record<string, LucideIcon> = {
  bash: Terminal,
  read_file: FileText,
  write_file: FilePen,
  edit_file: FilePen,
  web_search: Search,
  web_fetch: Globe,
  schedule_prompt: Clock,
  list_scheduled_prompts: Clock,
  cancel_scheduled_prompt: Clock
}

const summaryKeys = ["command", "path", "query", "url", "prompt", "name", "id"]

const summarize = (args: unknown) => {
  if (!Predicate.isObject(args)) return ""
  const record = args as Record<string, unknown>
  for (const key of summaryKeys) {
    const value = record[key]
    if (Predicate.isString(value) && value) return value.split("\n")[0] ?? ""
  }
  return JSON.stringify(args).slice(0, 120)
}

export const resultText = (result: ToolResultMessage | undefined) =>
  result?.content.flatMap((part) => (part.type === "text" ? [part.text] : ["[image]"])).join("\n") ?? ""

export function ToolCard({ call, result, live }: { call: ToolCall; result?: ToolResultMessage; live?: LiveTool }) {
  const [open, setOpen] = useState(false)
  const Icon = call.name.includes("skill") ? BookOpen : (icons[call.name] ?? Wrench)
  const pending = !result
  const running = pending && live?.status === "running"
  const output = result ? resultText(result) : (live?.output ?? "")
  const failed = result?.isError

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60 text-xs">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/50"
      >
        <ChevronRight className={`size-3.5 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`} />
        <Icon className={`size-3.5 shrink-0 ${failed ? "text-red-400" : "text-emerald-400"}`} />
        <span className="shrink-0 font-medium text-zinc-300">{call.name}</span>
        <span className="truncate font-mono text-zinc-500">{summarize(call.arguments)}</span>
        <span className="ml-auto shrink-0">
          {pending ? (
            <LoaderCircle className={`size-3.5 text-zinc-500 ${running || !live ? "animate-spin" : ""}`} />
          ) : failed ? (
            <span className="text-red-400">failed</span>
          ) : null}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-zinc-800 px-3 py-2">
          <pre className="scrollbar-thin max-h-48 overflow-auto font-mono whitespace-pre-wrap text-zinc-400">
            {JSON.stringify(call.arguments, null, 2)}
          </pre>
          {output && (
            <pre
              className={`scrollbar-thin max-h-96 overflow-auto rounded bg-zinc-950 p-2 font-mono whitespace-pre-wrap ${failed ? "text-red-300" : "text-zinc-300"}`}
            >
              {output}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
