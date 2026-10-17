import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai"
import { Predicate } from "effect"
import { Link, useParams } from "@tanstack/react-router"
import {
  BookOpen,
  Camera,
  Monitor,
  ChevronRight,
  Clock,
  FilePen,
  FileText,
  Globe,
  LoaderCircle,
  type LucideIcon,
  Plug,
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
  cancel_scheduled_prompt: Clock,
  vm_exec: Monitor,
  vm_read_file: FileText,
  vm_write_file: FilePen,
  vm_expose_port: Globe,
  vm_screenshot: Camera,
  vm_stop: Monitor
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
  const params = useParams({ strict: false })
  const chatId = "sessionId" in params ? params.sessionId : undefined
  const Icon = call.name.includes("skill") ? BookOpen : (icons[call.name] ?? (call.name.includes("__") ? Plug : Wrench))
  const pending = !result
  const running = pending && live?.status === "running"
  const output = result ? resultText(result) : (live?.output ?? "")
  const failed = result?.isError
  const images = result?.content.flatMap((part) => (part.type === "image" ? [part] : [])) ?? []
  const onVm = call.name.startsWith("vm_")
  // Stream a running VM command open so its output is visible as it arrives.
  const showLive = onVm && pending && output.length > 0

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
        {onVm && (
          <Link
            to="/machine"
            search={chatId ? { vm: chatId } : {}}
            onClick={(event) => event.stopPropagation()}
            className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            title="Watch this chat's VM live"
          >
            watch
          </Link>
        )}
        <span className={onVm ? "shrink-0" : "ml-auto shrink-0"}>
          {pending ? (
            <LoaderCircle className={`size-3.5 text-zinc-500 ${running || !live ? "animate-spin" : ""}`} />
          ) : failed ? (
            <span className="text-red-400">failed</span>
          ) : null}
        </span>
      </button>
      {images.map((image, index) => (
        <img
          key={index}
          src={`data:${image.mimeType};base64,${image.data}`}
          alt="VM screenshot"
          className="block w-full border-t border-zinc-800"
        />
      ))}
      {showLive && !open && (
        <pre className="scrollbar-thin max-h-48 overflow-auto border-t border-zinc-800 bg-zinc-950 px-3 py-2 font-mono whitespace-pre-wrap text-zinc-300">
          {output.slice(-4000)}
        </pre>
      )}
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
