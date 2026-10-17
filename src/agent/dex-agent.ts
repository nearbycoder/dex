import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai/models"
import { type AgentEventStream, createRegistry, defineExtension, Harness, section } from "@earendil-works/pi-durable"
import { Agent, callable, type Connection, getCurrentAgent, type Schedule, type WSMessage } from "agents"
import { PiHarness } from "agents/harness/pi"
import { Effect, Layer, ManagedRuntime, Option, Redacted, Schema } from "effect"
import { AppConfig, envConfigProvider } from "~/server/config"
import { Keys } from "~/server/crypto"
import { clampThinking, DEFAULT_MODEL_ID, DEFAULT_THINKING, findModel, type ThinkingLevel } from "~/shared/models"
import type {
  ClientMessage,
  ConnectClineResult,
  DexSettings,
  DexState,
  ScheduledPrompt,
  ServerMessage,
  SessionMeta,
  VmActivity,
  VmInfo,
  VmSize,
  WorkspaceFile
} from "~/shared/protocol"
import { NO_VM } from "~/shared/protocol"
import { BoatClient } from "./boat"
import { CLINEPASS_PROVIDER_ID, ClinePassClient, clinePassProvider } from "./clinepass"
import { webTools } from "./tools/agents-tools"
import { loadUiGuideTool, renderUiTool } from "./tools/render-ui"
import { scheduleTools } from "./tools/schedule-tools"
import { vmTools } from "./tools/vm-tools"
import { workspaceTools } from "./tools/workspace-tools"
import { VmManager } from "./vm"
import { Workspace, WORKSPACE_ROOT } from "./workspace"

const AgentLayer = (env: object) =>
  Layer.mergeAll(Keys.layer, ClinePassClient.layer, BoatClient.layer).pipe(
    Layer.provideMerge(AppConfig.layer),
    Layer.provide(envConfigProvider(env))
  )

const ClientMessageJson = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ type: Schema.Literal("dex.subscribe"), sessionId: Schema.String }),
    Schema.Struct({ type: Schema.Literal("dex.unsubscribe") }),
    Schema.Struct({ type: Schema.Literal("dex.ping"), sessionId: Schema.NullOr(Schema.String) })
  ])
)
const decodeClientMessage = Schema.decodeUnknownOption(ClientMessageJson)

const PREAMBLE = `You are Dex, a capable personal agent. You run durably on Cloudflare: your chats, files, and schedules persist across restarts.

You can:
- Use your own cloud VM, a full Ubuntu machine with a desktop (vm_exec, vm_screenshot, vm_read_file, vm_write_file, vm_expose_port, vm_stop). Use it for real work: cloning repos, installing packages, running code, tests, servers, Docker, and driving a browser. The user can watch it live and take over.
- Keep notes and small files in ${WORKSPACE_ROOT} with a lightweight simulated shell (bash, read_file, write_file, edit_file). It cannot install or run programs; use the VM for that.
- Research the web (web_search, web_fetch, and curl inside bash).
- Show rich interactive UI with render_ui. Call load_ui_guide once per chat before your first render_ui.
- Schedule prompts for yourself to run later or on a cron (schedule_prompt).

Work autonomously: break tasks into steps, use tools, check your results, and report back concisely in Markdown. Prefer render_ui for data, comparisons, dashboards, plans, and collecting input. ${WORKSPACE_ROOT}/MEMORY.md is your long-term memory across chats: when the user asks you to remember something, or you learn a durable preference, update it.`

const MEMORY_FILE = `${WORKSPACE_ROOT}/MEMORY.md`
const MAX_MEMORY_CHARS = 8_000
const SCHEDULE_CALLBACK = "runScheduledPrompt"
const VM_SIZES = new Set<VmSize>(["small", "default", "large"])

const DEFAULT_SETTINGS: DexSettings = {
  defaultModel: DEFAULT_MODEL_ID,
  defaultThinking: DEFAULT_THINKING,
  instructions: "",
  vmSize: "small",
  vmMinutes: 5
}

