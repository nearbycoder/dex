import { buildPushPayload } from "@block65/webcrypto-web-push"
import { DEFAULT_KINDS, NOTIFY_KINDS, type NotifyKind, type PushDevice, type PushPayload, type PushStatus } from "~/shared/notifications"

/** Push services browsers subscribe through; subscriptions elsewhere are refused, so nobody can aim pushes at other hosts. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/]
const KIND_IDS = new Set<string>(NOTIFY_KINDS.map((kind) => kind.id))

interface DeviceRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  label: string
  kinds: string
  only_when_away: number
  created_at: number
  last_sent_at: number | null
  error: string | null
  [key: string]: SqlStorageValue
}

export interface PushHost {
  readonly sql: SqlStorage
  /** VAPID key pair (the private key as a JWK); without both, push is off. */
  readonly publicKey: string | undefined
  readonly privateKey: string | undefined
  /** Contact for push services (VAPID `sub`): the app's https origin. */
  subject(): string
  publish(status: PushStatus): void
  /** Whether Dex is open and visible somewhere, showing this chat (or anything, without one). */
  isWatching(sessionId?: string): boolean
}

export interface SubscriptionInput {
  readonly endpoint: string
  readonly keys: { readonly p256dh: string; readonly auth: string }
}

const toDevice = (row: DeviceRow): PushDevice => ({
  id: row.id,
  label: row.label,
  kinds: (JSON.parse(row.kinds) as string[]).filter((kind): kind is NotifyKind => KIND_IDS.has(kind)),
  onlyWhenAway: row.only_when_away === 1,
  createdAt: row.created_at,
  lastSentAt: row.last_sent_at,
  error: row.error
})

/** Topics must be URL-safe base64 characters, at most 32 of them. */
const topicOf = (tag: string) => tag.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32)

/** Devices that get Web Push notifications, their preferences, and delivery. */
export class PushCenter {
  constructor(private readonly host: PushHost) {
    host.sql.exec(`CREATE TABLE IF NOT EXISTS dex_push (
      id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, label TEXT NOT NULL,
      kinds TEXT NOT NULL, only_when_away INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
      last_sent_at INTEGER, error TEXT)`)
  }

  get configured() {
    return Boolean(this.host.publicKey && this.host.privateKey)
  }

  private rows(): DeviceRow[] {
    return this.host.sql.exec<DeviceRow>(`SELECT * FROM dex_push ORDER BY created_at`).toArray()
  }

  status(): PushStatus {
    return { configured: this.configured, publicKey: this.host.publicKey ?? null, devices: this.rows().map(toDevice) }
  }

  private refresh() {
    this.host.publish(this.status())
  }

