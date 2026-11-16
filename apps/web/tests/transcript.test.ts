import assert from "node:assert/strict"
import { test } from "node:test"
import type { EntryRecord, SnapshotEvent } from "@earendil-works/pi-durable"
import { displayItems, emptyTranscript, fromSnapshot, withEarlier } from "../src/client/lib/transcript.ts"

const user = (id: number, text: string) => ({ id, kind: "pi.user", model: [{ role: "user", content: [{ type: "text", text }], timestamp: id }] }) as unknown as EntryRecord
const compaction = (id: number, head: number, summary: string) =>
  ({
    id,
    kind: "pi.compaction",
    head,
    model: [{ role: "user", content: [{ type: "text", text: `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${summary}\n</summary>` }], timestamp: id }]
  }) as unknown as EntryRecord
const snapshot = (entries: EntryRecord[]) => ({ type: "snapshot", entries, tools: [], inbox: [] }) as unknown as SnapshotEvent

test("a summary is a divider with its text, not a message from you", () => {
  const state = fromSnapshot(snapshot([user(1, "Hi"), compaction(5, 3, "## Goal\nShip it"), user(3, "Kept"), user(6, "Next")]))
  assert.deepEqual(
    displayItems(state).map((item) => (item.kind === "user" ? `user:${item.text}` : item.kind === "divider" ? `divider:${item.label}:${item.summary}` : item.kind)),
    ["user:Hi", "divider:Earlier messages summarized:## Goal\nShip it", "user:Kept", "user:Next"]
  )
})

test("older messages stay in front of a fresh snapshot, and load in front of the oldest", () => {
  const first = fromSnapshot(snapshot([user(4, "Four"), user(5, "Five")]), emptyTranscript, true)
  assert.equal(first.earlier, true)
  const loaded = withEarlier(first, [user(2, "Two"), user(3, "Three"), user(4, "Dup")], false)
  assert.deepEqual(loaded.entries.map((entry) => entry.id), [2, 3, 4, 5])
  assert.equal(loaded.earlier, false)
  // A stream that fell behind gets a new snapshot: what was loaded stays.
  const again = fromSnapshot(snapshot([user(4, "Four"), user(5, "Five"), user(6, "Six")]), loaded)
  assert.deepEqual(again.entries.map((entry) => entry.id), [2, 3, 4, 5, 6])
  assert.equal(again.earlier, false)
})
