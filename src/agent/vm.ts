import type { Effect } from "effect"
import type { ServerMessage, VmActivity, VmInfo, VmSize } from "~/shared/protocol"
import { BoatClient, BoatError, type CommandResult, type Sandbox } from "./boat"

const READY = new Set(["ready", "idle", "running"])
const BOOTING = new Set(["init", "provisioning", "provisioned", "cloning"])
const MAX_ACTIVITY_OUTPUT = 16_000
const MAX_ACTIVITY_ROWS = 300
const BOOT_TIMEOUT_MS = 4 * 60_000
/** boat's own auto-stop deadline sits this far past the idle timeout: a fallback in case the agent is down. */
const SAFETY_SECONDS = 15 * 60

export interface VmHost {
  readonly sql: SqlStorage
  /** Runs a BoatClient program; aborting `signal` interrupts it. */
  run<A>(effect: Effect.Effect<A, BoatError, BoatClient>, signal?: AbortSignal): Promise<A>
  readonly configured: boolean
  settings(): { size: VmSize; minutes: number }
  publish(info: VmInfo): void
  broadcast(message: ServerMessage): void
  /** Ensures `idleCheck()` runs within a minute or so. */
  scheduleIdleCheck(): void
}

interface ActivityRow {
  id: number
  at: number
  actor: string
  kind: string
  title: string
  status: string
  exit_code: number | null
  output: string
  [key: string]: SqlStorageValue
}

const toActivity = (row: ActivityRow): VmActivity => ({
  id: row.id,
  at: row.at,
  actor: row.actor as VmActivity["actor"],
  kind: row.kind as VmActivity["kind"],
  title: row.title,
  status: row.status as VmActivity["status"],
  exitCode: row.exit_code,
  output: row.output
})

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })

const tail = (text: string, max = MAX_ACTIVITY_OUTPUT) => (text.length > max ? `…${text.slice(-max)}` : text)

const errorText = (error: unknown) => (error instanceof BoatError ? `${error.message} (${error.code})` : error instanceof Error ? error.message : String(error))

/**
 * This user's boat.dev VM. One per agent: created on first use, resumed from
 * its disk snapshot when stopped, and kept alive while it is being used.
 * Everything done on it is logged as activity and broadcast to the UI.
 */
export class VmManager {
  private info: VmInfo
  private starting: Promise<Sandbox> | null = null
  private lastExtend = 0
  /** Operations running on the VM; it never idle-stops while this is above zero. */
  private inFlight = 0

  constructor(private readonly host: VmHost) {
    host.sql.exec(`CREATE TABLE IF NOT EXISTS dex_vm (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    host.sql.exec(`CREATE TABLE IF NOT EXISTS dex_vm_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL,
      title TEXT NOT NULL, status TEXT NOT NULL, exit_code INTEGER, output TEXT NOT NULL DEFAULT '')`)
    const id = this.sandboxId()
    this.info = {
      configured: host.configured,
      id,
      status: id ? "stopped" : "none",
      size: null,
      archiveAfter: null,
      error: null,
      lastActiveAt: this.lastActive(),
      busy: false
    }
  }

  private lastActive(): number | null {
    const value = this.host.sql.exec<{ value: string }>(`SELECT value FROM dex_vm WHERE key = 'last_active'`).toArray()[0]?.value
    return value ? Number(value) : null
  }

  /** Marks the VM as in use now, which restarts its idle countdown. */
  touch() {
    const now = Date.now()
    this.host.sql.exec(`INSERT INTO dex_vm (key, value) VALUES ('last_active', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, String(now))
    this.update({ lastActiveAt: now })
    if (this.info.status === "running") {
      this.host.scheduleIdleCheck()
      void this.extendSafetyDeadline()
    }
  }

  /** Runs `work` as activity: the VM counts as busy until it settles. */
  private async track<A>(work: () => Promise<A>): Promise<A> {
    this.inFlight++
    this.update({ busy: true })
    this.touch()
    try {
      return await work()
    } finally {
      this.inFlight--
      this.update({ busy: this.inFlight > 0 })
      this.touch()
    }
  }

