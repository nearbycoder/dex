import assert from "node:assert/strict"
import test from "node:test"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import type { ConversationView, EntryRecord, LiveState } from "@earendil-works/pi-durable"
import { diffConversationView, viewToSnapshot } from "../src/agent/view-bridge.ts"
import { applyEvent, fromSnapshot } from "../src/client/lib/transcript.ts"

const makeAssistant = (content: AssistantMessage["content"]): AssistantMessage =>
  ({
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 1
  }) as AssistantMessage

const makeView = (entries: EntryRecord[], live?: LiveState, inboxItems: unknown[] = []): ConversationView =>
  ({
    conversation: { id: 1 as never, createdAt: 0 } as never,
    entries,
    docs: {
      ...(live !== undefined ? { "pi.live": live as never } : {}),
      "pi.inbox": { items: inboxItems } as never
    }
  }) as ConversationView

const makeEntry = (id: number, kind: string, model: EntryRecord["model"]): EntryRecord =>
  ({ id: id as never, seq: id as never, kind, data: {}, model, createdAt: id * 1000 }) as unknown as EntryRecord

test("viewToSnapshot and diffConversationView round-trip streaming text, tools, retries, and run end", () => {
  const userEntry = makeEntry(1, "pi.user", [{ role: "user", content: "hi", timestamp: 1 } as never])
  const v0 = makeView([])
  let state = fromSnapshot(viewToSnapshot(v0))
  assert.equal(state.running, false)
  assert.equal(state.entries.length, 0)

  // Run starts with user entry and initial streamed assistant text
  const v1 = makeView(
    [userEntry],
    {
      run: { taskId: 1 as never, inputs: [], turns: 0 },
      generation: { attempt: 1, message: makeAssistant([{ type: "text", text: "Hel" }]) as never }
    },
    [{ id: "q1" }]
  )
  const e1 = diffConversationView(v0, v1)
  assert.deepEqual(
    e1.map((e) => e.type),
    ["run_start", "entry_appended", "message_start", "inbox_update"]
  )
  for (const ev of e1) state = applyEvent(state, ev)
  assert.equal(state.running, true)
  assert.equal(state.queued, 1)
  assert.equal(state.entries.length, 1)
  assert.equal((state.streaming?.content[0] as { text: string }).text, "Hel")

  // Incremental text delta + retry
  const v2 = makeView(
    [userEntry],
    {
      run: { taskId: 1 as never, inputs: [], turns: 0 },
      generation: {
        attempt: 1,
        message: makeAssistant([{ type: "text", text: "Hello world" }]) as never,
        retry: { at: 5000, error: "429" }
      }
    },
    [{ id: "q1" }]
  )
  const e2 = diffConversationView(v1, v2)
  assert.deepEqual(
    e2.map((e) => e.type),
    ["auto_retry_start", "message_update"]
  )
  assert.deepEqual((e2[1] as { changes: unknown[] }).changes, [{ type: "text_delta", contentIndex: 0, delta: "lo world" }])
  for (const ev of e2) state = applyEvent(state, ev)
  assert.equal((state.streaming?.content[0] as { text: string }).text, "Hello world")
  assert.deepEqual(state.retry, { at: 5000, error: "429" })

  // Assistant message completes and a tool starts running
  const assistantEntry = makeEntry(2, "pi.assistant", [makeAssistant([{ type: "text", text: "Hello world" }])])
  const v3 = makeView([userEntry, assistantEntry], {
    run: { taskId: 1 as never, inputs: [], turns: 1 },
    tools: [{ callId: "c1", name: "bash", status: "running", output: "line1\n" }]
  })
  const e3 = diffConversationView(v2, v3)
  assert.ok(e3.some((e) => e.type === "message_end"))
  assert.ok(e3.some((e) => e.type === "tool_execution_start"))
  assert.ok(e3.some((e) => e.type === "tool_execution_update"))
  for (const ev of e3) state = applyEvent(state, ev)
  assert.equal(state.streaming, null)
  assert.equal(state.tools["c1"]?.output, "line1\n")

  // Tool appends output then finishes and run ends
  const toolResult = makeEntry(3, "pi.toolResult", [
    { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "line1\nline2\n" }], isError: false, timestamp: 3 } as never
  ])
  const v4 = makeView([userEntry, assistantEntry, toolResult], {
    run: { taskId: 1 as never, inputs: [], turns: 1 },
    tools: [{ callId: "c1", name: "bash", status: "done", output: "line1\nline2\n", entry: 3 as never }]
  })
  const e4 = diffConversationView(v3, v4)
  for (const ev of e4) state = applyEvent(state, ev)
  assert.equal(state.tools["c1"]?.status, "done")
  assert.equal(state.tools["c1"]?.output, "line1\nline2\n")
  assert.equal(state.entries.length, 3)

  const v5 = makeView([userEntry, assistantEntry, toolResult], {
    runFailure: { taskId: 1 as never, inputs: [], reason: "model_error", detail: "upstream 502" }
  })
  const e5 = diffConversationView(v4, v5)
  assert.deepEqual(
    e5.map((e) => e.type),
    ["run_end", "task_failed"]
  )
  for (const ev of e5) state = applyEvent(state, ev)
  assert.equal(state.running, false)
  assert.equal(state.error, "upstream 502")
})

test("diffConversationView emits a snapshot when the window splices or resets", () => {
  const v1 = makeView([makeEntry(1, "pi.user", []), makeEntry(2, "pi.assistant", [])])
  const v2 = makeView([makeEntry(5, "pi.assistant", [])])
  const events = diffConversationView(v1, v2)
  assert.equal(events.length, 1)
  assert.equal(events[0]?.type, "snapshot")
})