  /** Saves a browser's subscription (or updates it, by endpoint) and returns the device id. */
  async subscribe(input: SubscriptionInput, label: string): Promise<string> {
    if (!this.configured) throw new Error("Push notifications aren't set up on this deployment (VAPID keys).")
    let url: URL
    try {
      url = new URL(String(input?.endpoint ?? ""))
    } catch {
      throw new Error("That isn't a push subscription.")
    }
    if (url.protocol !== "https:" || !PUSH_HOSTS.some((host) => host.test(url.hostname))) throw new Error("Unknown push service.")
    const p256dh = String(input.keys?.p256dh ?? "")
    const auth = String(input.keys?.auth ?? "")
    if (!/^[\w-]{40,200}$/.test(p256dh) || !/^[\w-]{8,64}$/.test(auth)) throw new Error("The subscription's keys are malformed.")
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url.href)))
    const id = [...digest.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
    this.host.sql.exec(
      `INSERT INTO dex_push (id, endpoint, p256dh, auth, label, kinds, only_when_away, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, error = NULL`,
      id, url.href, p256dh, auth, String(label).slice(0, 60) || "Device", JSON.stringify(DEFAULT_KINDS), Date.now()
    )
    this.refresh()
    return id
  }

  update(id: string, patch: { kinds?: readonly string[]; onlyWhenAway?: boolean }) {
    if (patch.kinds) {
      const kinds = [...new Set(patch.kinds)].filter((kind) => KIND_IDS.has(kind))
      this.host.sql.exec(`UPDATE dex_push SET kinds = ? WHERE id = ?`, JSON.stringify(kinds), id)
    }
    if (patch.onlyWhenAway !== undefined) this.host.sql.exec(`UPDATE dex_push SET only_when_away = ? WHERE id = ?`, patch.onlyWhenAway ? 1 : 0, id)
    this.refresh()
  }

  remove(id: string) {
    this.host.sql.exec(`DELETE FROM dex_push WHERE id = ?`, id)
    this.refresh()
  }

  /** Sends to every device that wants this kind (and, if it asked, isn't already looking). Returns how many got it. */
  async notify(kind: NotifyKind, payload: PushPayload): Promise<number> {
    if (!this.configured) return 0
    const watching = this.host.isWatching(payload.sessionId)
    const targets = this.rows().filter((row) => {
      const device = toDevice(row)
      return device.kinds.includes(kind) && !(device.onlyWhenAway && watching)
    })
    const results = await Promise.all(targets.map((row) => this.deliver(row, payload)))
    if (targets.length) this.refresh()
    return results.filter(Boolean).length
  }

  /** A test notification to one device, regardless of its preferences. */
  async test(id: string): Promise<string | null> {
    const row = this.rows().find((candidate) => candidate.id === id)
    if (!row) return "This device isn't subscribed any more."
    const ok = await this.deliver(row, {
      title: "Dex notifications are on",
      body: "This is what an update from Dex looks like.",
      url: "/notifications",
      tag: "dex-test",
      kind: "test",
      actions: [{ action: "open", title: "Open Dex" }]
    })
    this.refresh()
    return ok ? null : (this.rows().find((candidate) => candidate.id === id)?.error ?? "Delivery failed.")
  }

  /** The VAPID private key's `d`, from the JWK the secret holds. */
  private signingKey(): string {
    const jwk = JSON.parse(this.host.privateKey!) as { d?: string }
    if (!jwk.d) throw new Error("VAPID_PRIVATE_KEY isn't a private JWK.")
    return jwk.d
  }

  private async deliver(row: DeviceRow, payload: PushPayload): Promise<boolean> {
    try {
      // RFC 8291 aes128gcm with RFC 8292 VAPID: what every push service accepts, Apple's included.
      const request = await buildPushPayload(
        {
          data: payload as unknown as Record<string, string>,
          options: { ttl: 12 * 60 * 60, urgency: payload.kind === "error" || payload.kind === "mcp" ? "high" : "normal", topic: topicOf(payload.tag) }
        },
        { endpoint: row.endpoint, expirationTime: null, keys: { p256dh: row.p256dh, auth: row.auth } },
        { subject: this.host.subject(), publicKey: this.host.publicKey, privateKey: this.signingKey() }
      )
      const response = await fetch(row.endpoint, { method: "POST", headers: request.headers, body: request.body })
      // Gone: the user turned notifications off in the browser, or the subscription expired.
      if (response.status === 404 || response.status === 410) {
        this.host.sql.exec(`DELETE FROM dex_push WHERE id = ?`, row.id)
        return false
      }
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 200)
        this.host.sql.exec(`UPDATE dex_push SET error = ? WHERE id = ?`, `${response.status} ${detail}`.trim(), row.id)
        return false
      }
      this.host.sql.exec(`UPDATE dex_push SET last_sent_at = ?, error = NULL WHERE id = ?`, Date.now(), row.id)
      return true
    } catch (error) {
      this.host.sql.exec(`UPDATE dex_push SET error = ? WHERE id = ?`, (error instanceof Error ? error.message : String(error)).slice(0, 200), row.id)
      return false
    }
  }
}
