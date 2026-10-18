import type { Effect } from "effect"
import { BoatClient, BoatError } from "./boat"
import { SELKIES_BAKE, SELKIES_TEMPLATE_CLEANUP, SELKIES_VERSION } from "./selkies"

/** Bump when what's baked in changes, so VMs come from a fresh template instead of the old one. */
const TEMPLATE_REVISION = 3
/** A boat named snapshot in the user's own boat account (each person uses their own key). */
const templateName = (revision: number) => `dex-desktop-r${revision}-selkies-${SELKIES_VERSION.replaceAll(".", "-")}`
export const TEMPLATE_NAME = templateName(TEMPLATE_REVISION)

/** Rebuild after this long, so new VMs keep up with boat's base image (its desktop, agents, security updates). */
const MAX_AGE_MS = 30 * 24 * 60 * 60_000
/** Don't try again sooner than this after a build attempt. */
const RETRY_AFTER_MS = 6 * 60 * 60_000
/** How long a "the template is (not) there" answer is trusted. */
const RECHECK_MS = 10 * 60_000
const READY = new Set(["ready", "idle", "running"])

export interface TemplateHost {
  readonly sql: SqlStorage
  run<A>(effect: Effect.Effect<A, BoatError, BoatClient>): Promise<A>
  /** Keeps the agent in memory until `work` settles (a build takes a minute or two). */
  keepAliveWhile<A>(work: () => Promise<A>): Promise<A>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A prepared disk new VMs start from: boat's base image with Dex's desktop stream already installed, so a new VM is
 * up in seconds with nothing to install. Built once per boat account on a throwaway VM (created without the
 * account's environment, so no credentials end up in the saved disk), then deleted. Until it exists, VMs start from
 * boat's base image and install the stream when the desktop is first opened.
 */
export class VmTemplate {
  private known: { ready: boolean; at: number } | null = null
  private building: Promise<void> | null = null

  constructor(private readonly host: TemplateHost) {}

  private meta(key: string): number | null {
    const row = this.host.sql.exec<{ value: string }>(`SELECT value FROM dex_meta WHERE key = ?`, key).toArray()[0]
    return row ? Number(row.value) : null
  }

  private setMeta(key: string, value: string | number | null) {
    if (value === null) this.host.sql.exec(`DELETE FROM dex_meta WHERE key = ?`, key)
    else this.host.sql.exec(`INSERT INTO dex_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, String(value))
  }

  /** The template to create a VM from, or null for boat's base image. Starts a build in the background when it's missing or old. */
  async current(): Promise<string | null> {
    if (!this.known || Date.now() - this.known.at > RECHECK_MS) {
      const status = await this.host.run(BoatClient.use((boat) => boat.namedSnapshot(TEMPLATE_NAME))).catch(() => undefined)
      // Couldn't ask: use the base image this time.
      if (status === undefined) return null
      this.known = { ready: status === "ready", at: Date.now() }
    }
    // Found ready but built before this agent kept track (or by another): count its age from now.
    if (this.known.ready && this.meta("vm_template_built") === null) this.setMeta("vm_template_built", Date.now())
    const builtAt = this.meta("vm_template_built")
    if (!this.known.ready || (builtAt !== null && Date.now() - builtAt > MAX_AGE_MS)) this.build()
    return this.known.ready ? TEMPLATE_NAME : null
  }

  /** Creating from the template failed as if it's gone (deleted in boat, or another account's key): check again next time. */
  forget() {
    this.known = null
  }

  private build() {
    if (this.building) return
    const attempted = this.meta("vm_template_attempt")
    if (attempted !== null && Date.now() - attempted < RETRY_AFTER_MS) return
    this.setMeta("vm_template_attempt", Date.now())
    this.building = this.host
      .keepAliveWhile(() => this.buildNow())
      .catch((error: unknown) => {
        // No free VM slot (a trial runs 2 at once): try again at the next VM start rather than hours later.
        if (error instanceof BoatError && (error.status === 429 || /limit|concurrent/i.test(error.message))) this.setMeta("vm_template_attempt", null)
        console.warn(`Couldn't build the VM template: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => {
        this.building = null
      })
  }

  private async buildNow() {
    const boat = <A>(effect: (client: BoatClient["Service"]) => Effect.Effect<A, BoatError>) => this.host.run(BoatClient.use(effect))
    // A builder left behind by a build that was cut off.
    const leftover = this.host.sql.exec<{ value: string }>(`SELECT value FROM dex_meta WHERE key = 'vm_template_builder'`).toArray()[0]?.value
    if (leftover) await boat((client) => client.remove(leftover)).catch(() => undefined)

    const created = await boat((client) => client.create({ type: "small", ttlSeconds: 20 * 60, idempotencyKey: crypto.randomUUID(), noEnv: true }))
    this.setMeta("vm_template_builder", created.id)
    try {
      for (let waited = 0; ; waited += 3_000) {
        const sandbox = await boat((client) => client.get(created.id))
        if (READY.has(sandbox.state)) break
        if (sandbox.state === "error" || waited > 5 * 60_000) throw new Error(`The template builder VM didn't start (${sandbox.state})`)
        await sleep(3_000)
      }
      const baked = await boat((client) => client.exec(created.id, `${SELKIES_BAKE}\n${SELKIES_TEMPLATE_CLEANUP}`, { timeoutSeconds: 300 }))
      if (baked.exitCode !== 0) throw new Error(`Installing the desktop stream failed: ${(baked.stderr || baked.stdout || "").slice(-600)}`)
      await boat((client) => client.saveNamedSnapshot(created.id, TEMPLATE_NAME))
      for (let waited = 0; ; waited += 5_000) {
        const status = await boat((client) => client.namedSnapshot(TEMPLATE_NAME))
        if (status === "ready") break
        if (status === "failed" || status === "error" || waited > 10 * 60_000) throw new Error(`Saving the template didn't finish (${status})`)
        await sleep(5_000)
      }
      this.setMeta("vm_template_built", Date.now())
      this.known = { ready: true, at: Date.now() }
      // Earlier revisions' templates are replaced: don't leave them taking up the account's named snapshots.
      for (let revision = 1; revision < TEMPLATE_REVISION; revision++) {
        await boat((client) => client.deleteNamedSnapshot(templateName(revision))).catch(() => undefined)
      }
    } finally {
      await boat((client) => client.remove(created.id)).catch(() => undefined)
      this.setMeta("vm_template_builder", null)
    }
  }
}
