import type { AssistantMessage, ToolCall, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai"
// Relative, with .ts: the Android goldens (apps/android/tools/goldens) run this file in Node, which has no ~ alias.
import { type AttachedFile, splitAttachments } from "../../shared/attachments.ts"
import type { AgentEvent, EntryRecord, SnapshotEvent } from "@earendil-works/pi-durable"
import type { ChatArtifact } from "~/shared/media"
import type { QueuedMessage } from "~/shared/protocol"

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

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
  /** The agent has sent this chat's snapshot (or it was shown from the recent-chats cache). */
  readonly loaded: boolean
  /** Files stored in the chat, and the VM links (as sources) being saved into it. */
  readonly artifacts: ReadonlyArray<ChatArtifact>
  readonly savingArtifacts: ReadonlyArray<string>
  /** Messages waiting for the chat to finish its run (Dex's queue), next first; held after you stopped the chat. */
  readonly queue: ReadonlyArray<QueuedMessage>
  readonly queueHeld: boolean
  /** The chat has older entries than `entries` holds ("Show earlier messages" loads them). */
  readonly earlier: boolean
}

export const emptyTranscript: TranscriptState = {
  entries: [],
  streaming: null,
  tools: {},
  running: false,
  queued: 0,
  retry: null,
  error: null,
  loaded: false,
  artifacts: [],
  savingArtifacts: [],
  queue: [],
  queueHeld: false,
  earlier: false
}

const oldestId = (entries: ReadonlyArray<EntryRecord>) =>
  entries.reduce<number | undefined>((oldest, entry) => (oldest === undefined || entry.id < oldest ? entry.id : oldest), undefined)

/**
 * `earlier`: the agent has older entries than the snapshot's (dex.snapshot's flag). Older ones loaded before (Show
 * earlier messages) stay in front of a fresh snapshot.
 */
export const fromSnapshot = (snapshot: SnapshotEvent, previous: TranscriptState = emptyTranscript, earlier = previous.earlier): TranscriptState => {
  const oldest = oldestId(snapshot.entries)
  const kept = oldest === undefined ? [] : previous.entries.filter((entry) => entry.id < oldest)
  return {
    entries: kept.length ? [...kept, ...snapshot.entries] : snapshot.entries,
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
    error: null,
    loaded: true,
    // Sent right after the snapshot; keep what's known until then.
    artifacts: previous.artifacts,
    savingArtifacts: previous.savingArtifacts,
    queue: previous.queue,
    queueHeld: previous.queueHeld,
    earlier: kept.length ? previous.earlier : earlier
  }
}

/** Older entries (chatHistory's) in front of the ones shown. */
export const withEarlier = (state: TranscriptState, older: ReadonlyArray<EntryRecord>, more: boolean): TranscriptState => {
  const oldest = oldestId(state.entries)
  const fresh = older.filter((entry) => oldest === undefined || entry.id < oldest)
  return { ...state, entries: [...fresh, ...state.entries], earlier: more }
}

const appendEntry = (entries: ReadonlyArray<EntryRecord>, entry: EntryRecord) =>
  entries.some((existing) => existing.id === entry.id) ? entries : [...entries, entry]

/** Returns a shallow path-cloned copy of `target` with `delta` appended at `path`, creating objects on the way. */
const appendAtPath = (target: ToolCall["arguments"], path: ReadonlyArray<string | number>, delta: string): ToolCall["arguments"] => {
  if (path.length === 0) return target
  const root: Record<string | number, unknown> = { ...target }
  let node: Record<string | number, unknown> = root
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!
    const next = node[key]
    const copy = (Array.isArray(next) ? [...next] : isObject(next) ? { ...next } : {}) as Record<string | number, unknown>
    node[key] = copy
    node = copy
  }
  const last = path[path.length - 1]!
  const current = node[last]
  node[last] = (typeof current === "string" ? current : "") + delta
  return root as ToolCall["arguments"]
}

