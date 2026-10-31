/**
 * Push to the native apps: Apple Push Notification service for the iPhone and iPad app, Firebase Cloud Messaging for
 * Android. Both with fetch and WebCrypto only (APNs needs HTTP/2, which a Worker's fetch speaks over TLS).
 *
 * Settings (secrets, never in wrangler.jsonc):
 * - APNS_KEY: the .p8 key from Apple (Certificates, Identifiers & Profiles → Keys, with APNs), as its PEM text.
 * - APNS_KEY_ID, APNS_TEAM_ID: its key ID and the team's ID. APNS_TOPIC: the app's bundle ID (default dev.trydex.Dex).
 * - FCM_SERVICE_ACCOUNT: a Firebase project's service account key, as its JSON.
 */

export interface NativeMessage {
  readonly title: string
  readonly body: string
  /** Opened when the notification is tapped (a path in Dex, e.g. /chat/<id>). */
  readonly url: string
  /** One notification per chat: a newer one replaces it. */
  readonly tag: string
  readonly sessionId?: string
  /** Unread chats, for the app icon's badge. */
  readonly badge?: number
  readonly kind: string
}

/** What came of one delivery: sent, the token is dead (forget the device), or another failure worth showing. */
export type NativeResult = { readonly ok: true } | { readonly ok: false; readonly gone: boolean; readonly error: string }

const base64url = (bytes: ArrayBuffer | Uint8Array | string) => {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : new Uint8Array(bytes)
  let binary = ""
  for (const byte of data) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

const pemBody = (pem: string) => {
  const text = pem.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
}

async function signJwt(header: object, claims: object, key: CryptoKey, algorithm: AlgorithmIdentifier | EcdsaParams) {
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`
  const signature = await crypto.subtle.sign(algorithm, key, new TextEncoder().encode(input))
  return `${input}.${base64url(signature)}`
}

// ── APNs ────────────────────────────────────────────────────────────────────

export interface ApnsConfig {
  readonly key: string
  readonly keyId: string
  readonly teamId: string
  readonly topic: string
}

export class ApnsSender {
  private token: { value: string; at: number } | null = null

  constructor(private readonly config: ApnsConfig) {}

  /** Apple wants a fresh provider token at most hourly and no more often than every 20 minutes. */
  private async providerToken() {
    if (this.token && Date.now() - this.token.at < 40 * 60_000) return this.token.value
    const key = await crypto.subtle.importKey("pkcs8", pemBody(this.config.key), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])
    const value = await signJwt(
      { alg: "ES256", kid: this.config.keyId },
      { iss: this.config.teamId, iat: Math.floor(Date.now() / 1000) },
      key,
      { name: "ECDSA", hash: "SHA-256" }
    )
    this.token = { value, at: Date.now() }
    return value
  }

  async send(deviceToken: string, environment: "sandbox" | "production", message: NativeMessage): Promise<NativeResult> {
    const host = environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com"
    try {
      const response = await fetch(`https://${host}/3/device/${encodeURIComponent(deviceToken)}`, {
        method: "POST",
        headers: {
          authorization: `bearer ${await this.providerToken()}`,
          "apns-topic": this.config.topic,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-collapse-id": message.tag.slice(0, 64),
          "content-type": "application/json"
        },
        body: JSON.stringify({
          aps: {
            alert: { title: message.title, body: message.body },
            sound: "default",
            "thread-id": message.sessionId ?? message.kind,
            ...(message.badge !== undefined && { badge: message.badge })
          },
          url: message.url,
          sessionId: message.sessionId ?? null,
          kind: message.kind
        })
      })
      if (response.ok) return { ok: true }
      const reason = ((await response.json().catch(() => ({}))) as { reason?: string }).reason ?? `HTTP ${response.status}`
      if (reason === "ExpiredProviderToken") this.token = null
      return { ok: false, gone: response.status === 410 || reason === "BadDeviceToken" || reason === "Unregistered", error: `APNs: ${reason}` }
    } catch (error) {
      return { ok: false, gone: false, error: `APNs: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
}

// ── Firebase Cloud Messaging ────────────────────────────────────────────────

interface ServiceAccount {
  readonly project_id: string
  readonly client_email: string
  readonly private_key: string
}

export class FcmSender {
  private access: { value: string; until: number } | null = null
  private readonly account: ServiceAccount

  constructor(serviceAccountJson: string) {
    this.account = JSON.parse(serviceAccountJson) as ServiceAccount
    if (!this.account.project_id || !this.account.client_email || !this.account.private_key) throw new Error("FCM_SERVICE_ACCOUNT isn't a service account key.")
  }

  /** An OAuth access token for the FCM API, from the service account (a signed JWT traded at Google). */
  private async accessToken() {
    if (this.access && Date.now() < this.access.until) return this.access.value
    const key = await crypto.subtle.importKey("pkcs8", pemBody(this.account.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"])
    const now = Math.floor(Date.now() / 1000)
    const assertion = await signJwt(
      { alg: "RS256", typ: "JWT" },
      { iss: this.account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 },
      key,
      { name: "RSASSA-PKCS1-v1_5" }
    )
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
    })
    const body = (await response.json()) as { access_token?: string; expires_in?: number; error_description?: string }
    if (!body.access_token) throw new Error(body.error_description ?? `Google token ${response.status}`)
    this.access = { value: body.access_token, until: Date.now() + ((body.expires_in ?? 3600) - 300) * 1000 }
    return body.access_token
  }

  async send(deviceToken: string, message: NativeMessage): Promise<NativeResult> {
    try {
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`, {
        method: "POST",
        headers: { authorization: `Bearer ${await this.accessToken()}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            // Data only: the app builds the notification itself (its channel, the sidekick's face, the chat to open).
            data: {
              title: message.title,
              body: message.body,
              url: message.url,
              tag: message.tag,
              kind: message.kind,
              sessionId: message.sessionId ?? "",
              badge: String(message.badge ?? 0)
            },
            android: { priority: "HIGH", ttl: "43200s" }
          }
        })
      })
      if (response.ok) return { ok: true }
      const error = ((await response.json().catch(() => ({}))) as { error?: { status?: string; message?: string } }).error
      const gone =
        response.status === 404 || error?.status === "NOT_FOUND" || error?.status === "UNREGISTERED" || /registration token/i.test(error?.message ?? "")
      return { ok: false, gone, error: `FCM: ${error?.status ?? response.status} ${error?.message ?? ""}`.trim().slice(0, 200) }
    } catch (error) {
      return { ok: false, gone: false, error: `FCM: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
}
