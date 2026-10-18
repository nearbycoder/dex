import { createFileRoute, Link, Outlet, redirect, useLocation, useMatch, useRouter } from "@tanstack/react-router"
import { MessageSquarePlus } from "lucide-react"
import { useEffect } from "react"
import { Sidebar } from "~/client/components/sidebar"
import { ShellSkeleton } from "~/client/components/skeleton"
import { DexProvider, forgetSavedState } from "~/client/lib/dex"
import { MenuButton, NavContext, useNavState, useVisualViewportHeight } from "~/client/lib/mobile-nav"
import { useHaptics } from "~/client/lib/haptics"
import { useUpdateChecker } from "~/client/lib/updates"
import { getViewer, type Viewer, type ViewerResult } from "~/server/viewer"

/**
 * Who is signed in, asked once per page load rather than on every navigation (`beforeLoad` runs on each one).
 * The agent's WebSocket checks the session cookie on every connection anyway, and signing out reloads the page.
 */
let signedIn: Promise<ViewerResult> | undefined

/**
 * The last confirmed sign-in, kept on this device (with the synced state it belongs to; "dex-state:" keys go when you
 * sign out). Asking the server wakes the agent to check the session isn't revoked, which takes seconds when it's cold,
 * so a launch with one starts at once and confirms in the background: revoked or signed out, the device's copies are
 * forgotten and you're sent to sign in. Nothing new is shown early: live data comes over the socket, which checks the
 * session itself.
 */
const VIEWER_KEY = "dex-state:viewer"
const keptViewer = (): Viewer | null => {
  try {
    const kept = JSON.parse(localStorage.getItem(VIEWER_KEY) ?? "null") as Viewer | null
    return kept && typeof kept.id === "string" ? kept : null
  } catch {
    return null
  }
}
const keepViewer = (viewer: Viewer) => localStorage.setItem(VIEWER_KEY, JSON.stringify(viewer))
let confirmed = false

/** Signed-in shell. Client-rendered: it holds the WebSocket to the user's agent. */
export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async () => {
    const kept = keptViewer()
    if (!signedIn) {
      signedIn = getViewer()
      if (kept) {
        signedIn.then(
          ({ viewer }) => {
            if (viewer && viewer.id === kept.id) {
              confirmed = true
              keepViewer(viewer)
              return
            }
            forgetSavedState()
            window.location.assign("/login")
          },
          // Offline or unreachable: carry on with what's kept; the socket reconnects (and checks) when it can.
          () => undefined
        )
      }
    }
    // Until the check answers, navigate on the kept sign-in rather than waiting for it.
    if (kept && !confirmed) return { viewer: kept }
    const { viewer } = await signedIn.catch((error: unknown) => {
      signedIn = undefined
      throw error
    })
    if (!viewer) {
      signedIn = undefined
      // Signed out, expired, or revoked: don't leave this account's chats on the device.
      forgetSavedState()
      throw redirect({ to: "/login" })
    }
    keepViewer(viewer)
    return { viewer }
  },
  // Also what the server sends for this client-only route, so a cold launch paints the app's outline at once.
  pendingComponent: ShellSkeleton,
  pendingMinMs: 0,
  component: AppLayout
})

/** Fetches every page's code (and the UI renderer) once the app is idle, so a first visit doesn't wait on the network or parsing. */
function usePreloadPages() {
  const router = useRouter()
  useEffect(() => {
    const load = () => {
      for (const route of Object.values(router.routesById)) void router.loadRouteChunk(route)?.catch(() => undefined)
    }
    // The generative UI renderer is the biggest chunk (~1.4 MB): parse it a few seconds in, out of the way of the
    // first taps (Safari has no requestIdleCallback), rather than when a card first needs it.
    const renderer = setTimeout(() => void import("~/client/components/openui-block").catch(() => undefined), 4_000)
    if ("requestIdleCallback" in window) {
      const handle = requestIdleCallback(load, { timeout: 2_000 })
      return () => {
        cancelIdleCallback(handle)
        clearTimeout(renderer)
      }
    }
    const timer = setTimeout(load, 500)
    return () => {
      clearTimeout(timer)
      clearTimeout(renderer)
    }
  }, [router])
}

function AppLayout() {
  const { viewer } = Route.useRouteContext()
  const nav = useNavState()
  useVisualViewportHeight()
  useHaptics()
  usePreloadPages()
  useUpdateChecker()
  const { pathname } = useLocation()
  // Chat and Machine pages put the menu button in their own header.
  const inChat = useMatch({ from: "/_app/chat/$sessionId", shouldThrow: false }) !== undefined
  const ownHeader = inChat || pathname === "/machine" || pathname.startsWith("/machine/") || pathname === "/usage"

  // Picking a page closes the drawer; switching between the chats and settings sidebars keeps it open.
  const { closeDrawer, takeHold } = nav
  useEffect(() => {
    if (!takeHold()) closeDrawer()
  }, [pathname, closeDrawer, takeHold])

  return (
    <DexProvider viewer={viewer}>
      <NavContext.Provider value={nav}>
        {/* Edge to edge: status bar, notch, and home-indicator insets are padded here and in the drawer. */}
        <div className="dex-app flex h-[var(--app-height,100dvh)] overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
          <Sidebar />
          <main className="dex-main flex min-w-0 flex-1 flex-col">
            {!ownHeader && (
              <header className={`dex-chrome dex-topbar flex h-12 shrink-0 items-center gap-2 border-b border-zinc-900 px-4 ${nav.collapsed ? "" : "md:hidden"}`}>
                <MenuButton />
                <img src="/favicon.svg" alt="" className="size-6" />
                <span className="font-semibold tracking-tight">Dex</span>
                <Link to="/chat" title="New chat" className="ml-auto rounded-md p-1.5 text-zinc-400 hover:text-zinc-100">
                  <MessageSquarePlus className="size-5" />
                </Link>
              </header>
            )}
            <Outlet />
          </main>
        </div>
      </NavContext.Provider>
    </DexProvider>
  )
}
