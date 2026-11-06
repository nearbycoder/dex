// Writes the spaces goldens (core/model's SpacesTest compares against them) from the web's own apps/web/src/shared/spaces.ts.
// It needs nothing installed. Run from the repo root:  node apps/android/tools/goldens/spaces.mts
import { mkdirSync, writeFileSync } from "node:fs"
import { parseSpaceUpdates, spaceThreads, spaceUpdate, SPACE_UPDATE_SEPARATOR, threadStatus, THREAD_STATUS_LABELS, THREAD_STATUS_ORDER } from "../../../web/src/shared/spaces.ts"

const OUT = new URL("../../core/model/src/test/resources/golden/", import.meta.url)
mkdirSync(OUT, { recursive: true })
const write = (name: string, value: unknown) => writeFileSync(new URL(name, OUT), JSON.stringify(value, null, 1) + "\n")
const NOW = Date.UTC(2026, 9, 19, 22, 8, 30)

const finished = spaceUpdate({ id: "chat-a1", title: "Write the “release” notes" }, "finished", "  Done: notes are in docs/RELEASE.md.\n\n- 12 items  ")
const failedUpdate = spaceUpdate({ id: "chat-b2", title: "Fix CI" }, "failed", "")
const stopped = spaceUpdate({ id: "chat-c3", title: "Icons" }, "stopped", "Stopped by you.")
const session = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, createdAt: NOW, updatedAt: NOW, busy: false, muted: false, settledAt: null, snoozedUntil: null, ...extra })
const pending = [
  { id: "p1", sessionId: "t-confirm", status: "pending" },
  { id: "p2", sessionId: "t-old", status: "approved" },
  { id: "p3", sessionId: "t-busy-confirm", status: "pending" }
]
const statusSessions = [
  session("t-new"),
  session("t-busy", { busy: true }),
  session("t-failed", { failed: true, repliedAt: NOW }),
  session("t-done", { repliedAt: NOW }),
  session("t-confirm", { repliedAt: NOW }),
  session("t-old", { repliedAt: NOW }),
  session("t-busy-confirm", { busy: true }),
  session("t-busy-failed", { busy: true, failed: true })
]
const space = { id: "sp1", name: "Launch", goal: "", projectId: null, sessionId: "c-sp1", createdAt: NOW, updatedAt: NOW }
const spaceSessions = [
  session("c-sp1", { spaceId: "sp1", createdAt: NOW - 9 }),
  session("t1", { spaceId: "sp1", createdAt: NOW - 5 }),
  session("t2", { spaceId: "sp1", createdAt: NOW - 1 }),
  session("t3", { spaceId: "sp2", createdAt: NOW }),
  session("plain", { createdAt: NOW - 2 }),
  session("t4", { spaceId: "sp1", createdAt: NOW - 3 })
]
write("spaces.json", {
  labels: THREAD_STATUS_LABELS,
  order: THREAD_STATUS_ORDER,
  parse: [
    finished,
    failedUpdate,
    stopped,
    [finished, failedUpdate, stopped].join(SPACE_UPDATE_SEPARATOR),
    "Thread “x” (a) finished.",
    "[Space update] something else",
    "[Space update] Thread “Odd” (has space) finished.",
    `${failedUpdate}${SPACE_UPDATE_SEPARATOR}not an update`,
    "[Space update] Thread “Multi\nline” (chat-m) finished.\n\nbody\n\n---\n\nmore",
    "plain message"
  ].map((input) => ({ input, updates: parseSpaceUpdates(input) })),
  status: { pending, cases: statusSessions.map((s) => ({ session: s, status: threadStatus(s as never, pending as never) })) },
  threads: { space, sessions: spaceSessions, ids: spaceThreads(space, spaceSessions as never).map((s) => s.id) }
})

console.log("Spaces goldens written to", OUT.pathname)
