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
  readonly vmSize: VmSize
  /** The VM stops (keeping its disk) after this many minutes with no commands running and no one in control. */
  readonly vmMinutes: number
}

export type VmSize = "small" | "default" | "large"

export const VM_SIZES: ReadonlyArray<{ readonly id: VmSize; readonly label: string }> = [
  { id: "small", label: "Small · 2 vCPU · 4 GB" },
  { id: "default", label: "Default · 4 vCPU · 8 GB" },
  { id: "large", label: "Large · 8 vCPU · 16 GB" }
]

export type VmStatus = "none" | "starting" | "running" | "stopping" | "stopped" | "error"

export interface VmInfo {
  /** Whether this deployment has a boat.dev key. */
  readonly configured: boolean
  readonly id: string | null
  readonly status: VmStatus
  readonly size: string | null
  readonly archiveAfter: string | null
  readonly error: string | null
  /** Last time a command, file action, or user control touched the VM. */
  readonly lastActiveAt: number | null
  /** Something is running on the VM right now, so it will not idle-stop. */
  readonly busy: boolean
}

/** One thing done on the VM, by the agent or the user, shown live on the Machine page. */
export interface VmActivity {
  readonly id: number
  readonly at: number
  readonly actor: "agent" | "user" | "system"
  readonly kind: "exec" | "spawn" | "file" | "port" | "screenshot" | "lifecycle"
  readonly title: string
  readonly status: "running" | "done" | "error"
  readonly exitCode: number | null
  readonly output: string
}

export const NO_VM: VmInfo = { configured: false, id: null, status: "none", size: null, archiveAfter: null, error: null, lastActiveAt: null, busy: false }

/** Fills fields an agent saved before they existed, so older state never breaks the UI. */
export const withStateDefaults = (state: DexState): DexState => ({
  ...state,
  vm: { ...NO_VM, ...state.vm },
  settings: { ...state.settings, vmSize: state.settings.vmSize ?? "small", vmMinutes: state.settings.vmMinutes ?? 5 }
})

/** Synced to every connected client through the Agents SDK state channel. Never put secrets here. */
export interface DexState {
  readonly cline: ClineStatus
  readonly settings: DexSettings
  readonly sessions: ReadonlyArray<SessionMeta>
  readonly vm: VmInfo
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
  | { readonly type: "dex.vm.activity"; readonly sessionId: null; readonly activity: VmActivity }
  | { readonly type: "dex.vm.output"; readonly sessionId: null; readonly id: number; readonly data: string }

export const isServerMessage = (value: unknown): value is ServerMessage =>
  Predicate.hasProperty(value, "type") && Predicate.isString(value.type) && value.type.startsWith("dex.")
