import { RefreshCw } from "lucide-react"
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"

/**
 * Notices a deploy while the app is open. A Home Screen app is rarely closed: it resumes from the background on
 * the code it launched with, for days. So ask the Worker which build it runs when the app comes back, now and
 * then while it's open, and when the network returns; a different build means there's an update.
 */

/** Ask at most this often, however often the app is switched to. */
const MIN_GAP_MS = 30_000
/** While the app stays open and visible. */
const POLL_MS = 10 * 60_000
/** Back after this long away with an update waiting, on a chat with nothing typed: reload quietly instead of asking. */
const QUIET_RELOAD_AFTER_MS = 5 * 60_000

async function latestBuild(): Promise<string | null> {
  try {
    const response = await fetch("/api/version", { cache: "no-store", credentials: "same-origin" })
    if (!response.ok) return null
    const { build } = (await response.json()) as { build?: unknown }
    return typeof build === "string" ? build : null
  } catch {
    return null
  }
}

/**
 * Whether a reload would lose nothing: only on the chat pages (other pages are forms with unsaved edits), and
 * only with nothing typed there (drafts live only in the page).
 */
const safeToReload = () =>
  /^\/chat(\/|$)/.test(location.pathname) &&
  ![...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type=hidden])")].some((field) => field.value.trim() !== "")

/** The service worker's copy of app pages (see public/sw.js): cleared before reloading, so the reload is fresh. */
const PAGE_CACHE = "dex-pages-v1"
/** Forgets the service worker's copy of app pages (applying an update, signing out). */
export const clearCachedPages = () => (typeof caches === "undefined" ? Promise.resolve(false) : caches.delete(PAGE_CACHE).catch(() => false))

/** Reloads onto the new build, after letting the service worker pick up its own update. */
export async function applyUpdate() {
  const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
  await Promise.race([
    Promise.all([registration?.update().catch(() => undefined), clearCachedPages()]),
    new Promise((resolve) => setTimeout(resolve, 1_500))
  ])
  location.reload()
}

/**
 * A page served from the service worker's copy can be one deploy behind, and ask for a chunk that's gone. Vite reports
 * that as `vite:preloadError`: reload once onto a fresh page instead of failing.
 */
if (typeof window !== "undefined") {
  addEventListener("vite:preloadError", (event) => {
    if (sessionStorage.getItem("dex-chunk-reload")) return
    sessionStorage.setItem("dex-chunk-reload", String(Date.now()))
    event.preventDefault()
    void applyUpdate()
  })
  // A page that loads fine clears the guard for next time.
  addEventListener("load", () => setTimeout(() => sessionStorage.removeItem("dex-chunk-reload"), 10_000))
}

/** The build the Worker has, once it differs from the one this page is running; null while they match. */
let available: string | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const setAvailable = (build: string) => {
  if (available === build) return
  available = build
  for (const listener of listeners) listener()
}

export const useUpdateAvailable = (): string | null => useSyncExternalStore(subscribe, () => available, () => null)

/** Watches for a deploy while the app is open. Run once, in the signed-in shell. */
export function useUpdateChecker() {
  const lastCheck = useRef(0)
  const hiddenAt = useRef<number | null>(null)

  const check = useCallback(async (force = false) => {
    if (!force && Date.now() - lastCheck.current < MIN_GAP_MS) return null
    lastCheck.current = Date.now()
    const build = await latestBuild()
    if (build && build !== __DEX_BUILD__) {
      setAvailable(build)
      return build
    }
    return null
  }, [])

  useEffect(() => {
    const onVisibility = async () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now()
        return
      }
      const away = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current
      hiddenAt.current = null
      const build = await check(away >= QUIET_RELOAD_AFTER_MS)
      if (build && away >= QUIET_RELOAD_AFTER_MS && safeToReload()) void applyUpdate()
    }
    const onOnline = () => void check()
    // The first check, soon after launch: the page may have come from the service worker's copy, a deploy behind.
    // Moving onto the new build right away is invisible on a chat with nothing typed; elsewhere the button shows.
    const launchedAt = Date.now()
    const first = setTimeout(async () => {
      const build = await check(true)
      if (build && Date.now() - launchedAt < 15_000 && safeToReload()) void applyUpdate()
    }, 2_000)
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void check()
    }, POLL_MS)
    document.addEventListener("visibilitychange", onVisibility)
    addEventListener("online", onOnline)
    return () => {
      clearTimeout(first)
      clearInterval(poll)
      document.removeEventListener("visibilitychange", onVisibility)
      removeEventListener("online", onOnline)
    }
  }, [check])
}

/** The sidebar's "Update ready" row: one tap reloads onto the new build. Nothing while the app is current. */
export function UpdateButton({ className = "" }: { className?: string }) {
  const update = useUpdateAvailable()
  const [refreshing, setRefreshing] = useState(false)
  if (!update) return null
  return (
    <button
      type="button"
      disabled={refreshing}
      onClick={() => {
        setRefreshing(true)
        void applyUpdate()
      }}
      title="A new version of Dex is deployed"
      className={`animate-fade flex w-full items-center gap-2 rounded-md bg-emerald-500/10 px-2 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-70 ${className}`}
    >
      <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
      <span className="font-medium">Update ready</span>
      <span className="ml-auto text-xs text-emerald-400/80">{refreshing ? "Refreshing…" : "Refresh"}</span>
    </button>
  )
}