interface SessionRow {
  id: string
  title: string
  model: string
  thinking: string
  created_at: number
  updated_at: number
  [key: string]: SqlStorageValue
}

interface ScheduledPayload {
  prompt: string
  sessionId: string | null
}

const keyHint = (key: string) => (key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "••••")

/**
 * One per user. Hosts Pi Durable through PiHarness: each chat is a Pi
 * session in this object's SQLite, model calls go to ClinePass, and runs
 * resume on their own after an eviction or deploy.
 */
export class DexAgent extends Agent<Env, DexState> {
  initialState: DexState = {
    cline: { connected: false, source: null, keyHint: null, verifiedAt: null },
    settings: DEFAULT_SETTINGS,
    sessions: [],
    vm: NO_VM
  }

  readonly runtime = ManagedRuntime.make(AgentLayer(this.env))
  readonly workspace = new Workspace(this.ctx.storage.sql)
  readonly registry = createRegistry()

  readonly vm = new VmManager({
    sql: this.ctx.storage.sql,
    configured: Boolean((this.env as unknown as Record<string, unknown>).BOAT_API_KEY),
    run: (effect, signal) => this.runtime.runPromise(effect, { signal }),
    settings: () => ({ size: this.state.settings.vmSize, minutes: this.state.settings.vmMinutes }),
    publish: (vm: VmInfo) => this.publish({ vm }),
    broadcast: (message: ServerMessage) => this.broadcast(JSON.stringify(message)),
    scheduleIdleCheck: () => void this.scheduleVmIdleCheck()
  })

