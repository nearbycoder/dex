import type { AgentEvent, SnapshotEvent } from "@earendil-works/pi-durable"
import { Predicate } from "effect"
import type { ThinkingLevel } from "./models"

/** Durable Object binding / class name; the client addresses it as `DexAgent`. */
export const AGENT_CLASS = "DexAgent"

export interface SessionMeta {
  readonly id: string
  readonly title: string
  readonly model: string
  readonly thinking: ThinkingLevel
  readonly createdAt: number
  readonly updatedAt: number
  readonly busy: boolean
}

export interface ClineStatus {
  readonly connected: boolean
  /** `user`: a key this user connected. `server`: the deployment's shared CLINE_API_KEY. */
  readonly source: "user" | "server" | null
  readonly keyHint: string | null
  readonly verifiedAt: number | null
}

export interface DexSettings {
  readonly defaultModel: string
  readonly defaultThinking: ThinkingLevel
  /** Appended to the system prompt of every chat. */
  readonly instructions: string
}

/** Synced to every connected client through the Agents SDK state channel. Never put secrets here. */
export interface DexState {
  readonly cline: ClineStatus
  readonly settings: DexSettings
  readonly sessions: ReadonlyArray<SessionMeta>
}

export interface WorkspaceFile {
  readonly path: string
  readonly size: number
  readonly mtime: number
}

export interface ScheduledPrompt {
  readonly id: string
  readonly prompt: string
  readonly sessionId: string | null
  readonly when: string
  readonly cron: string | null
}

export type ConnectClineResult = { readonly ok: true; readonly note?: string } | { readonly ok: false; readonly error: string }

/** Messages the browser sends over the agent WebSocket, beside RPC calls. */
export type ClientMessage =
  | { readonly type: "dex.subscribe"; readonly sessionId: string }
  | { readonly type: "dex.unsubscribe" }
  /** Sent periodically: re-opens the event stream if the object was evicted since. */
  | { readonly type: "dex.ping"; readonly sessionId: string | null }

export type ServerMessage =
  | { readonly type: "dex.snapshot"; readonly sessionId: string; readonly snapshot: SnapshotEvent }
  | { readonly type: "dex.events"; readonly sessionId: string; readonly events: ReadonlyArray<AgentEvent> }
  | { readonly type: "dex.error"; readonly sessionId: string | null; readonly message: string }

export const isServerMessage = (value: unknown): value is ServerMessage =>
  Predicate.hasProperty(value, "type") && Predicate.isString(value.type) && value.type.startsWith("dex.")
