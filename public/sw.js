// Dex service worker: fast launches and an offline screen. It never caches pages, API calls, or the
// agent WebSocket, so a deploy is never served stale; only fingerprinted /assets/* files are cached.
const CACHE = "dex-static-v2"
const SHELL = ["/offline", "/favicon.svg", "/icon-192.png"]

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
        if (response.ok) cache.put(request, response.clone())
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
