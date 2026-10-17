import type { AssistantMessage, ToolCall, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai"
import type { AgentEvent, EntryRecord, SnapshotEvent } from "@earendil-works/pi-durable"
import { Predicate } from "effect"

export interface LiveTool {
  readonly callId: string
  readonly name: string
  readonly status: "pending" | "running" | "done"
  readonly args?: unknown
  readonly output: string
  readonly details?: unknown
}

/** One chat as the UI sees it, folded from Pi's snapshot and event batches. */
export interface TranscriptState {
  readonly entries: ReadonlyArray<EntryRecord>
  /** The assistant message being streamed, if any. */
  readonly streaming: AssistantMessage | null
  readonly tools: Readonly<Record<string, LiveTool>>
  readonly running: boolean
  readonly queued: number
  readonly retry: { readonly at: number; readonly error: string } | null
  readonly error: string | null
}

export const emptyTranscript: TranscriptState = {
  entries: [],
  streaming: null,
  tools: {},
  running: false,
  queued: 0,
  retry: null,
  error: null
}

export const fromSnapshot = (snapshot: SnapshotEvent): TranscriptState => ({
  entries: snapshot.entries,
  streaming: snapshot.generation?.message ? structuredClone(snapshot.generation.message) : null,
  tools: Object.fromEntries(
    snapshot.tools.map((slot) => [
      slot.callId,
      { callId: slot.callId, name: slot.name, status: slot.status, output: slot.output ?? "", details: slot.details }
    ])
  ),
  running: snapshot.run !== undefined,
  queued: snapshot.inbox.length,
  retry: snapshot.generation?.retry ?? null,
  error: null
})

const appendEntry = (entries: ReadonlyArray<EntryRecord>, entry: EntryRecord) =>
  entries.some((existing) => existing.id === entry.id) ? entries : [...entries, entry]

/** Appends `delta` to the string at `path` inside `target`, creating objects on the way. */
const appendAtPath = (target: Record<string, unknown>, path: ReadonlyArray<string | number>, delta: string) => {
  let node: Record<string | number, unknown> = target
  for (const key of path.slice(0, -1)) {
    const next = node[key]
    node = (Predicate.isObject(next) ? next : (node[key] = {})) as Record<string | number, unknown>
  }
  const last = path[path.length - 1]
  if (last === undefined) return
  const current = node[last]
  node[last] = (Predicate.isString(current) ? current : "") + delta
}

const applyMessageUpdate = (message: AssistantMessage, changes: Extract<AgentEvent, { type: "message_update" }>["changes"]) => {
  const next = structuredClone(message)
  for (const change of changes) {
    switch (change.type) {
      case "message":
        return structuredClone(change.message)
      case "text_start":
      case "thinking_start":
      case "toolcall_start":
      case "block":
        next.content[change.contentIndex] = structuredClone(change.block)
        break
      case "text_delta": {
        const block = next.content[change.contentIndex]
        if (block?.type === "text") block.text += change.delta
        break
      }
      case "thinking_delta": {
        const block = next.content[change.contentIndex]
        if (block?.type === "thinking") block.thinking += change.delta
        break
      }
      case "toolcall_delta": {
        const block = next.content[change.contentIndex]
        if (block?.type === "toolCall") appendAtPath(block.arguments as Record<string, unknown>, change.path, change.delta)
        break
      }
    }
  }
  return next
}

const updateTool = (state: TranscriptState, callId: string, update: (tool: LiveTool) => LiveTool, name = "tool") => {
  const current = state.tools[callId] ?? { callId, name, status: "running" as const, output: "" }
  return { ...state, tools: { ...state.tools, [callId]: update(current) } }
}

export const applyEvent = (state: TranscriptState, event: AgentEvent): TranscriptState => {
  switch (event.type) {
    case "snapshot":
      return fromSnapshot(event)
    case "run_start":
      return { ...state, running: true, error: null }
    case "run_end":
      return { ...state, running: false, streaming: null, tools: {}, retry: null }
    case "message_start":
      return event.message.role === "assistant" ? { ...state, streaming: structuredClone(event.message) } : state
    case "message_update":
      return state.streaming ? { ...state, streaming: applyMessageUpdate(state.streaming, event.changes) } : state
    case "message_end":
      return { ...state, streaming: null, entries: appendEntry(state.entries, event.entry) }
    case "entry_appended":
      return { ...state, entries: appendEntry(state.entries, event.entry) }
    case "tool_execution_start":
      if (event.parentToolCallId) return state
      return updateTool(state, event.toolCallId, (tool) => ({ ...tool, name: event.toolName, status: "running", args: event.args }), event.toolName)
    case "tool_execution_update": {
      if (event.parentToolCallId) return state
      return updateTool(state, event.toolCallId, (tool) => {
        let output = tool.output
        if (event.output && "set" in event.output) output = event.output.set
        else if (event.output) output = output.slice(event.output.trimStart ?? 0) + (event.output.append ?? "")
        return { ...tool, output, details: event.details ?? tool.details }
      }, event.toolName)
    }
    case "tool_execution_end": {
      if (event.parentToolCallId) return state
      const withTool = updateTool(state, event.toolCallId, (tool) => ({ ...tool, status: "done" }), event.toolName)
      return event.entry ? { ...withTool, entries: appendEntry(withTool.entries, event.entry) } : withTool
    }
    case "inbox_update":
      return { ...state, queued: event.items.length }
    case "auto_retry_start":
      return { ...state, retry: { at: event.at, error: event.errorMessage } }
    case "auto_retry_end":
      return { ...state, retry: null }
    case "task_failed":
      return { ...state, error: event.message }
    default:
      return state
  }
}

// ── Reading entries ─────────────────────────────────────────────────────────

export type DisplayItem =
  | { readonly kind: "user"; readonly id: string; readonly text: string; readonly images: number }
  | { readonly kind: "assistant"; readonly id: string; readonly message: AssistantMessage; readonly streaming: boolean }
  | { readonly kind: "divider"; readonly id: string; readonly label: string }

const userText = (message: UserMessage) =>
  typeof message.content === "string"
    ? { text: message.content, images: 0 }
    : {
        text: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
        images: message.content.filter((part) => part.type === "image").length
      }

export const toolResults = (entries: ReadonlyArray<EntryRecord>) => {
  const results = new Map<string, ToolResultMessage>()
  for (const entry of entries) {
    for (const message of entry.model ?? []) {
      if (message.role === "toolResult") results.set(message.toolCallId, message)
    }
  }
  return results
}

export const displayItems = (state: TranscriptState): DisplayItem[] => {
  const items: DisplayItem[] = []
  for (const entry of state.entries) {
    if (entry.kind === "pi.reset") items.push({ kind: "divider", id: String(entry.id), label: "Context reset" })
    else if (entry.kind === "pi.compaction") items.push({ kind: "divider", id: String(entry.id), label: "Earlier messages summarized" })
    for (const [index, message] of (entry.model ?? []).entries()) {
      const id = `${entry.id}:${index}`
      if (message.role === "user") items.push({ kind: "user", id, ...userText(message) })
      else if (message.role === "assistant") items.push({ kind: "assistant", id, message, streaming: false })
    }
  }
  if (state.streaming) items.push({ kind: "assistant", id: "streaming", message: state.streaming, streaming: true })
  return items
}

export const isToolCall = (block: AssistantMessage["content"][number]): block is ToolCall => block.type === "toolCall"