  /**
   * Called about once a minute while the VM runs. Stops it once nothing has
   * used it for the idle timeout; returns whether to check again.
   */
  async idleCheck(): Promise<boolean> {
    if (!this.sandboxId() || this.info.status !== "running") return false
    if (this.inFlight > 0) {
      await this.extendSafetyDeadline()
      return true
    }
    const minutes = this.host.settings().minutes
    const idleFor = Date.now() - (this.lastActive() ?? 0)
    if (idleFor < minutes * 60_000) return true
    await this.stop("system", `Stop VM after ${minutes} idle minute${minutes === 1 ? "" : "s"} (disk is kept)`).catch(() => undefined)
    return this.info.status === "running"
  }

  get current(): VmInfo {
    return this.info
  }

  private sandboxId(): string | null {
    return this.host.sql.exec<{ value: string }>(`SELECT value FROM dex_vm WHERE key = 'sandbox_id'`).toArray()[0]?.value ?? null
  }

  private setSandboxId(id: string | null) {
    if (id) this.host.sql.exec(`INSERT INTO dex_vm (key, value) VALUES ('sandbox_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, id)
    else this.host.sql.exec(`DELETE FROM dex_vm WHERE key = 'sandbox_id'`)
  }

  private update(patch: Partial<VmInfo>) {
    this.info = { ...this.info, ...patch, configured: this.host.configured }
    this.host.publish(this.info)
  }

  private fromSandbox(sandbox: Sandbox) {
    const status = READY.has(sandbox.state)
      ? "running"
      : BOOTING.has(sandbox.state)
        ? "starting"
        : sandbox.state === "archiving"
          ? "stopping"
          : sandbox.state === "archived"
            ? "stopped"
            : "error"
    this.update({
      id: sandbox.id,
      status,
      size: sandbox.type ?? this.info.size,
      archiveAfter: sandbox.archiveAfter ?? null,
      error: status === "error" ? `VM is ${sandbox.state}` : null
    })
  }

  // ── Activity log ──────────────────────────────────────────────────────────

  recentActivity(limit = 100): VmActivity[] {
    return this.host.sql
      .exec<ActivityRow>(`SELECT * FROM dex_vm_activity ORDER BY id DESC LIMIT ?`, limit)
      .toArray()
      .reverse()
      .map(toActivity)
  }

  private startActivity(actor: VmActivity["actor"], kind: VmActivity["kind"], title: string): VmActivity {
    const row = this.host.sql
      .exec<ActivityRow>(
        `INSERT INTO dex_vm_activity (at, actor, kind, title, status) VALUES (?, ?, ?, ?, 'running') RETURNING *`,
        Date.now(), actor, kind, title.slice(0, 2_000)
      )
      .one()
    this.host.sql.exec(`DELETE FROM dex_vm_activity WHERE id <= ?`, row.id - MAX_ACTIVITY_ROWS)
    const activity = toActivity(row)
    this.host.broadcast({ type: "dex.vm.activity", sessionId: null, activity })
    return activity
  }

  private finishActivity(id: number, status: "done" | "error", output: string, exitCode: number | null = null) {
    const row = this.host.sql
      .exec<ActivityRow>(`UPDATE dex_vm_activity SET status = ?, output = ?, exit_code = ? WHERE id = ? RETURNING *`, status, tail(output), exitCode, id)
      .toArray()[0]
    if (row) this.host.broadcast({ type: "dex.vm.activity", sessionId: null, activity: toActivity(row) })
  }

  private async logged<A>(
    actor: VmActivity["actor"],
    kind: VmActivity["kind"],
    title: string,
    work: () => Promise<A>,
    summarize: (result: A) => string = () => ""
  ): Promise<A> {
    const activity = this.startActivity(actor, kind, title)
    try {
      const result = await work()
      this.finishActivity(activity.id, "done", summarize(result))
      return result
    } catch (error) {
      this.finishActivity(activity.id, "error", errorText(error))
      throw error
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Re-reads the VM's state from boat.dev. */
  async refresh(): Promise<VmInfo> {
    const id = this.sandboxId()
    if (!id || !this.host.configured) {
      this.update({ id: null, status: "none", size: null, archiveAfter: null, error: null })
      return this.info
    }
    try {
      this.fromSandbox(await this.host.run(BoatClient.use((boat) => boat.get(id))))
      if (this.info.status === "running") this.host.scheduleIdleCheck()
    } catch (error) {
      if (error instanceof BoatError && error.status === 404) {
        this.setSandboxId(null)
        this.update({ id: null, status: "none", size: null, archiveAfter: null, error: null })
      } else {
        this.update({ error: errorText(error) })
      }
    }
    return this.info
  }

  /** The running VM: created, resumed, or waited on as needed. Concurrent callers share one start. */
  ensureRunning(onProgress?: (message: string) => void, signal?: AbortSignal): Promise<Sandbox> {
    if (!this.host.configured) return Promise.reject(new Error("No VM is configured: set BOAT_API_KEY for this deployment."))
    this.starting ??= this.start(onProgress, signal)
      .then((sandbox) => {
        this.touch()
        return sandbox
      })
      .finally(() => {
        this.starting = null
      })
    return this.starting
  }

  private async start(onProgress?: (message: string) => void, signal?: AbortSignal): Promise<Sandbox> {
    const boat = (effect: (client: BoatClient["Service"]) => Effect.Effect<Sandbox, BoatError>) =>
      this.host.run(BoatClient.use(effect), signal)
    const { size, minutes } = this.host.settings()
    const ttlSeconds = minutes * 60 + SAFETY_SECONDS

    const create = async () => {
      onProgress?.(`Creating a ${size} VM…\n`)
      const startedAt = Date.now()
      const sandbox = await this.logged("system", "lifecycle", `Create ${size} VM`, async () => {
        this.update({ status: "starting", error: null })
        const created = await boat((client) => client.create({ type: size, ttlSeconds, idempotencyKey: crypto.randomUUID() }))
        this.setSandboxId(created.id)
        this.fromSandbox(created)
        return this.waitUntilReady(created.id, onProgress, signal)
      }, () => `Ready in ${Math.round((Date.now() - startedAt) / 1000)}s`)
      return sandbox
    }

    const id = this.sandboxId()
    if (!id) return create()

    let sandbox: Sandbox
    try {
      sandbox = await boat((client) => client.get(id))
    } catch (error) {
      if (error instanceof BoatError && error.status === 404) {
        this.setSandboxId(null)
        return create()
      }
      throw error
    }
    this.fromSandbox(sandbox)

    if (READY.has(sandbox.state)) return sandbox
    if (BOOTING.has(sandbox.state)) return this.waitUntilReady(id, onProgress, signal)
    if (sandbox.state === "archiving") sandbox = await this.waitFor(id, (s) => s.state === "archived", "stop", signal)
    if (sandbox.state === "archived") {
      const startedAt = Date.now()
      try {
        return await this.logged("system", "lifecycle", "Resume VM", async () => {
          onProgress?.("Resuming the VM from its saved disk…\n")
          this.update({ status: "starting", error: null })
          await boat((client) => client.resume(id, ttlSeconds))
          return this.waitUntilReady(id, onProgress, signal)
        }, () => `Ready in ${Math.round((Date.now() - startedAt) / 1000)}s`)
      } catch (error) {
        if (error instanceof BoatError && error.code === "snapshot_data_expired") {
          this.setSandboxId(null)
          return create()
        }
        throw error
      }
    }
    // error / cancelled: start over with a fresh VM.
    this.setSandboxId(null)
    await this.host.run(BoatClient.use((client) => client.remove(id))).catch(() => undefined)
    return create()
  }

  private async waitFor(id: string, done: (sandbox: Sandbox) => boolean, what: string, signal?: AbortSignal): Promise<Sandbox> {
    const deadline = Date.now() + BOOT_TIMEOUT_MS
    while (Date.now() < deadline) {
      const sandbox = await this.host.run(BoatClient.use((client) => client.get(id)), signal)
      this.fromSandbox(sandbox)
      if (done(sandbox)) return sandbox
      if (sandbox.state === "error" || sandbox.state === "cancelled") throw new Error(`The VM failed to ${what} (${sandbox.state}).`)
      await sleep(2_000, signal)
    }
    throw new Error(`Timed out waiting for the VM to ${what}.`)
  }

  private async waitUntilReady(id: string, onProgress?: (message: string) => void, signal?: AbortSignal) {
    const sandbox = await this.waitFor(id, (s) => READY.has(s.state), "start", signal)
    onProgress?.("VM is ready.\n")
    return sandbox
  }

  /** Keeps boat's own deadline well ahead of the idle timeout, so only `idleCheck` stops a VM that is in use. */
  private async extendSafetyDeadline() {
    const id = this.sandboxId()
    if (!id || Date.now() - this.lastExtend < 60_000) return
    const remaining = this.info.archiveAfter ? Date.parse(this.info.archiveAfter) - Date.now() : 0
    if (remaining > SAFETY_SECONDS * 1000) return
    this.lastExtend = Date.now()
    const ttlSeconds = this.host.settings().minutes * 60 + SAFETY_SECONDS
    const extended = await this.host.run(BoatClient.use((client) => client.extend(id, ttlSeconds))).catch(() => undefined)
    if (extended) this.fromSandbox(extended)
  }

  async stop(actor: VmActivity["actor"] = "user", title = "Stop VM (disk is kept)") {
    const id = this.sandboxId()
    if (!id) return
    await this.logged(actor, "lifecycle", title, async () => {
      this.update({ status: "stopping" })
      await this.host.run(BoatClient.use((client) => client.stop(id)))
      await this.waitFor(id, (s) => s.state === "archived", "stop")
    })
  }

  async destroy() {
    const id = this.sandboxId()
    if (!id) return
    await this.logged("user", "lifecycle", "Delete VM and its disk", async () => {
      await this.host.run(BoatClient.use((client) => client.remove(id))).catch((error) => {
        if (!(error instanceof BoatError && error.status === 404)) throw error
      })
      this.setSandboxId(null)
      this.update({ id: null, status: "none", size: null, archiveAfter: null, error: null })
    })
  }

  // ── Work ──────────────────────────────────────────────────────────────────

  /** Runs a shell command on the VM, streaming output to `onOutput` and to every watching client. */
  private async execUntracked(
    command: string,
    options: { actor: VmActivity["actor"]; cwd?: string; timeoutSeconds?: number; signal?: AbortSignal; onOutput?: (data: string) => void }
  ): Promise<CommandResult & { output: string }> {
    const progress = (message: string) => options.onOutput?.(message)
    const sandbox = await this.ensureRunning(progress, options.signal)
    const activity = this.startActivity(options.actor, "exec", command)
    let output = ""
    const run = (id: string) =>
      this.host.run(
        BoatClient.use((client) =>
          client.exec(id, command, {
            cwd: options.cwd,
            timeoutSeconds: options.timeoutSeconds,
            onOutput: (_stream, data) => {
              output += data
              if (output.length > MAX_ACTIVITY_OUTPUT * 4) output = output.slice(-MAX_ACTIVITY_OUTPUT * 2)
              options.onOutput?.(data)
              this.host.broadcast({ type: "dex.vm.output", sessionId: null, id: activity.id, data })
            }
          })
        ),
        options.signal
      )
    try {
      let result: CommandResult
      try {
        result = await run(sandbox.id)
      } catch (error) {
        // Stopped or still booting between our check and the command: start it and try once more.
        if (!(error instanceof BoatError && ["machine_not_running", "sandbox_starting", "boat_starting"].includes(error.code))) throw error
        result = await run((await this.ensureRunning(progress, options.signal)).id)
      }
      const exitCode = result.exitCode ?? -1
      const notes = [result.timedOut && "[timed out]", result.oomKilled && "[killed: out of memory]"].filter(Boolean).join(" ")
      this.finishActivity(activity.id, exitCode === 0 ? "done" : "error", notes ? `${output}\n${notes}` : output, exitCode)
      return { ...result, output: notes ? `${output}\n${notes}` : output }
    } catch (error) {
      this.finishActivity(activity.id, "error", `${output}\n${options.signal?.aborted ? "[stopped]" : errorText(error)}`)
      throw error
    }
  }

  private async spawnUntracked(command: string, options: { actor: VmActivity["actor"]; cwd?: string; signal?: AbortSignal; onOutput?: (data: string) => void }) {
    const sandbox = await this.ensureRunning(options.onOutput, options.signal)
    return this.logged(
      options.actor,
      "spawn",
      `${command} &`,
      () => this.host.run(BoatClient.use((client) => client.spawn(sandbox.id, command, options.cwd)), options.signal),
      (started) => `Running as process ${started.processId}\nlogs: ${started.logPath}\nerrors: ${started.errLogPath}`
    )
  }

  private async readFileUntracked(path: string, actor: VmActivity["actor"], encoding: "utf8" | "base64" = "utf8", signal?: AbortSignal) {
    const sandbox = await this.ensureRunning(undefined, signal)
    return this.logged(
      actor,
      "file",
      `read ${path}`,
      () => this.host.run(BoatClient.use((client) => client.readFile(sandbox.id, path, encoding)), signal),
      (file) => `${file.size} bytes`
    )
  }

  private async writeFileUntracked(path: string, content: string, actor: VmActivity["actor"], signal?: AbortSignal) {
    const sandbox = await this.ensureRunning(undefined, signal)
    await this.logged(
      actor,
      "file",
      `write ${path}`,
      () => this.host.run(BoatClient.use((client) => client.writeFile(sandbox.id, path, content)), signal),
      () => `${content.length} characters`
    )
  }

  private async exposePortUntracked(port: number, isPublic: boolean, actor: VmActivity["actor"], signal?: AbortSignal) {
    const sandbox = await this.ensureRunning(undefined, signal)
    return this.logged(
      actor,
      "port",
      `expose port ${port}${isPublic ? " (public)" : ""}`,
      () => this.host.run(BoatClient.use((client) => client.hostPort(sandbox.id, port, isPublic)), signal),
      (url) => url.replace(/_token=[^&]+/, "_token=…")
    )
  }

  /** A JPEG of the VM's desktop scaled to fit 1280px, with the real screen size for mapping clicks. */
  private async screenshotUntracked(actor: VmActivity["actor"], signal?: AbortSignal) {
    const sandbox = await this.ensureRunning(undefined, signal)
    return this.logged(actor, "screenshot", "screenshot", async () => {
      const shot = await this.host.run(
        BoatClient.use((client) =>
          client.exec(
            sandbox.id,
            "export DISPLAY=:0 && xdotool getdisplaygeometry && scrot -o /tmp/dex-shot.png && convert /tmp/dex-shot.png -resize '1280x1280>' -quality 70 /tmp/dex-shot.jpg",
            { timeoutSeconds: 30 }
          )
        ),
        signal
      )
      if (shot.exitCode !== 0) throw new Error(`Screenshot failed: ${shot.stderr ?? ""}`)
      const [width = 1920, height = 1080] = (shot.stdout ?? "").trim().split(/\s+/).map(Number)
      const file = await this.host.run(BoatClient.use((client) => client.readFile(sandbox.id, "/tmp/dex-shot.jpg", "base64")), signal)
      const scale = Math.min(1, 1280 / Math.max(width, height))
      return { data: file.content, width, height, scale }
    }, (shot) => `${shot.width}×${shot.height}`)
  }

  exec(...args: Parameters<VmManager["execUntracked"]>) {
    return this.track(() => this.execUntracked(...args))
  }

  spawn(...args: Parameters<VmManager["spawnUntracked"]>) {
    return this.track(() => this.spawnUntracked(...args))
  }

  readFile(...args: Parameters<VmManager["readFileUntracked"]>) {
    return this.track(() => this.readFileUntracked(...args))
  }

  writeFile(...args: Parameters<VmManager["writeFileUntracked"]>) {
    return this.track(() => this.writeFileUntracked(...args))
  }

  exposePort(...args: Parameters<VmManager["exposePortUntracked"]>) {
    return this.track(() => this.exposePortUntracked(...args))
  }

  screenshot(...args: Parameters<VmManager["screenshotUntracked"]>) {
    return this.track(() => this.screenshotUntracked(...args))
  }

  /** A desktop URL for the Machine page, or null while the VM or its desktop is not up yet. */
  async desktopUrl(mode: "stream" | "vnc"): Promise<string | null> {
    const id = this.sandboxId()
    if (!id || this.info.status !== "running") return null
    for (let attempt = 0; attempt < 10; attempt++) {
      const url = await this.host.run(BoatClient.use((client) => client.desktop(id, mode)))
      // Scale the picture to the viewer instead of resizing the VM's screen, which would move
      // everything under the agent's feet (its screenshots and click coordinates).
      if (url) return mode === "vnc" ? url.replace("resize=remote", "resize=scale") : url
      await sleep(2_000)
    }
    return null
  }
}
