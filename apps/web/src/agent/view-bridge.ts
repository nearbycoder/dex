import type { AssistantMessage } from "@earendil-works/pi-ai"
import type { ConversationView, EntryRecord, InboxState, LiveState, ToolSlot } from "@earendil-works/pi-durable"
import type { AgentEvent, MessageChange, SnapshotEvent, SnapshotToolSlot, ToolOutputUpdate } from "../shared/protocol.ts"

const mapToolStatus = (status: ToolSlot["status"]): SnapshotToolSlot["status"] =>
  status === "pending" || status === "done" ? status : "running"

const toSnapshotTools = (tools: readonly ToolSlot[] | undefined): SnapshotToolSlot[] =>
  (tools ?? []).map((slot) => ({
    callId: slot.callId,
    name: slot.name,
    status: mapToolStatus(slot.status),
    ...(slot.output !== undefined && { output: slot.output }),
    ...(slot.details !== undefined && { details: slot.details })
  }))

/**
 * Converts a `pi-durable` ConversationView into Dex's backward-compatible `SnapshotEvent`
 * wire format consumed by web, iOS, and Android clients.
 */
export function viewToSnapshot(view: ConversationView): SnapshotEvent {
  const live = view.docs["pi.live"] as LiveState | undefined
  const inbox = (view.docs["pi.inbox"] as InboxState | undefined)?.items ?? []
  const generation = live?.generation
    ? {
        ...(live.generation.message !== undefined && { message: live.generation.message as AssistantMessage }),
        ...(live.generation.retry !== undefined && { retry: live.generation.retry })
      }
    : undefined
  return {
    type: "snapshot",
    entries: view.entries,
    ...(live?.run !== undefined && { run: live.run }),
    ...(generation && (generation.message !== undefined || generation.retry !== undefined) && { generation }),
    tools: toSnapshotTools(live?.tools),
    inbox
  }
}

const startChangeFor = (
  index: number,
  block: AssistantMessage["content"][number]
): MessageChange => {
  if (block.type === "text") return { type: "text_start", contentIndex: index, block }
  if (block.type === "thinking") return { type: "thinking_start", contentIndex: index, block }
  if (block.type === "toolCall") return { type: "toolcall_start", contentIndex: index, block }
  return { type: "block", contentIndex: index, block }
}

const sameJson = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

/** Computes minimal `MessageChange` deltas between two streamed assistant snapshots. */
function diffAssistantMessage(prev: AssistantMessage, next: AssistantMessage): MessageChange[] {
  if (prev === next) return []
  const prevContent = prev.content
  const nextContent = next.content
  if (nextContent.length < prevContent.length) {
    return [{ type: "message", message: next }]
  }
  const changes: MessageChange[] = []
  for (let i = 0; i < nextContent.length; i++) {
    const nextBlock = nextContent[i]!
    const prevBlock = prevContent[i]
    if (!prevBlock) {
      changes.push(startChangeFor(i, nextBlock))
      continue
    }
    if (prevBlock === nextBlock) continue
    if (prevBlock.type === "text" && nextBlock.type === "text") {
      if (nextBlock.text === prevBlock.text) continue
      if (nextBlock.text.startsWith(prevBlock.text)) {
        changes.push({ type: "text_delta", contentIndex: i, delta: nextBlock.text.slice(prevBlock.text.length) })
      } else {
        changes.push({ type: "block", contentIndex: i, block: nextBlock })
      }
      continue
    }
    if (prevBlock.type === "thinking" && nextBlock.type === "thinking") {
      if (nextBlock.thinking === prevBlock.thinking && prevBlock.thinkingSignature === nextBlock.thinkingSignature) continue
      if (nextBlock.thinking.startsWith(prevBlock.thinking) && prevBlock.thinkingSignature === nextBlock.thinkingSignature) {
        changes.push({ type: "thinking_delta", contentIndex: i, delta: nextBlock.thinking.slice(prevBlock.thinking.length) })
      } else {
        changes.push({ type: "block", contentIndex: i, block: nextBlock })
      }
      continue
    }
    if (!sameJson(prevBlock, nextBlock)) {
      changes.push({ type: "block", contentIndex: i, block: nextBlock })
    }
  }
  return changes
}

const diffToolOutput = (prevOutput: string | undefined, nextOutput: string | undefined): ToolOutputUpdate | undefined => {
  if (prevOutput === nextOutput) return undefined
  const prev = prevOutput ?? ""
  const next = nextOutput ?? ""
  if (next.startsWith(prev)) {
    const append = next.slice(prev.length)
    return append.length > 0 ? { trimStart: 0, append } : undefined
  }
  return { set: next }
}

/**
 * Diffs two consecutive `ConversationView` snapshots from `pi-durable`'s `Conversation.watch()`
 * into Dex's backward-compatible `AgentEvent[]` wire stream (preserving Web, iOS, and Android clients).
 */