const applyMessageUpdate = (message: AssistantMessage, changes: Extract<AgentEvent, { type: "message_update" }>["changes"]) => {
  // Shallow-copy only the message shell and the blocks touched by this batch instead of deep-cloning the whole message on every token.
  let next: AssistantMessage = { ...message, content: [...message.content] }
  const owned = new Set<number>()
  const ownBlock = (index: number) => {
    if (owned.has(index)) return next.content[index]
    const block = next.content[index]
    if (!block) return undefined
    const copy = { ...block }
    next.content[index] = copy
    owned.add(index)
    return copy
  }
  for (const change of changes) {
    switch (change.type) {
      case "message":
        next = structuredClone(change.message)
        owned.clear()
        break
      case "text_start":
      case "thinking_start":
      case "toolcall_start":
      case "block":
        next.content[change.contentIndex] = structuredClone(change.block)
        owned.add(change.contentIndex)
        break
      case "text_delta": {
        const block = ownBlock(change.contentIndex)
        if (block?.type === "text") block.text += change.delta
        break
      }
      case "thinking_delta": {
        const block = ownBlock(change.contentIndex)
        if (block?.type === "thinking") block.thinking += change.delta
        break
      }
      case "toolcall_delta": {
        const block = ownBlock(change.contentIndex)
        if (block?.type === "toolCall") {
          block.arguments = appendAtPath(block.arguments, change.path, change.delta)
        }
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
      return fromSnapshot(event, state)
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
  | {
      readonly kind: "user"
      readonly id: string
      readonly text: string
      readonly images: number
      /** Files attached to it (names and types; their text isn't shown). Absent without any. */
      readonly files?: ReadonlyArray<AttachedFile>
      /** Its images: `data` inline when small, else `ref` to load it by (see transcriptImage). Absent without any. */
      readonly imageParts?: ReadonlyArray<{ readonly mimeType: string; readonly data: string; readonly ref?: string }>
    }
  /** One reply: the assistant messages between two user messages, the last one possibly still streaming. */
  | { readonly kind: "assistant"; readonly id: string; readonly messages: ReadonlyArray<AssistantMessage>; readonly streaming: boolean; readonly endedAt: number | null }
  /** A summary or reset: where the model's context starts again. `summary`: what the model was given instead. */
  | { readonly kind: "divider"; readonly id: string; readonly label: string; readonly summary?: string }

const userText = (message: UserMessage) => {
  if (typeof message.content === "string") {
    const { text, files } = splitAttachments(message.content)
    return { text, images: 0, ...(files.length > 0 && { files }) }
  }
  const { text, files } = splitAttachments(message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"))
  const imageParts = message.content.flatMap((part) =>
    part.type === "image" ? [{ mimeType: part.mimeType, data: part.data, ...((part as { ref?: string }).ref && { ref: (part as { ref?: string }).ref }) }] : []
  )
  return { text, images: imageParts.length, ...(files.length > 0 && { files }), ...(imageParts.length > 0 && { imageParts }) }
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

/** What a summary or reset gave the model: the summary without Pi's wrapper, or the handoff. */
const summaryText = (entry: EntryRecord) => {
  const text = (entry.model ?? []).flatMap((message) => (message.role === "user" ? [userText(message).text] : [])).join("\n\n")
  return (/<summary>\n?([\s\S]*?)\n?<\/summary>\s*$/.exec(text)?.[1] ?? text).trim()
}

/** Display items for recorded entries only; memoize on `entries` so streaming deltas don't rebuild the whole chat. */
export const recordedDisplayItems = (entries: ReadonlyArray<EntryRecord>): DisplayItem[] => {
  const items: DisplayItem[] = []
  // Consecutive assistant messages (tool results don't interrupt them) are one reply.
  let currentMessages: AssistantMessage[] | null = null
  const addAssistant = (id: string, message: AssistantMessage) => {
    const last = items.at(-1)
    const ended = message.timestamp + (message.durationMs ?? 0)
    if (last?.kind === "assistant" && currentMessages) {
      currentMessages.push(message)
      items[items.length - 1] = { ...last, messages: currentMessages, endedAt: ended }
    } else {
      currentMessages = [message]
      items.push({ kind: "assistant", id, messages: currentMessages, streaming: false, endedAt: ended })
    }
  }
  for (const entry of entries) {
    // A summary's text (and a reset's handoff) is a user message for the model, not something you said.
    if (entry.kind === "pi.reset" || entry.kind === "pi.compaction") {
      const summary = summaryText(entry)
      const label = entry.kind === "pi.reset" ? "Context reset" : "Earlier messages summarized"
      currentMessages = null
      items.push({ kind: "divider", id: String(entry.id), label, ...(summary && { summary }) })
      continue
    }
    for (const [index, message] of (entry.model ?? []).entries()) {
      const id = `${entry.id}:${index}`
      if (message.role === "user") {
        currentMessages = null
        items.push({ kind: "user", id, ...userText(message) })
      } else if (message.role === "assistant") {
        addAssistant(id, message)
      } else if (message.role === "toolResult") {
        const last = items.at(-1)
        if (last?.kind === "assistant") items[items.length - 1] = { ...last, endedAt: Math.max(last.endedAt ?? 0, message.timestamp) }
      }
    }
  }
  return items
}

/** Appends the live streaming message onto precomputed `recordedDisplayItems` without re-scanning older entries. */
export const displayItemsWithStreaming = (recorded: ReadonlyArray<DisplayItem>, streaming: AssistantMessage | null): DisplayItem[] => {
  if (!streaming) return recorded as DisplayItem[]
  const last = recorded.at(-1)
  if (last?.kind === "assistant") {
    return [...recorded.slice(0, -1), { ...last, messages: [...last.messages, streaming], streaming: true, endedAt: last.endedAt }]
  }
  return [...recorded, { kind: "assistant", id: "streaming", messages: [streaming], streaming: true, endedAt: null }]
}

export const displayItems = (state: TranscriptState): DisplayItem[] =>
  displayItemsWithStreaming(recordedDisplayItems(state.entries), state.streaming)

export const isToolCall = (block: AssistantMessage["content"][number]): block is ToolCall => block.type === "toolCall"
