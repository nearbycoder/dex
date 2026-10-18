import type { AgentEvent, SnapshotEvent } from "@earendil-works/pi-durable"
import { Predicate } from "effect"
import { type AccessState, NO_ACCESS } from "./access"
import type { AgentProfile } from "./agents"
import type { McpServerInfo } from "./mcp"
import type { ChatArtifact } from "./media"
import type { SkillInfo } from "./skills"
import type { PushStatus } from "./notifications"
import type { ProjectProfile } from "./projects"
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
  /** The custom agent this chat was started with, if any. */
  readonly agentId: string | null
  /** MCP servers whose tools this chat can use. */
  readonly mcpServers: ReadonlyArray<string>
  /** The project this chat works on, if any: its repos are cloned on the chat's VM. */
  readonly projectId: string | null
  /** No push notifications for this chat. */
  readonly muted: boolean
  /** When you settled it (done for now): it sits under Settled until something new happens in it. */
  readonly settledAt: number | null
  /** Hidden under Snoozed until then; it comes back (with a notification) at that time. */
  readonly snoozedUntil: number | null
}

export interface GitHubStatus {
  readonly connected: boolean
  readonly login: string | null
  /** How it was connected: "Connect with GitHub" (OAuth) or a pasted token. */
  readonly via?: "oauth" | "token" | null
  /** This deployment has a GitHub OAuth app, so "Connect with GitHub" is offered. */
  readonly oauthAvailable?: boolean
  /** GitHub stopped accepting the saved token (revoked, expired, or the app's access removed): reconnect it. */
  readonly expired?: boolean
}

export interface BoatStatus {
  readonly connected: boolean
  /** `user`: a key this user connected. `server`: the deployment's BOAT_API_KEY, which only its owner uses. */
  readonly source: "user" | "server" | null
  readonly keyHint: string | null
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

/** Preparing a new VM: GitHub sign-in, then the project's repos and setup script. */
export interface VmSetup {
  readonly status: "none" | "running" | "done" | "error"
  /** What it is doing now, or the step that failed. */
  readonly step: string | null
  readonly error: string | null
}

export const NO_SETUP: VmSetup = { status: "none", step: null, error: null }

/** The VM key of the one VM that existed before VMs were per chat. */
export const SHARED_VM = "shared"

/** The VM key of the VM that runs local (stdio) MCP servers for every chat. */
export const MCP_VM = "mcp-host"

export interface VmInfo {
  /** The chat this VM belongs to, or `shared` for the VM from before VMs were per chat. */
  readonly key: string
  /** boat.dev sandbox id. */
  readonly id: string | null
  readonly status: VmStatus
  readonly size: string | null
  readonly archiveAfter: string | null
  readonly error: string | null
  /** Last time a command, file action, or user control touched the VM. */
  readonly lastActiveAt: number | null
  /** Something is running on the VM right now, so it will not idle-stop. */
  readonly busy: boolean
  readonly setup: VmSetup
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

export const noVm = (key: string): VmInfo => ({
  key,
  id: null,
  status: "none",
  size: null,
  archiveAfter: null,
  error: null,
  lastActiveAt: null,
  busy: false,
  setup: NO_SETUP
})

/** Fills fields an agent saved before they existed, so older state never breaks the UI. */
export const withStateDefaults = (state: DexState): DexState => ({
  ...state,
  vms: (state.vms ?? []).map((vm) => ({ ...noVm(vm.key), ...vm })),
  vmConfigured: state.vmConfigured ?? false,
  boat: state.boat ?? { connected: false, source: null, keyHint: null },
  projects: state.projects ?? [],
  github: state.github ?? { connected: false, login: null },
  push: state.push ?? { configured: false, publicKey: null, devices: [] },
  agents: (state.agents ?? []).map((agent) => ({ ...agent, mcpServers: agent.mcpServers ?? [] })),
  mcp: state.mcp ?? [],
  access: state.access ?? NO_ACCESS,
  skills: state.skills ?? [],
  secrets: state.secrets ?? [],
  sessions: state.sessions.map((session) => ({
    ...session,
    agentId: session.agentId ?? null,
    mcpServers: session.mcpServers ?? [],
    projectId: session.projectId ?? null,
    muted: session.muted ?? false,
    settledAt: session.settledAt ?? null,
    snoozedUntil: session.snoozedUntil ?? null
  })),
  settings: { ...state.settings, vmSize: state.settings.vmSize ?? "small", vmMinutes: state.settings.vmMinutes ?? 5 }
})

/** Synced to every connected client through the Agents SDK state channel. Never put secrets here. */
export interface DexState {
  readonly cline: ClineStatus
  /** Whose boat.dev account this user's VMs run on. */
  readonly boat: BoatStatus
  readonly settings: DexSettings
  readonly sessions: ReadonlyArray<SessionMeta>
  /** VMs that exist (running or stopped with a saved disk), one per chat that has used one. */
  readonly vms: ReadonlyArray<VmInfo>
  /** Whether this deployment has a boat.dev key. */
  readonly vmConfigured: boolean
  readonly projects: ReadonlyArray<ProjectProfile>
  readonly github: GitHubStatus
  readonly push: PushStatus
  readonly agents: ReadonlyArray<AgentProfile>
  readonly mcp: ReadonlyArray<McpServerInfo>
  /** MCP access tokens, the audit log of app operations, and admin operations waiting for confirmation. */
  readonly access: AccessState
  /** Saved secrets (Settings → Secrets): names and notes only, never values. */
  readonly secrets: ReadonlyArray<{ readonly name: string; readonly note: string; readonly updatedAt: number }>
  /** Installed skills (without their instructions). */
  readonly skills: ReadonlyArray<SkillInfo>
  /** The build the agent is running (ISO time it was built): tells a deploy apart from a stale instance. */
  readonly build?: string
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
  /** Whether Dex is visible on this connection, and which chat it shows; notifications skip what you're looking at. */
  | { readonly type: "dex.presence"; readonly visible: boolean; readonly sessionId: string | null }

/** A message waiting for its chat to finish the current run. */
export interface QueuedMessage {
  readonly id: string
  readonly text: string
  readonly createdAt: number
}

export type ServerMessage =
  | { readonly type: "dex.snapshot"; readonly sessionId: string; readonly snapshot: SnapshotEvent }
  | { readonly type: "dex.events"; readonly sessionId: string; readonly events: ReadonlyArray<AgentEvent> }
  | { readonly type: "dex.error"; readonly sessionId: string | null; readonly message: string }
  /** Messages waiting their turn in the chat; `held` after you stopped it (nothing goes until you send or pick one). */
  | { readonly type: "dex.queue"; readonly sessionId: string; readonly items: ReadonlyArray<QueuedMessage>; readonly held: boolean }
  /** The chat's stored files, and the VM links being saved into it right now. */
  | { readonly type: "dex.artifacts"; readonly sessionId: string; readonly artifacts: ReadonlyArray<ChatArtifact>; readonly saving: ReadonlyArray<string> }
  | { readonly type: "dex.vm.activity"; readonly sessionId: null; readonly vmKey: string; readonly activity: VmActivity }
  | { readonly type: "dex.vm.output"; readonly sessionId: null; readonly vmKey: string; readonly id: number; readonly data: string }

export const isServerMessage = (value: unknown): value is ServerMessage =>
  Predicate.hasProperty(value, "type") && Predicate.isString(value.type) && value.type.startsWith("dex.")