  readonly harness = new PiHarness({
    harness: ({ storage, context }) => {
      this.registry.install(this.coreExtension())
      const models = createModels()
      models.setProvider(clinePassProvider(() => this.resolveClineKey()))
      return Harness.open(
        storage,
        {
          models,
          registry: this.registry,
          settings: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 1_000 } }
        },
        context
      )
    },
    defaults: { model: { provider: CLINEPASS_PROVIDER_ID, id: DEFAULT_MODEL_ID }, thinkingLevel: DEFAULT_THINKING }
  })

  /** Live event streams, by WebSocket connection id. They live in memory; clients re-subscribe after an eviction. */
  private readonly subscriptions = new Map<string, { sessionId: string; stream: AgentEventStream }>()
  private readonly subscribing = new Map<string, Promise<void>>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS dex_sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, model TEXT NOT NULL, thinking TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS dex_secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS dex_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    this.lifecycle.use(this.harness)
  }

  override async onStart() {
    // Settings saved before a field existed get its default.
    const settings = { ...DEFAULT_SETTINGS, ...this.state.settings }
    // One-time: agents created when the idle default was 30 minutes move to 5.
    if (!this.ctx.storage.sql.exec(`SELECT 1 FROM dex_meta WHERE key = 'vm_idle_default_5'`).toArray().length) {
      if (settings.vmMinutes === 30) settings.vmMinutes = 5
      this.ctx.storage.sql.exec(`INSERT INTO dex_meta (key, value) VALUES ('vm_idle_default_5', '1')`)
    }
    this.publish({ settings, vm: this.vm.current })
    await this.refreshClineStatus()
    await this.refreshSessions()
    void this.vm.refresh()
  }

  // ── Pi wiring ─────────────────────────────────────────────────────────────

  private coreExtension() {
    return defineExtension({
      name: "dex",
      sections: [
        section("preamble", () => PREAMBLE, { tag: false }),
        section("environment", () => `Today is ${new Date().toISOString().slice(0, 10)} (UTC).`),
        section("memory", () => {
          const memory = this.workspace.readText(MEMORY_FILE)
          if (!memory?.trim()) return undefined
          return memory.length > MAX_MEMORY_CHARS ? `${memory.slice(0, MAX_MEMORY_CHARS)}\n… (truncated; read the file for the rest)` : memory
        }),
        section("user_instructions", () => this.state.settings.instructions.trim() || undefined)
      ],
      tools: [
        ...workspaceTools(this.workspace),
        ...webTools(this.env.AI),
        loadUiGuideTool,
        renderUiTool,
        ...scheduleTools(this),
        ...(this.vm.current.configured ? vmTools(this.vm) : [])
      ]
    })
  }

  private async resolveClineKey(): Promise<{ key: string; source: string } | undefined> {
    const stored = this.secret("cline_api_key")
    if (stored) {
      const key = await this.runtime.runPromise(Keys.use((keys) => keys.decrypt(stored)).pipe(Effect.option))
      if (Option.isSome(key)) return { key: key.value, source: "ClinePass (connected)" }
    }
    const shared = await this.runtime.runPromise(AppConfig.use((config) => Effect.succeed(config.clineApiKey)))
    return Option.isSome(shared) ? { key: Redacted.value(shared.value), source: "CLINE_API_KEY" } : undefined
  }

  private secret(name: string): string | undefined {
    return this.ctx.storage.sql.exec<{ value: string }>(`SELECT value FROM dex_secrets WHERE name = ?`, name).toArray()[0]?.value
  }

  private publish(patch: Partial<DexState>) {
    this.setState({ ...this.state, ...patch })
  }

  private async refreshClineStatus() {
    const hint = this.secret("cline_key_hint")
    if (this.secret("cline_api_key")) {
      const verifiedAt = Number(this.secret("cline_verified_at") ?? 0) || null
      this.publish({ cline: { connected: true, source: "user", keyHint: hint ?? null, verifiedAt } })
      return
    }
    const shared = await this.runtime.runPromise(AppConfig.use((config) => Effect.succeed(Option.isSome(config.clineApiKey))))
    this.publish({ cline: { connected: shared, source: shared ? "server" : null, keyHint: null, verifiedAt: null } })
  }

  private async refreshSessions() {
    const busy = new Map((await this.harness.sessions.list()).map((info) => [info.id, info.busy]))
    const sessions: SessionMeta[] = this.ctx.storage.sql
      .exec<SessionRow>(`SELECT * FROM dex_sessions ORDER BY updated_at DESC`)
      .toArray()
      .map((row) => ({
        id: row.id,
        title: row.title,
        model: row.model,
        thinking: row.thinking as ThinkingLevel,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        busy: busy.get(row.id) ?? false
      }))
    this.publish({ sessions })
  }

  private hasSession(id: string) {
    return this.ctx.storage.sql.exec(`SELECT 1 FROM dex_sessions WHERE id = ?`, id).toArray().length > 0
  }

  private async configureConversation(sessionId: string, model: string, thinking: ThinkingLevel) {
    const conversation = await this.harness.conversation(sessionId)
    await conversation.configure(
      { model: { provider: CLINEPASS_PROVIDER_ID, modelId: model }, thinkingLevel: thinking },
      BACKGROUND_CONTEXT
    )
  }

  // ── ClinePass connection ──────────────────────────────────────────────────

  @callable()
  async connectCline(apiKey: string): Promise<ConnectClineResult> {
    const key = apiKey.trim()
    if (!key) return { ok: false, error: "Paste your Cline API key." }
    const result = await this.runtime.runPromise(
      Effect.gen(function*() {
        const { note } = yield* (yield* ClinePassClient).verifyKey(key)
        const sealed = yield* (yield* Keys).encrypt(key)
        return { ok: true as const, sealed, note }
      }).pipe(Effect.catchTag("ClinePassError", (error) => Effect.succeed({ ok: false as const, error: error.message })))
    )
    if (!result.ok) return result
    const upsert = `INSERT INTO dex_secrets (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value`
    this.ctx.storage.sql.exec(upsert, "cline_api_key", result.sealed)
    this.ctx.storage.sql.exec(upsert, "cline_key_hint", keyHint(key))
    this.ctx.storage.sql.exec(upsert, "cline_verified_at", String(Date.now()))
    await this.refreshClineStatus()
    return result.note ? { ok: true, note: result.note } : { ok: true }
  }

  @callable()
  async disconnectCline() {
    this.ctx.storage.sql.exec(`DELETE FROM dex_secrets WHERE name IN ('cline_api_key', 'cline_key_hint', 'cline_verified_at')`)
    await this.refreshClineStatus()
  }

  @callable()
  async updateSettings(patch: Partial<DexSettings>) {
    const settings = { ...this.state.settings, ...patch }
    if (!findModel(settings.defaultModel)) settings.defaultModel = DEFAULT_MODEL_ID
    if (!VM_SIZES.has(settings.vmSize)) settings.vmSize = DEFAULT_SETTINGS.vmSize
    settings.vmMinutes = Math.min(24 * 60, Math.max(1, Math.round(Number(settings.vmMinutes) || DEFAULT_SETTINGS.vmMinutes)))
    settings.defaultThinking = clampThinking(findModel(settings.defaultModel), settings.defaultThinking)
    this.publish({ settings })
  }

  // ── Chats ─────────────────────────────────────────────────────────────────

  @callable()
  async createSession(options: { model?: string; thinking?: ThinkingLevel; title?: string } = {}): Promise<SessionMeta> {
    const model = options.model && findModel(options.model) ? options.model : this.state.settings.defaultModel
    const thinking = clampThinking(findModel(model), options.thinking ?? this.state.settings.defaultThinking)
    const session = await this.harness.sessions.create()
    await this.configureConversation(session.id, model, thinking)
    const now = Date.now()
    const title = options.title?.trim() || "New chat"
    this.ctx.storage.sql.exec(
      `INSERT INTO dex_sessions (id, title, model, thinking, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      session.id, title, model, thinking, now, now
    )
    await this.refreshSessions()
    return { id: session.id, title, model, thinking, createdAt: now, updatedAt: now, busy: false }
  }

  @callable()
  async sendMessage(sessionId: string, text: string) {
    const content = text.trim()
    if (!content) return
    const row = this.ctx.storage.sql.exec<SessionRow>(`SELECT * FROM dex_sessions WHERE id = ?`, sessionId).toArray()[0]
    if (!row) throw new Error("Chat not found")

    const { connection } = getCurrentAgent()
    if (connection) await this.subscribe(connection, sessionId)

    const session = this.harness.session(sessionId)
    const receipt = await session.submit(content)
    const title = row.title === "New chat" ? content.replace(/\s+/g, " ").slice(0, 60) : row.title
    this.ctx.storage.sql.exec(`UPDATE dex_sessions SET title = ?, updated_at = ? WHERE id = ?`, title, Date.now(), sessionId)
    await this.refreshSessions()
    // Clears the busy flag even when nobody is watching this chat.
    const finished = () => {
      this.ctx.storage.sql.exec(`UPDATE dex_sessions SET updated_at = ? WHERE id = ?`, Date.now(), sessionId)
      return this.refreshSessions()
    }
    this.ctx.waitUntil(session.wait(receipt.operationId).then(finished, finished))
  }

  @callable()
  async abort(sessionId: string) {
    await this.harness.session(sessionId).abort()
    await this.refreshSessions()
  }

  @callable()
  async configureSession(sessionId: string, options: { model?: string; thinking?: ThinkingLevel }) {
    const row = this.ctx.storage.sql.exec<SessionRow>(`SELECT * FROM dex_sessions WHERE id = ?`, sessionId).toArray()[0]
    if (!row) throw new Error("Chat not found")
    const model = options.model && findModel(options.model) ? options.model : row.model
    const thinking = clampThinking(findModel(model), options.thinking ?? (row.thinking as ThinkingLevel))
    await this.configureConversation(sessionId, model, thinking)
    this.ctx.storage.sql.exec(`UPDATE dex_sessions SET model = ?, thinking = ? WHERE id = ?`, model, thinking, sessionId)
    await this.refreshSessions()
  }

  @callable()
  async renameSession(sessionId: string, title: string) {
    this.ctx.storage.sql.exec(`UPDATE dex_sessions SET title = ? WHERE id = ?`, title.trim() || "Untitled", sessionId)
    await this.refreshSessions()
  }

  /** Hides a chat. Pi Durable cannot delete a conversation yet, so its transcript stays in storage. */
  @callable()
  async deleteSession(sessionId: string) {
    await this.harness.session(sessionId).abort().catch(() => false)
    this.ctx.storage.sql.exec(`DELETE FROM dex_sessions WHERE id = ?`, sessionId)
    await this.refreshSessions()
  }

  // ── Live transcript streaming ─────────────────────────────────────────────

  override async onMessage(connection: Connection, message: WSMessage) {
    if (typeof message !== "string") return
    const decoded = decodeClientMessage(message)
    if (Option.isNone(decoded)) return
    const msg: ClientMessage = decoded.value
    switch (msg.type) {
      case "dex.subscribe":
        return this.subscribe(connection, msg.sessionId, { force: true })
      case "dex.ping":
        return msg.sessionId ? this.subscribe(connection, msg.sessionId) : this.unsubscribe(connection.id)
      case "dex.unsubscribe":
        return this.unsubscribe(connection.id)
    }
  }

  override async onClose(connection: Connection) {
    await this.unsubscribe(connection.id)
  }

  private send(connection: Connection, message: ServerMessage) {
    try {
      connection.send(JSON.stringify(message))
      return true
    } catch {
      return false
    }
  }

  /** Streams one chat's Pi events to one connection: a snapshot, then a batch per commit. */
  private subscribe(connection: Connection, sessionId: string, { force = false } = {}): Promise<void> {
    const previous = this.subscribing.get(connection.id) ?? Promise.resolve()
    const next = previous.then(async () => {
      if (!force && this.subscriptions.get(connection.id)?.sessionId === sessionId) return
      await this.unsubscribe(connection.id)
      if (!this.hasSession(sessionId)) {
        this.send(connection, { type: "dex.error", sessionId, message: "Chat not found" })
        return
      }
      const stream = await this.harness.session(sessionId).events()
      this.subscriptions.set(connection.id, { sessionId, stream })
      this.send(connection, { type: "dex.snapshot", sessionId, snapshot: stream.snapshot })
      stream.start(async (events) => {
        if (!this.send(connection, { type: "dex.events", sessionId, events })) {
          await this.unsubscribe(connection.id)
          return
        }
        if (events.some((event) => event.type === "run_start" || event.type === "run_end")) await this.refreshSessions()
      })
      void stream.closed.then(() => {
        if (this.subscriptions.get(connection.id)?.stream === stream) this.subscriptions.delete(connection.id)
      })
    })
    const settled = next.catch((error: unknown) => {
      this.send(connection, { type: "dex.error", sessionId, message: error instanceof Error ? error.message : String(error) })
    })
    this.subscribing.set(connection.id, settled)
    return settled
  }

  private async unsubscribe(connectionId: string) {
    const current = this.subscriptions.get(connectionId)
    if (!current) return
    this.subscriptions.delete(connectionId)
    await current.stream.stop().catch(() => undefined)
  }

  // ── Workspace ─────────────────────────────────────────────────────────────

  @callable()
  async listFiles(): Promise<WorkspaceFile[]> {
    return this.workspace.list()
  }

  @callable()
  async readFile(path: string): Promise<{ path: string; content: string | null; size: number }> {
    const bytes = this.workspace.read(path)
    if (!bytes) throw new Error(`No such file: ${path}`)
    try {
      return { path, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes), size: bytes.length }
    } catch {
      return { path, content: null, size: bytes.length }
    }
  }

  /** Runs a command in the workspace shell, for the terminal on the Workspace page. */
  @callable()
  async runCommand(command: string) {
    return this.workspace.bash(command)
  }

  @callable()
  async writeFile(path: string, content: string) {
    this.workspace.write(path, content)
  }

  @callable()
  async deleteFile(path: string) {
    return this.workspace.remove(path)
  }

  // ── VM (Machine page) ─────────────────────────────────────────────────────

  @callable()
  async vmRefresh(): Promise<VmInfo> {
    return this.vm.refresh()
  }

  @callable()
  async vmStart(): Promise<VmInfo> {
    await this.vm.ensureRunning()
    return this.vm.current
  }

  @callable()
  async vmStop(): Promise<VmInfo> {
    await this.vm.stop("user")
    return this.vm.current
  }

  @callable()
  async vmDestroy(): Promise<VmInfo> {
    await this.vm.destroy()
    return this.vm.current
  }

  /** Heartbeat from the Machine page while the user has control of the desktop. */
  @callable()
  async vmTouch() {
    this.vm.touch()
  }

  private async scheduleVmIdleCheck() {
    if (this.getSchedules().some((schedule) => schedule.callback === "vmIdleCheck")) return
    await this.schedule(60, "vmIdleCheck")
  }

  async vmIdleCheck() {
    if (await this.vm.idleCheck()) await this.schedule(60, "vmIdleCheck")
  }

  @callable()
  async vmActivity(limit = 100): Promise<VmActivity[]> {
    return this.vm.recentActivity(Math.min(300, Math.max(1, limit)))
  }

  /** A command the user runs from the Machine page terminal; output streams to every watcher. */
  @callable()
  async vmRun(command: string) {
    const result = await this.vm.exec(command, { actor: "user", timeoutSeconds: 600 })
    return { exitCode: result.exitCode }
  }

  @callable()
  async vmDesktopUrl(mode: "stream" | "vnc"): Promise<string | null> {
    return this.vm.desktopUrl(mode === "vnc" ? "vnc" : "stream")
  }

  @callable()
  async vmExposePort(port: number, isPublic: boolean): Promise<string> {
    return this.vm.exposePort(port, isPublic, "user")
  }

  // ── Scheduled prompts ─────────────────────────────────────────────────────

  async schedulePrompt(input: { prompt: string; when: Date | number | string; sessionId: string | null }) {
    const schedule = await this.schedule<ScheduledPayload>(input.when, SCHEDULE_CALLBACK, {
      prompt: input.prompt,
      sessionId: input.sessionId
    })
    return toScheduledPrompt(schedule)
  }

  @callable()
  async listScheduledPrompts(): Promise<ScheduledPrompt[]> {
    return this.getSchedules<ScheduledPayload>()
      .filter((schedule) => schedule.callback === SCHEDULE_CALLBACK)
      .map(toScheduledPrompt)
  }

  @callable()
  async cancelScheduledPrompt(id: string) {
    return this.cancelSchedule(id)
  }

  async runScheduledPrompt(payload: ScheduledPayload) {
    const sessionId =
      payload.sessionId && this.hasSession(payload.sessionId)
        ? payload.sessionId
        : (await this.createSession({ title: `⏰ ${payload.prompt.slice(0, 50)}` })).id
    await this.harness.session(sessionId).submit(`[Scheduled task] ${payload.prompt}`)
    this.ctx.storage.sql.exec(`UPDATE dex_sessions SET updated_at = ? WHERE id = ?`, Date.now(), sessionId)
    await this.refreshSessions()
  }
}

const toScheduledPrompt = (schedule: Schedule<ScheduledPayload>): ScheduledPrompt => ({
  id: schedule.id,
  prompt: schedule.payload.prompt,
  sessionId: schedule.payload.sessionId,
  when: new Date(schedule.time * 1000).toISOString(),
  cron: schedule.type === "cron" ? schedule.cron : null
})
