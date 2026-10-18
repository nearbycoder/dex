import { RefreshCw, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

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

/** Reloads onto the new build, after letting the service worker pick up its own update. */
export async function applyUpdate() {
  const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
  await Promise.race([registration?.update().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 1_500))])
  location.reload()
}

/** The build the Worker has, once it differs from the one this page is running; null while they match. */
export function useUpdateAvailable(): string | null {
  const [available, setAvailable] = useState<string | null>(null)
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
    const first = setTimeout(() => void check(true), 5_000)
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

  return available
}

/** A floating "Update available" pill with a Refresh button. Dismissing it hides it until the next deploy. */
export function UpdateBanner() {
  const available = useUpdateAvailable()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  if (!available || dismissed === available) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.5rem)] z-50 flex justify-center px-4">
      <div
        role="status"
        className="animate-rise pointer-events-auto flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/95 py-1 pr-1 pl-3.5 text-sm shadow-lg shadow-black/40 backdrop-blur"
      >
        <span className="mr-1 size-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />
        <span className="mr-2 whitespace-nowrap text-zinc-200">Update available</span>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true)
            void applyUpdate()
          }}
          className="flex items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1.5 font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-70"
        >
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
        <button
          type="button"
          aria-label="Later"
          onClick={() => setDismissed(available)}
          className="rounded-full p-1.5 text-zinc-500 hover:text-zinc-200"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