export function diffConversationView(prev: ConversationView, next: ConversationView): AgentEvent[] {
  // Window splice/reset/overflow (entries shrunk or previous newest entry left the window): emit a fresh snapshot.
  const prevLast = prev.entries[prev.entries.length - 1]
  if (prevLast && !next.entries.some((entry) => entry.id === prevLast.id)) {
    return [viewToSnapshot(next)]
  }
  if (next.entries.length < prev.entries.length) {
    return [viewToSnapshot(next)]
  }

  const events: AgentEvent[] = []
  const prevLive = prev.docs["pi.live"] as LiveState | undefined
  const nextLive = next.docs["pi.live"] as LiveState | undefined
  const prevInbox = (prev.docs["pi.inbox"] as InboxState | undefined)?.items ?? []
  const nextInbox = (next.docs["pi.inbox"] as InboxState | undefined)?.items ?? []

  const lastPrevId = prevLast?.id
  const newEntries: EntryRecord[] =
    lastPrevId === undefined ? [...next.entries] : next.entries.filter((entry) => entry.id > lastPrevId)
  const newEntryById = new Map<EntryRecord["id"], EntryRecord>(newEntries.map((entry) => [entry.id, entry]))

  // 1. Run start
  if (prevLive?.run === undefined && nextLive?.run !== undefined) {
    events.push({ type: "run_start" })
  }

  // 2. Entries appended (distinguishing message_end and tool_execution_end entries)
  const nextTools = nextLive?.tools ?? []
  const prevTools = prevLive?.tools ?? []
  const prevToolById = new Map<string, ToolSlot>(prevTools.map((slot) => [slot.callId, slot]))
  const toolEndEntryIds = new Set<EntryRecord["id"]>()
  for (const slot of nextTools) {
    const prevSlot = prevToolById.get(slot.callId)
    if (slot.status === "done" && prevSlot?.status !== "done" && slot.entry !== undefined && newEntryById.has(slot.entry)) {
      toolEndEntryIds.add(slot.entry)
    }
  }

  let emittedMessageEnd = false
  const hadStreaming = prevLive?.generation?.message !== undefined
  for (const entry of newEntries) {
    if (toolEndEntryIds.has(entry.id)) continue
    const isAssistant = entry.kind === "pi.assistant" || (entry.model?.some((message) => message.role === "assistant") ?? false)
    if (hadStreaming && isAssistant && !emittedMessageEnd) {
      events.push({ type: "message_end", entry })
      emittedMessageEnd = true
    } else {
      events.push({ type: "entry_appended", entry })
    }
  }

  // 3. Auto-retry transitions
  const prevRetry = prevLive?.generation?.retry
  const nextRetry = nextLive?.generation?.retry
  if (nextRetry && (nextRetry.at !== prevRetry?.at || nextRetry.error !== prevRetry?.error)) {
    events.push({ type: "auto_retry_start", at: nextRetry.at, errorMessage: nextRetry.error })
  } else if (prevRetry && !nextRetry) {
    events.push({ type: "auto_retry_end" })
  }

  // 4. Streaming assistant message transitions
  const prevMsg = emittedMessageEnd ? undefined : (prevLive?.generation?.message as AssistantMessage | undefined)
  const nextMsg = nextLive?.generation?.message as AssistantMessage | undefined
  if (!prevMsg && nextMsg) {
    events.push({ type: "message_start", message: nextMsg })
  } else if (prevMsg && nextMsg) {
    const changes = diffAssistantMessage(prevMsg, nextMsg)
    if (changes.length > 0) {
      events.push({ type: "message_update", changes })
    }
  }

  // 5. Tool slots transitions
  for (const slot of nextTools) {
    const prevSlot = prevToolById.get(slot.callId)
    if (!prevSlot) {
      events.push({ type: "tool_execution_start", toolCallId: slot.callId, toolName: slot.name })
      if ((slot.output !== undefined && slot.output.length > 0) || slot.details !== undefined) {
        events.push({
          type: "tool_execution_update",
          toolCallId: slot.callId,
          toolName: slot.name,
          ...(slot.output !== undefined && slot.output.length > 0 && { output: { set: slot.output } }),
          ...(slot.details !== undefined && { details: slot.details })
        })
      }
      if (slot.status === "done") {
        const entry = slot.entry !== undefined ? newEntryById.get(slot.entry) : undefined
        events.push({
          type: "tool_execution_end",
          toolCallId: slot.callId,
          toolName: slot.name,
          ...(entry && { entry })
        })
      }
      continue
    }
    const outputDelta = diffToolOutput(prevSlot.output, slot.output)
    const detailsChanged = !sameJson(prevSlot.details, slot.details)
    if (outputDelta || detailsChanged) {
      events.push({
        type: "tool_execution_update",
        toolCallId: slot.callId,
        toolName: slot.name,
        ...(outputDelta && { output: outputDelta }),
        ...(detailsChanged && slot.details !== undefined && { details: slot.details })
      })
    }
    if (prevSlot.status !== "done" && slot.status === "done") {
      const entry = slot.entry !== undefined ? newEntryById.get(slot.entry) : undefined
      events.push({
        type: "tool_execution_end",
        toolCallId: slot.callId,
        toolName: slot.name,
        ...(entry && { entry })
      })
    }
  }

  // 6. Inbox updates
  if (prevInbox.length !== nextInbox.length) {
    events.push({ type: "inbox_update", items: nextInbox })
  }

  // 7. Run end & failure reporting
  if (prevLive?.run !== undefined && nextLive?.run === undefined) {
    events.push({ type: "run_end" })
  }
  const prevFailure = prevLive?.runFailure
  const nextFailure = nextLive?.runFailure
  if (
    nextFailure &&
    nextFailure.reason !== "aborted" &&
    nextFailure.reason !== "reset" &&
    (prevFailure?.taskId !== nextFailure.taskId || prevFailure?.reason !== nextFailure.reason || prevFailure?.detail !== nextFailure.detail)
  ) {
    events.push({ type: "task_failed", message: nextFailure.detail || nextFailure.reason })
  }

  return events
}
