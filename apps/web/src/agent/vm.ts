import type { Effect } from "effect"
import { NO_SETUP, SHARED_VM, type ServerMessage, type VmActivity, type VmInfo, type VmSetup, type VmSize } from "~/shared/protocol"
import { BoatClient, BoatError, type CommandResult, type Sandbox } from "./boat"
import { SELKIES_PORT, SELKIES_SETUP } from "./selkies"

const READY = new Set(["ready", "idle", "running"])
const BOOTING = new Set(["init", "provisioning", "provisioned", "cloning"])
const MAX_ACTIVITY_OUTPUT = 16_000
const MAX_ACTIVITY_ROWS = 300
const BOOT_TIMEOUT_MS = 4 * 60_000
/** boat's own auto-stop deadline sits this far past the idle timeout: a fallback in case the agent is down. */
const SAFETY_SECONDS = 15 * 60

/**
 * The end of every screenshot command: prints the screen size, then the desktop as a JPEG scaled to fit 1280px, in
 * base64, so a screenshot is one request. ffmpeg grabs and scales in one step (~150 ms); scrot and ImageMagick are the
 * fallback. Expects DISPLAY, W, H, and L (the longer side) to be set.
 */
const CAPTURE = `if [ "$L" -gt 1280 ]; then SW=$(( W * 1280 / L / 2 * 2 )); else SW=$W; fi
echo "$W $H"
if command -v ffmpeg > /dev/null; then
  ffmpeg -loglevel error -f x11grab -video_size "\${W}x\${H}" -i "$DISPLAY" -frames:v 1 -vf "scale=\${SW}:-2" -q:v 5 -f image2 -c:v mjpeg - | base64 -w0
else
  scrot -o /tmp/dex-shot.png && convert /tmp/dex-shot.png -resize "\${SW}x" -quality 70 jpg:- | base64 -w0
fi`

/** The start of a desktop command: the screen size, for capturing and for mapping screenshot coordinates. */
export const DESKTOP_PRELUDE = `export DISPLAY=:0
G=$(xdotool getdisplaygeometry); W=\${G% *}; H=\${G#* }; L=$(( W > H ? W : H ))`

export interface Screenshot {
  readonly data: string
  readonly width: number
  readonly height: number
  /** The image is the screen scaled by this (1 when the screen fits 1280px). */
  readonly scale: number
}

const parseShot = (stdout: string): Screenshot => {
  const newline = stdout.indexOf("\n")
  const [width = 1920, height = 1080] = stdout.slice(0, newline).trim().split(/\s+/).map(Number)
  const data = stdout.slice(newline + 1).trim()
  if (!data) throw new Error("The screenshot came back empty")
  return { data, width, height, scale: Math.min(1, 1280 / Math.max(width, height)) }
}

/** Where Dex's Worker reaches a VM's Selkies: boat's private port URL, with the cookie and login it needs. */
export interface DesktopUpstream {
  readonly origin: string
  readonly headers: Record<string, string>
}

export interface VmHost {
  readonly sql: SqlStorage
  /** Runs a BoatClient program; aborting `signal` interrupts it. */
  run<A>(effect: Effect.Effect<A, BoatError, BoatClient>, signal?: AbortSignal): Promise<A>
  /** Whether this user has a boat.dev key (theirs, or the deployment's for its owner). */
  configured(): boolean
  /** Masks the chat's secret values in VM output (see SecretVault), before anyone sees it. */
  mask(key: string, text: string): string
  settings(key: string): { size: VmSize; minutes: number }
  publish(info: VmInfo): void
  broadcast(message: ServerMessage): void
  /** Ensures `idleCheck()` runs within a minute or so. */
  scheduleIdleCheck(): void
  /** Billing: a VM is running (no-op if its run is already open) / stopped at `at`. */
  runStarted(sandboxId: string, size: string): void
  runEnded(sandboxId: string, at: number): void
  /** Prepares a VM that has not been set up yet: GitHub sign-in, the chat's project repos and setup script. */
  provision(key: string, setup: VmSetupContext): Promise<void>
  /** boat refused another running VM: stop another, idle one if possible. Returns whether it freed one. */
  makeRoom(exceptKey: string): Promise<boolean>
  /** A VM finished being set up: `error` is why it failed, or null. */
  setupFinished?(key: string, error: string | null): void
  /** The template new VMs start from (see VmTemplate), or null for boat's base image. */
  template?(): Promise<string | null>
  /** Creating from the template found it gone. */
  templateMissing?(): void
}

