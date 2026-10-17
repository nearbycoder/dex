/**
 * Web Push on this device. iOS (16.4+) only allows it in the Home Screen app, and only after a tap asks for
 * permission; Android and desktop browsers allow it anywhere.
 */

const DEVICE_KEY = "dex-push-device"

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export type PushSupport = "ok" | "needs-install" | "unsupported"

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported"
  if (isIOS() && !isStandalone()) return "needs-install"
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported"
  return "ok"
}

export const notificationPermission = (): NotificationPermission | "unsupported" =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission

/** e.g. "iPhone · Home Screen app" or "Mac · Chrome". */
export function deviceLabel(): string {
  const ua = navigator.userAgent
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "Device"
  const browser = isStandalone()
    ? "Home Screen app"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "browser"
  return `${device} · ${browser}`
}

/** This device's id in the agent, if notifications were turned on here. */
export const thisDeviceId = () => (typeof localStorage === "undefined" ? null : localStorage.getItem(DEVICE_KEY))

const applicationServerKey = (base64url: string) => {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

async function serviceWorker(): Promise<ServiceWorkerRegistration> {
  // In production the page registers it at load; local dev doesn't, so register on demand.
  if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register("/sw.js")
  return navigator.serviceWorker.ready
}

/**
 * Asks for permission, subscribes, and saves the subscription with `save` (the agent). Call it straight from a
 * tap: iOS ignores permission requests that don't come from one.
 */
export async function enablePush(publicKey: string, save: (subscription: PushSubscriptionJSON, label: string) => Promise<string>): Promise<string> {
  const permission = await Notification.requestPermission()
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? isIOS()
          ? "Notifications are off for Dex. Turn them on in iOS Settings → Notifications → Dex."
          : "Notifications are blocked for this site. Allow them in your browser's site settings."
        : "Notifications weren't allowed."
    )
  }
  const registration = await serviceWorker()
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) }))
  const id = await save(subscription.toJSON(), deviceLabel())
  localStorage.setItem(DEVICE_KEY, id)
  return id
}

/** Unsubscribes this browser; the agent forgets the device separately. */
export async function disablePush() {
  localStorage.removeItem(DEVICE_KEY)
  const registration = await navigator.serviceWorker.getRegistration()
  await (await registration?.pushManager.getSubscription())?.unsubscribe()
}

/** Clears the app icon badge and closes this chat's notifications, now that you're looking. */
export async function clearNotifications(sessionId: string | null) {
  const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> }
  await nav.clearAppBadge?.().catch(() => undefined)
  if (!sessionId || !("serviceWorker" in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration()
  for (const notification of (await registration?.getNotifications({ tag: `chat-${sessionId}` })) ?? []) notification.close()
}
