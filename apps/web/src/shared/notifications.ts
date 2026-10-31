/** What a device can choose to be notified about. */
export const NOTIFY_KINDS = [
  { id: "sidekick", label: "Sidekicks", description: "When a sidekick messages you (each sidekick's own setting decides which messages)." },
  { id: "reply", label: "Replies", description: "When Dex finishes answering in a chat." },
  { id: "error", label: "Problems", description: "When a reply fails." },
  { id: "scheduled", label: "Scheduled tasks", description: "When a scheduled prompt has run." },
  { id: "machine", label: "Machines", description: "When a project chat's VM is ready, or its setup fails." },
  { id: "mcp", label: "MCP sign-in", description: "When an MCP server needs you to sign in again." },
  { id: "snooze", label: "Snoozed chats", description: "When a chat you snoozed comes back." }
] as const

export type NotifyKind = (typeof NOTIFY_KINDS)[number]["id"]

export const DEFAULT_KINDS: ReadonlyArray<NotifyKind> = ["sidekick", "reply", "error", "scheduled", "machine", "mcp", "snooze"]

/** A browser or installed app that receives push notifications. Endpoints and keys stay in the agent. */
export type PushPlatform = "web" | "ios" | "android"

export interface PushDevice {
  readonly id: string
  /** A browser (Web Push), or the iPhone/iPad or Android app. Missing on devices saved before the apps had push. */
  readonly platform?: PushPlatform
  /** e.g. "iPhone · Safari". */
  readonly label: string
  readonly kinds: ReadonlyArray<NotifyKind>
  /** Skip notifications while Dex is open and visible on some device. */
  readonly onlyWhenAway: boolean
  readonly createdAt: number
  readonly lastSentAt: number | null
  /** The last delivery error, if the most recent attempt failed. */
  readonly error: string | null
}

export interface PushStatus {
  /** Whether this deployment has VAPID keys. */
  readonly configured: boolean
  /** The VAPID public key that browsers subscribe with. */
  readonly publicKey: string | null
  readonly devices: ReadonlyArray<PushDevice>
  /** Whether this deployment can push to the native apps (APNs for iOS, Firebase for Android). */
  readonly native?: { readonly ios: boolean; readonly android: boolean }
}

/** A quick action button. Android and desktop show them; iOS opens `url` on tap instead. */
export interface PushAction {
  readonly action: string
  readonly title: string
}

/** What the service worker receives and turns into a notification. */
export interface PushPayload {
  readonly title: string
  readonly body: string
  /** Opened when the notification is tapped. */
  readonly url: string
  /** Replaces an earlier notification with the same tag (one per chat). */
  readonly tag: string
  readonly kind: NotifyKind | "test"
  readonly sessionId?: string
  /** Chats with something unread, for the app icon's badge. */
  readonly badge?: number
  readonly actions?: ReadonlyArray<PushAction>
  /** Pages for navigation actions, by action id. */
  readonly actionUrls?: Readonly<Record<string, string>>
}

/** Actions the service worker carries out without opening Dex. */
export const BACKGROUND_ACTIONS = ["mute"] as const
export type BackgroundAction = (typeof BACKGROUND_ACTIONS)[number]
