// Dex service worker: fast launches and an offline screen. It never caches pages, API calls, or the
// agent WebSocket, so a deploy is never served stale; only fingerprinted /assets/* files are cached.
const CACHE = "dex-static-v2"
const SHELL = ["/offline", "/favicon.svg", "/icon-192.png"]

/** Each deploy adds new fingerprinted files; keep the most recent ones so the cache doesn't grow forever. */
const MAX_ENTRIES = 400
const trim = async (cache) => {
  const keys = await cache.keys()
  const extra = keys.length - MAX_ENTRIES
  // Keys come back in insertion order, oldest first; the shell entries were added first, so skip those.
  if (extra > 0) await Promise.all(keys.slice(SHELL.length, SHELL.length + extra).map((key) => cache.delete(key)))
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Fingerprinted build output never changes under a URL: cache first.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/models/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(request)
        if (hit) return hit
        const response = await fetch(request)
        if (response.ok) event.waitUntil(cache.put(request, response.clone()).then(() => trim(cache)))
        return response
      })
    )
    return
  }

  // Pages: always the network, with an offline screen when there is none.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline")))
  }
})

// ── Push notifications ────────────────────────────────────────────────────
// The agent sends a JSON payload (see PushPayload in src/shared/notifications.ts). Android and desktop show
// its action buttons; iOS shows none and opens `url` when tapped. The app icon badge counts what's unread.

self.addEventListener("push", (event) => {
  let data
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : "" }
  }
  const title = data.title || "Dex"
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body: data.body || "",
        tag: data.tag || undefined,
        // A newer update for the same chat replaces the old one, and still alerts.
        renotify: Boolean(data.tag),
        icon: "/icon-192.png",
        badge: "/badge-96.png",
        timestamp: Date.now(),
        actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
        data: { url: data.url || "/", sessionId: data.sessionId || null, actionUrls: data.actionUrls || {} }
      })
      const shown = await self.registration.getNotifications()
      if (self.navigator.setAppBadge) await self.navigator.setAppBadge(shown.length).catch(() => {})
    })()
  )
})

/** Focuses an open Dex window and takes it to `url`, or opens one. */
async function openDex(url) {
  const target = new URL(url, self.location.origin).href
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  const existing = windows.find((client) => new URL(client.url).origin === self.location.origin)
  if (existing) {
    await existing.focus()
    if (existing.url !== target && "navigate" in existing) await existing.navigate(target).catch(() => {})
    return
  }
  await self.clients.openWindow(target)
}

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification
  const { url, sessionId, actionUrls } = notification.data || {}
  notification.close()
  event.waitUntil(
    (async () => {
      if (event.action === "mute" && sessionId) {
        // Quick action that doesn't open Dex; the session cookie authenticates it.
        await fetch("/api/push/action", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "mute", sessionId })
        }).catch(() => {})
      } else {
        await openDex((actionUrls && actionUrls[event.action]) || url || "/")
      }
      const shown = await self.registration.getNotifications()
      if (self.navigator.setAppBadge) await self.navigator.setAppBadge(shown.length).catch(() => {})
    })()
  )
})
