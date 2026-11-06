import type { PendingAction } from "./access"
import type { SessionMeta } from "./protocol"

/**
 * A space: one conversation with a coordinator whose job is to start and direct other chats (its threads) for you, in
 * the spirit of Amp's Spaces. You tell the coordinator what you want; it splits the work into threads that run in
 * parallel in the space's project, hears back when each one finishes, and follows up. Its chat is an ordinary chat
 * (`sessionId`) with extra tools; its threads are ordinary chats with `SessionMeta.spaceId` set.
 */
export interface SpaceProfile {
  readonly id: string
  readonly name: string
  /** What the work is for; the coordinator keeps the threads pointed at it. May be empty. */
  readonly goal: string
  /** The project the threads work in (each gets its own VM with the repos), if any. */
  readonly projectId: string | null
  /** The coordinator's chat. */
  readonly sessionId: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface SpaceDraft {
  readonly id?: string
  readonly name: string
  readonly goal?: string
  readonly projectId?: string | null
}

export const MAX_SPACE_NAME = 60
export const MAX_SPACE_GOAL = 2_000

/** The coordinator's notes: a running summary, decisions, and a ledger of the work, kept in the workspace. */
export const spaceNotesPath = (id: string) => `/workspace/spaces/${id}/NOTES.md`

export const MAX_SPACE_NOTES_CHARS = 8_000

/** The tool the coordinator starts a thread with; its result's `details.thread` is `{ id, title }`. */
export const START_THREAD_TOOL = "space_start_thread"

/** Where a thread is, for its card and the space's thread list. */
export type ThreadStatus = "working" | "needs_you" | "failed" | "done" | "new"

export const THREAD_STATUS_LABELS: Record<ThreadStatus, string> = {
  working: "Working",
  needs_you: "Needs you",
  failed: "Failed",
  done: "Done",
  new: "Not started"
}

/** Status order in the thread list: what needs attention first. */
export const THREAD_STATUS_ORDER: ReadonlyArray<ThreadStatus> = ["needs_you", "working", "failed", "done", "new"]

/**
 * A thread's status: working while it runs; needs you while it waits on your confirmation; failed when its last reply
 * hit a problem; done once it has replied; new before that.
 */
export const threadStatus = (session: SessionMeta, pending: ReadonlyArray<PendingAction> = []): ThreadStatus => {
  if (pending.some((action) => action.sessionId === session.id && action.status === "pending")) return "needs_you"
  if (session.busy) return "working"
  if (session.failed) return "failed"
  return session.repliedAt ? "done" : "new"
}

/** A space's threads: its chats other than the coordinator's, newest first. */
export const spaceThreads = (space: SpaceProfile, sessions: ReadonlyArray<SessionMeta>) =>
  sessions.filter((session) => session.spaceId === space.id && session.id !== space.sessionId).sort((a, b) => b.createdAt - a.createdAt)

/**
 * What the coordinator is told when a thread's run ends, as a message in its chat. The apps show these as small
 * event rows (a thread finished) rather than as something you said. Several that arrive while the coordinator is busy
 * are joined into one message with `SPACE_UPDATE_SEPARATOR`.
 */
export const SPACE_UPDATE_PREFIX = "[Space update] "
export const SPACE_UPDATE_SEPARATOR = "\n\n---\n\n"

export type SpaceUpdateOutcome = "finished" | "failed" | "stopped"

export const spaceUpdate = (thread: { id: string; title: string }, outcome: SpaceUpdateOutcome, body: string) =>
  `${SPACE_UPDATE_PREFIX}Thread “${thread.title.replace(/[“”]/g, '"')}” (${thread.id}) ${outcome}.${body.trim() ? `\n\n${body.trim()}` : ""}`

export interface ParsedSpaceUpdate {
  readonly threadId: string
  readonly title: string
  readonly outcome: SpaceUpdateOutcome
  readonly body: string
}

/** The thread updates in a coordinator message, or null if it isn't one. */
export const parseSpaceUpdates = (text: string): ParsedSpaceUpdate[] | null => {
  if (!text.startsWith(SPACE_UPDATE_PREFIX)) return null
  return text.split(SPACE_UPDATE_SEPARATOR).flatMap((part) => {
    const match = /^\[Space update\] Thread “(.*?)” \(([^)\s]+)\) (finished|failed|stopped)\.(?:\n\n([\s\S]*))?$/.exec(part.trim())
    return match ? [{ title: match[1]!, threadId: match[2]!, outcome: match[3] as SpaceUpdateOutcome, body: match[4] ?? "" }] : []
  })
}
