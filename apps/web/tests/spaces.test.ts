import assert from "node:assert/strict"
import { test } from "node:test"
import type { SessionMeta } from "../src/shared/protocol.ts"
import { parseSpaceUpdates, SPACE_UPDATE_SEPARATOR, spaceThreads, spaceUpdate, threadStatus } from "../src/shared/spaces.ts"

const session = (patch: Partial<SessionMeta>): SessionMeta => ({
  id: "s1",
  title: "Thread",
  model: "m",
  thinking: "medium",
  createdAt: 1,
  updatedAt: 1,
  busy: false,
  agentId: null,
  mcpServers: [],
  projectId: null,
  characterId: null,
  muted: true,
  settledAt: null,
  snoozedUntil: null,
  ...patch
})

test("an update reads back as what it said", () => {
  const text = spaceUpdate({ id: "abc123", title: "Fix the “login” bug" }, "finished", "Fixed it.\n\nPR: #42")
  assert.deepEqual(parseSpaceUpdates(text), [{ threadId: "abc123", title: 'Fix the "login" bug', outcome: "finished", body: "Fixed it.\n\nPR: #42" }])
})

test("joined updates read back one by one, bodies optional", () => {
  const text = [spaceUpdate({ id: "a", title: "One" }, "failed", "Rate limited"), spaceUpdate({ id: "b", title: "Two" }, "stopped", "")].join(SPACE_UPDATE_SEPARATOR)
  const updates = parseSpaceUpdates(text)
  assert.equal(updates?.length, 2)
  assert.equal(updates?.[0]?.outcome, "failed")
  assert.equal(updates?.[1]?.body, "")
})

test("anything else isn't an update", () => {
  assert.equal(parseSpaceUpdates("Hello"), null)
  assert.deepEqual(parseSpaceUpdates("[Space update] something else"), [])
})

test("a thread's status: needs you, working, failed, done, new", () => {
  const pending = [{ id: "p", sessionId: "s1", operation: "x", summary: "", createdAt: 1, status: "pending" as const, result: null }]
  assert.equal(threadStatus(session({ busy: true }), pending), "needs_you")
  assert.equal(threadStatus(session({ busy: true })), "working")
  assert.equal(threadStatus(session({ failed: true, repliedAt: 2 })), "failed")
  assert.equal(threadStatus(session({ repliedAt: 2 })), "done")
  assert.equal(threadStatus(session({})), "new")
})

test("a space's threads leave out its coordinator and other spaces' chats", () => {
  const space = { id: "sp", name: "S", goal: "", projectId: null, sessionId: "coord", createdAt: 0, updatedAt: 0 }
  const sessions = [session({ id: "coord", spaceId: "sp" }), session({ id: "t1", spaceId: "sp", createdAt: 5 }), session({ id: "t2", spaceId: "sp", createdAt: 9 }), session({ id: "x", spaceId: "other" })]
  assert.deepEqual(spaceThreads(space, sessions).map((thread) => thread.id), ["t2", "t1"])
})