/** What `VmHost.provision` can do on a VM that is up but not handed to the model yet. */
export interface VmSetupContext {
  readonly signal: AbortSignal | undefined
  /** Shows what setup is doing, on the Machine page and to a tool call waiting for the VM. */
  step(label: string): void
  /** Runs a command as a logged step. */
  run(title: string, command: string, options?: { cwd?: string; timeoutSeconds?: number }): Promise<{ exitCode: number; output: string }>
  /** Runs a command without logging it, e.g. polling. */
  quiet(command: string, options?: { cwd?: string; timeoutSeconds?: number }): Promise<CommandResult>
  /** Writes a file without logging its content (it may be a secret). */
  writeFile(path: string, content: string): Promise<void>
  /** Starts a command that keeps running after the call returns. */
  spawn(command: string, cwd?: string): Promise<void>
  /** A logged step whose output the caller streams. */
  begin(title: string): { append(text: string): void; finish(ok: boolean, exitCode?: number | null): void }
}

interface VmRow {
  vm_key: string
  sandbox_id: string | null
  last_active: number | null
  provisioned: number
  setup_error: string | null
  [key: string]: SqlStorageValue
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

export const errorText = (error: unknown) =>
  error instanceof BoatError ? `${error.message} (${error.code})` : error instanceof Error ? error.message : String(error)

/** boat's error when the account already runs as many VMs as its plan allows. */
const isCapacityError = (error: unknown) =>
  error instanceof BoatError &&
  [402, 403, 409, 429].includes(error.status) &&
  /limit|quota|concurrent|maximum|too many|exceed/i.test(`${error.code} ${error.message}`)

/** Creates the VM tables and moves the one VM from before VMs were per chat to the `shared` key. */
export const migrateVmTables = (sql: SqlStorage) => {
  sql.exec(`CREATE TABLE IF NOT EXISTS dex_vms (
    vm_key TEXT PRIMARY KEY, sandbox_id TEXT, last_active INTEGER, provisioned INTEGER NOT NULL DEFAULT 0, setup_error TEXT,
    created_at INTEGER NOT NULL)`)
  sql.exec(`CREATE TABLE IF NOT EXISTS dex_vm_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL,
    title TEXT NOT NULL, status TEXT NOT NULL, exit_code INTEGER, output TEXT NOT NULL DEFAULT '')`)
  const columns = sql.exec<{ name: string }>(`PRAGMA table_info(dex_vm_activity)`).toArray().map((column) => column.name)
  if (!columns.includes("vm_key")) sql.exec(`ALTER TABLE dex_vm_activity ADD COLUMN vm_key TEXT NOT NULL DEFAULT '${SHARED_VM}'`)
  sql.exec(`CREATE INDEX IF NOT EXISTS dex_vm_activity_key ON dex_vm_activity (vm_key, id)`)
  sql.exec(`CREATE TABLE IF NOT EXISTS dex_vm (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  const legacy = new Map(sql.exec<{ key: string; value: string }>(`SELECT key, value FROM dex_vm`).toArray().map((row) => [row.key, row.value]))
  const sandboxId = legacy.get("sandbox_id")
  if (sandboxId) {
    sql.exec(
      `INSERT OR IGNORE INTO dex_vms (vm_key, sandbox_id, last_active, provisioned, created_at) VALUES (?, ?, ?, 1, ?)`,
      SHARED_VM, sandboxId, Number(legacy.get("last_active") ?? 0) || null, Date.now()
    )
  }
  sql.exec(`DELETE FROM dex_vm`)
}

/**
 * One-time: gives the VM from before VMs were per chat to the chat that used it, so it links to that chat and goes
 * when the chat is deleted. The chat is the one whose lifetime (created to last message) holds most of the agent's
 * work on the VM; a chat that already has its own VM is skipped. Without a match the VM stays `shared`.
 */
export const adoptSharedVm = (sql: SqlStorage) => {
  if (!sql.exec(`SELECT 1 FROM dex_vms WHERE vm_key = ?`, SHARED_VM).toArray().length) return
  const [match] = sql
    .exec<{ id: string; hits: number }>(
      `SELECT s.id AS id, COUNT(*) AS hits FROM dex_vm_activity a
       JOIN dex_sessions s ON a.at BETWEEN s.created_at AND s.updated_at + 60000
       WHERE a.vm_key = ? AND a.actor = 'agent' AND NOT EXISTS (SELECT 1 FROM dex_vms v WHERE v.vm_key = s.id)
       GROUP BY s.id ORDER BY hits DESC, s.created_at DESC LIMIT 1`,
      SHARED_VM
    )
    .toArray()
  if (!match) return
  sql.exec(`UPDATE dex_vms SET vm_key = ? WHERE vm_key = ?`, match.id, SHARED_VM)
  sql.exec(`UPDATE dex_vm_activity SET vm_key = ? WHERE vm_key = ?`, match.id, SHARED_VM)
}

/** Keys of the VMs that have a row: a sandbox now, or one being created. */
export const storedVmKeys = (sql: SqlStorage) => sql.exec<{ vm_key: string }>(`SELECT vm_key FROM dex_vms ORDER BY created_at`).toArray().map((row) => row.vm_key)

/**
 * One chat's boat.dev VM: created when the chat first needs it, set up (GitHub, project repos) before
 * the model gets it, resumed from its disk snapshot when stopped, and kept alive while in use.
 * Everything done on it is logged as activity and broadcast to the UI.
 */
export class VmManager {
  private info: VmInfo
  private starting: Promise<Sandbox> | null = null
  private lastExtend = 0
  /** Operations running on the VM; it never idle-stops while this is above zero. */
  private inFlight = 0
  /** Selkies on the current sandbox, set up once; dropped when the Worker finds it gone (the VM restarted). */
  private selkies: { sandboxId: string; upstream: Promise<DesktopUpstream> } | null = null

  constructor(private readonly host: VmHost, readonly key: string) {
    const row = this.row()
    this.info = {
      key,
      id: row?.sandbox_id ?? null,
      status: row?.sandbox_id ? "stopped" : "none",
      size: null,
      archiveAfter: null,
      error: null,
      lastActiveAt: row?.last_active ?? null,
      busy: false,
      setup: row?.setup_error ? { status: "error", step: null, error: row.setup_error } : row?.provisioned ? { ...NO_SETUP, status: "done" } : NO_SETUP
    }
  }

  private row(): VmRow | undefined {
    return this.host.sql.exec<VmRow>(`SELECT * FROM dex_vms WHERE vm_key = ?`, this.key).toArray()[0]
  }

  private ensureRow() {
    this.host.sql.exec(`INSERT OR IGNORE INTO dex_vms (vm_key, created_at) VALUES (?, ?)`, this.key, Date.now())
  }

  private sandboxId(): string | null {
    return this.row()?.sandbox_id ?? null
  }

  private setSandboxId(id: string | null) {
    this.ensureRow()
    // A new sandbox starts unprepared.
    if (id) this.host.sql.exec(`UPDATE dex_vms SET sandbox_id = ?, provisioned = 0, setup_error = NULL WHERE vm_key = ?`, id, this.key)
    else this.host.sql.exec(`UPDATE dex_vms SET sandbox_id = NULL WHERE vm_key = ?`, this.key)
  }

  /** Marks the VM as in use now, which restarts its idle countdown. */
  touch() {
    const now = Date.now()
    if (this.row()) this.host.sql.exec(`UPDATE dex_vms SET last_active = ? WHERE vm_key = ?`, now, this.key)
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
    const minutes = this.host.settings(this.key).minutes
    const idleFor = Date.now() - (this.row()?.last_active ?? 0)
    if (idleFor < minutes * 60_000) return true
    await this.stop("system", `Stop VM after ${minutes} idle minute${minutes === 1 ? "" : "s"} (disk is kept)`).catch(() => undefined)
    return this.info.status === "running"
  }

  get current(): VmInfo {
    return this.info
  }

  /** Whether the VM is running with nothing in flight, so stopping it disturbs no one. */
  get idle(): boolean {
    return this.info.status === "running" && this.inFlight === 0 && this.starting === null
  }

  private update(patch: Partial<VmInfo>) {
    this.info = { ...this.info, ...patch }
    this.host.publish(this.info)
  }

  private setSetup(setup: VmSetup) {
    this.update({ setup })
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
    if (status === "running") this.host.runStarted(sandbox.id, sandbox.type ?? this.host.settings(this.key).size)
    else if (status === "stopped" || status === "error") {
      // Seen live, the stop just finished (boat bills until the disk is saved). Seen long after (the agent was
      // asleep), boat's last state change is the best estimate of when it ended.
      const changedAt = sandbox.updatedAt ? Date.parse(sandbox.updatedAt) : Number.NaN
      this.host.runEnded(sandbox.id, Number.isFinite(changedAt) && Date.now() - changedAt > 120_000 ? changedAt : Date.now())
    }
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
      .exec<ActivityRow>(`SELECT * FROM dex_vm_activity WHERE vm_key = ? ORDER BY id DESC LIMIT ?`, this.key, limit)
      .toArray()
      .reverse()
      .map(toActivity)
  }

  private startActivity(actor: VmActivity["actor"], kind: VmActivity["kind"], title: string): VmActivity {
    const row = this.host.sql
      .exec<ActivityRow>(
        `INSERT INTO dex_vm_activity (at, actor, kind, title, status, vm_key) VALUES (?, ?, ?, ?, 'running', ?) RETURNING *`,
        Date.now(), actor, kind, title.slice(0, 2_000), this.key
      )
      .one()
    const oldest = this.host.sql
      .exec<{ id: number }>(`SELECT id FROM dex_vm_activity WHERE vm_key = ? ORDER BY id DESC LIMIT 1 OFFSET ?`, this.key, MAX_ACTIVITY_ROWS)
      .toArray()[0]
    if (oldest) this.host.sql.exec(`DELETE FROM dex_vm_activity WHERE vm_key = ? AND id <= ?`, this.key, oldest.id)
    const activity = toActivity(row)
    this.host.broadcast({ type: "dex.vm.activity", sessionId: null, vmKey: this.key, activity })
    return activity
  }

  private appendActivity(id: number, data: string) {
    this.host.broadcast({ type: "dex.vm.output", sessionId: null, vmKey: this.key, id, data })
  }

  private finishActivity(id: number, status: "done" | "error", output: string, exitCode: number | null = null) {
    const row = this.host.sql
      .exec<ActivityRow>(`UPDATE dex_vm_activity SET status = ?, output = ?, exit_code = ? WHERE id = ? RETURNING *`, status, tail(output), exitCode, id)
      .toArray()[0]
    if (row) this.host.broadcast({ type: "dex.vm.activity", sessionId: null, vmKey: this.key, activity: toActivity(row) })
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
    if (!id || !this.host.configured()) {
      if (!this.starting) this.update({ id: null, status: "none", size: null, archiveAfter: null, error: null })
      return this.info
    }
    try {
      this.fromSandbox(await this.host.run(BoatClient.use((boat) => boat.get(id))))
      if (this.info.status === "running") this.host.scheduleIdleCheck()
    } catch (error) {
      if (error instanceof BoatError && error.status === 404) {
        this.setSandboxId(null)
        this.host.runEnded(id, Date.now())
        this.update({ id: null, status: "none", size: null, archiveAfter: null, error: null })
      } else {
        this.update({ error: `Couldn't check on this VM: ${errorText(error)}` })
      }
    }
    return this.info
  }

  /** The running, prepared VM: created, resumed, set up, or waited on as needed. Concurrent callers share one start. */
  ensureRunning(onProgress?: (message: string) => void, signal?: AbortSignal): Promise<Sandbox> {
    if (!this.host.configured()) return Promise.reject(new Error("No boat.dev key: connect yours in Settings → Cloud VMs."))
    this.starting ??= this.start(onProgress, signal)
      .then(async (sandbox) => {
        await this.prepare(sandbox, onProgress, signal)
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
    const { size, minutes } = this.host.settings(this.key)
    const ttlSeconds = minutes * 60 + SAFETY_SECONDS
    // Once per start: when boat says the account runs its maximum of VMs, stop an idle one and retry.
    let madeRoom = false
    const withRoom = async <A>(work: () => Promise<A>): Promise<A> => {
      try {
        return await work()
      } catch (error) {
        if (madeRoom || !isCapacityError(error)) throw error
        madeRoom = true
        onProgress?.("Too many VMs are running; stopping another chat's idle VM…\n")
        if (!(await this.host.makeRoom(this.key))) {
          throw new Error(`${errorText(error)}. Every other VM is busy: stop one on the Machine page and try again.`)
        }
        return work()
      }
    }

    const create = async () => {
      onProgress?.(`Creating a ${size} VM for this chat…\n`)
      const startedAt = Date.now()
      return this.logged("system", "lifecycle", `Create ${size} VM`, async () => {
        this.ensureRow()
        this.update({ status: "starting", error: null })
        // From Dex's template when the account has one (the desktop stream is already installed), else boat's base image.
        const from = (await this.host.template?.()) ?? undefined
        const created = await withRoom(() => boat((client) => client.create({ type: size, ttlSeconds, idempotencyKey: crypto.randomUUID(), from }))).catch(
          (error: unknown) => {
            if (!from || !(error instanceof BoatError && error.status === 404)) throw error
            this.host.templateMissing?.()
            return withRoom(() => boat((client) => client.create({ type: size, ttlSeconds, idempotencyKey: crypto.randomUUID() })))
          }
        )
        this.setSandboxId(created.id)
        this.setSetup(NO_SETUP)
        this.fromSandbox(created)
        return this.waitUntilReady(created.id, onProgress, signal)
      }, () => `Ready in ${Math.round((Date.now() - startedAt) / 1000)}s`).catch((error) => {
        if (!this.sandboxId()) this.update({ status: "none", error: errorText(error) })
        throw error
      })
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
          onProgress?.("Resuming this chat's VM from its saved disk…\n")
          this.update({ status: "starting", error: null })
          await withRoom(() => boat((client) => client.resume(id, ttlSeconds)))
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

  /**
   * First boot (or a setup interrupted by a restart): sign in to GitHub and clone the project before the model
   * gets the VM. A failed step is recorded, not retried on every resume; `resetSetup()` runs it again.
   */
  private async prepare(sandbox: Sandbox, onProgress?: (message: string) => void, signal?: AbortSignal) {
    if (this.row()?.provisioned) return
    this.inFlight++
    this.update({ busy: true })
    let step: string | null = null
    const runOn = (command: string, options: { cwd?: string; timeoutSeconds?: number } = {}, onOutput?: (data: string) => void) =>
      this.host.run(
        BoatClient.use((client) =>
          client.exec(sandbox.id, command, { cwd: options.cwd, timeoutSeconds: options.timeoutSeconds ?? 120, onOutput: (_stream, data) => onOutput?.(data) })
        ),
        signal
      )
    const context: VmSetupContext = {
      signal,
      step: (label) => {
        step = label
        onProgress?.(`${label}…\n`)
        this.setSetup({ status: "running", step: label, error: null })
      },
      run: async (title, command, options) => {
        const activity = this.startActivity("system", "exec", title)
        let output = ""
        try {
          const result = await runOn(command, options, (data) => {
            output = (output + data).slice(-MAX_ACTIVITY_OUTPUT * 2)
            this.appendActivity(activity.id, data)
          })
          const exitCode = result.exitCode ?? -1
          const notes = result.timedOut ? "\n[timed out]" : ""
          this.finishActivity(activity.id, exitCode === 0 ? "done" : "error", output + notes, exitCode)
          return { exitCode, output: output + notes }
        } catch (error) {
          this.finishActivity(activity.id, "error", `${output}\n${errorText(error)}`)
          throw error
        }
      },
      quiet: (command, options) => runOn(command, options),
      writeFile: (path, content) => this.host.run(BoatClient.use((client) => client.writeFile(sandbox.id, path, content)), signal),
      spawn: async (command, cwd) => {
        await this.host.run(BoatClient.use((client) => client.spawn(sandbox.id, command, cwd)), signal)
      },
      begin: (title) => {
        const activity = this.startActivity("system", "exec", title)
        let output = ""
        return {
          append: (text) => {
            output = (output + text).slice(-MAX_ACTIVITY_OUTPUT * 2)
            this.appendActivity(activity.id, text)
          },
          finish: (ok, exitCode = null) => this.finishActivity(activity.id, ok ? "done" : "error", output, exitCode)
        }
      }
    }
    try {
      await this.host.provision(this.key, context)
      this.host.sql.exec(`UPDATE dex_vms SET provisioned = 1, setup_error = NULL WHERE vm_key = ?`, this.key)
      this.setSetup({ status: "done", step: null, error: null })
      this.host.setupFinished?.(this.key, null)
    } catch (error) {
      // Interrupted (the chat was stopped, or Dex restarted): setup runs again next time.
      if (signal?.aborted) {
        this.setSetup(NO_SETUP)
        throw error
      }
      const message = errorText(error)
      this.host.sql.exec(`UPDATE dex_vms SET provisioned = 1, setup_error = ? WHERE vm_key = ?`, `${step ?? "Setup"}: ${message}`, this.key)
      this.setSetup({ status: "error", step, error: message })
      this.host.setupFinished?.(this.key, `${step ?? "Setup"}: ${message}`)
      onProgress?.(`Setup failed at "${step ?? "setup"}": ${message}. The VM is usable; fix it by hand or re-run setup on the Machine page.\n`)
    } finally {
      this.inFlight--
      this.update({ busy: this.inFlight > 0 })
    }
  }

  /** Runs setup again (e.g. after the project's repos or script changed), now if the VM runs, else on next start. */
  async resetSetup() {
    if (!this.row()) return
    this.host.sql.exec(`UPDATE dex_vms SET provisioned = 0, setup_error = NULL WHERE vm_key = ?`, this.key)
    this.setSetup(NO_SETUP)
    if (this.info.status === "running") await this.ensureRunning()
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
    const ttlSeconds = this.host.settings(this.key).minutes * 60 + SAFETY_SECONDS
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

  /** Deletes the VM and its disk. `forget` also drops its row and activity, e.g. when its chat is deleted. */
  async destroy(actor: VmActivity["actor"] = "user", { forget = false } = {}) {
    const id = this.sandboxId()
    const remove = async () => {
      if (id) {
        await this.host.run(BoatClient.use((client) => client.remove(id))).catch((error) => {
          if (!(error instanceof BoatError && error.status === 404)) throw error
        })
        this.host.runEnded(id, Date.now())
      }
    }
    if (forget) {
      await remove()
      this.host.sql.exec(`DELETE FROM dex_vms WHERE vm_key = ?`, this.key)
      this.host.sql.exec(`DELETE FROM dex_vm_activity WHERE vm_key = ?`, this.key)
      this.update({ id: null, status: "none", size: null, archiveAfter: null, error: null, setup: NO_SETUP })
      return
    }
    if (!id) return
    await this.logged(actor, "lifecycle", "Delete VM and its disk", async () => {
      await remove()
      this.setSandboxId(null)
      this.update({ id: null, status: "none", size: null, archiveAfter: null, error: null, setup: NO_SETUP })
    })
  }

  // ── Work ──────────────────────────────────────────────────────────────────

  /** Runs a shell command on the VM, streaming output to `onOutput` and to every watching client. */
  private async execUntracked(
    command: string,
    options: {
      actor: VmActivity["actor"]
      cwd?: string
      timeoutSeconds?: number
      signal?: AbortSignal
      onOutput?: (data: string) => void
      /** What the activity log shows, when the command carries plumbing (e.g. loading the env file). */
      title?: string
    }
  ): Promise<CommandResult & { output: string }> {
    const progress = (message: string) => options.onOutput?.(message)
    const sandbox = await this.ensureRunning(progress, options.signal)
    const activity = this.startActivity(options.actor, "exec", options.title ?? command)
    let output = ""
    const run = (id: string) =>
      this.host.run(
        BoatClient.use((client) =>
          client.exec(id, command, {
            cwd: options.cwd,
            timeoutSeconds: options.timeoutSeconds,
            onOutput: (_stream, chunk) => {
              const data = this.host.mask(this.key, chunk)
              output += data
              if (output.length > MAX_ACTIVITY_OUTPUT * 4) output = output.slice(-MAX_ACTIVITY_OUTPUT * 2)
              options.onOutput?.(data)
              this.appendActivity(activity.id, data)
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
      // Again on the whole output: a value can arrive split across two chunks.
      output = this.host.mask(this.key, output)
      const notes = [result.timedOut && "[timed out]", result.oomKilled && "[killed: out of memory]"].filter(Boolean).join(" ")
      this.finishActivity(activity.id, exitCode === 0 ? "done" : "error", notes ? `${output}\n${notes}` : output, exitCode)
      return { ...result, output: notes ? `${output}\n${notes}` : output }
    } catch (error) {
      this.finishActivity(activity.id, "error", `${output}\n${options.signal?.aborted ? "[stopped]" : errorText(error)}`)
      throw error
    }
  }

  private async spawnUntracked(
    command: string,
    options: { actor: VmActivity["actor"]; cwd?: string; signal?: AbortSignal; onOutput?: (data: string) => void; title?: string }
  ) {
    const sandbox = await this.ensureRunning(options.onOutput, options.signal)
    return this.logged(
      options.actor,
      "spawn",
      `${options.title ?? command} &`,
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
      async () => {
        const file = await this.host.run(BoatClient.use((client) => client.readFile(sandbox.id, path, encoding)), signal)
        return encoding === "utf8" ? { ...file, content: this.host.mask(this.key, file.content) } : file
      },
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
    return this.desktopUntracked("", "screenshot", actor, signal)
  }

  /**
   * Runs `actions` on the desktop (xdotool, with W/H/L and DISPLAY set; see DESKTOP_PRELUDE), then returns a
   * screenshot, all in one request: what each computer-use step costs is one round trip, not three.
   */
  private async desktopUntracked(actions: string, title: string, actor: VmActivity["actor"], signal?: AbortSignal, env?: string | null) {
    const sandbox = await this.ensureRunning(undefined, signal)
    return this.logged(actor, "screenshot", title, async () => {
      let script = `${DESKTOP_PRELUDE}\n${actions}\n${CAPTURE}`
      // Secrets typed on the desktop arrive as environment variables from a file the command sources and deletes.
      if (env) {
        const file = `/tmp/.dex-env-${crypto.randomUUID()}`
        await this.host.run(BoatClient.use((client) => client.writeFile(sandbox.id, file, env)), signal)
        script = `. ${file}; rm -f ${file}\n${script}`
      }
      const shot = await this.host.run(BoatClient.use((client) => client.exec(sandbox.id, script, { timeoutSeconds: 60 })), signal)
      if (shot.exitCode !== 0) throw new Error(`Desktop command failed: ${this.host.mask(this.key, (shot.stderr || shot.stdout || "").slice(-500))}`)
      return parseShot(shot.stdout ?? "")
    }, (shot) => `${shot.width}×${shot.height}`)
  }

  desktop(...args: Parameters<VmManager["desktopUntracked"]>) {
    return this.track(() => this.desktopUntracked(...args))
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

  /**
   * Where the Worker streams this VM's desktop from (src/server/vm-desktop.ts), setting Selkies up on first use.
   * Null while the VM isn't running. `refresh` starts over, for when the stream stopped answering. The result holds
   * the port cookie and password: it goes to the Worker only, never to a browser.
   */
  desktopUpstream(refresh = false): Promise<DesktopUpstream | null> {
    const id = this.sandboxId()
    if (!id || this.info.status !== "running") return Promise.resolve(null)
    if (refresh || this.selkies?.sandboxId !== id) {
      const upstream = this.startSelkies(id)
      this.selkies = { sandboxId: id, upstream }
      upstream.catch(() => {
        if (this.selkies?.upstream === upstream) this.selkies = null
      })
    }
    this.touch()
    return this.selkies!.upstream
  }

  private async startSelkies(id: string): Promise<DesktopUpstream> {
    const boat = <A>(effect: (client: BoatClient["Service"]) => Effect.Effect<A, BoatError>) => this.host.run(BoatClient.use(effect))
    const setup = await boat((client) => client.exec(id, SELKIES_SETUP, { timeoutSeconds: 240 }))
    const password = (setup.stdout ?? "").trim().split("\n").pop() ?? ""
    if (setup.exitCode !== 0 || !/^[A-Za-z0-9]{16,}$/.test(password)) {
      throw new Error(`Couldn't start the desktop stream: ${tail(setup.stderr || setup.stdout || `exit ${setup.exitCode}`, 600)}`)
    }
    // boat trades the link's one-time token for a cookie on its port domain (SameSite=None, which Safari won't send
    // from inside Dex); the Worker sends it instead.
    const url = await boat((client) => client.hostPort(id, SELKIES_PORT, false))
    const response = await fetch(url, { redirect: "manual" })
    const cookies = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""]
    const cookie = cookies.map((value) => value.split(";")[0]?.trim() ?? "").filter((value) => value.startsWith("_port_auth=")).join("; ")
    if (!cookie) throw new Error(`boat.dev didn't open the desktop port (HTTP ${response.status})`)
    return { origin: new URL(url).origin, headers: { cookie, authorization: `Basic ${btoa(`dex:${password}`)}` } }
  }
}
