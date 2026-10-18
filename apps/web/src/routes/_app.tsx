import { createFileRoute, Link, Outlet, redirect, useLocation, useMatch, useRouter } from "@tanstack/react-router"
import { MessageSquarePlus } from "lucide-react"
import { useEffect } from "react"
import { Sidebar } from "~/client/components/sidebar"
import { ShellSkeleton } from "~/client/components/skeleton"
import { DexProvider, forgetSavedState } from "~/client/lib/dex"
import { MenuButton, NavContext, useNavState, useVisualViewportHeight } from "~/client/lib/mobile-nav"
import { useHaptics } from "~/client/lib/haptics"
import { useUpdateChecker } from "~/client/lib/updates"
import { getViewer, type ViewerResult } from "~/server/viewer"

/**
 * Who is signed in, asked once per page load rather than on every navigation (`beforeLoad` runs on each one).
 * The agent's WebSocket checks the session cookie on every connection anyway, and signing out reloads the page.
 */
let signedIn: Promise<ViewerResult> | undefined

/** Signed-in shell. Client-rendered: it holds the WebSocket to the user's agent. */
export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async () => {
    signedIn ??= getViewer()
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
    return { viewer }
  },
  // Also what the server sends for this client-only route, so a cold launch paints the app's outline at once.
  pendingComponent: ShellSkeleton,
  pendingMinMs: 0,
  component: AppLayout
})

/** Fetches every page's code once the app is idle, so the first visit to a page doesn't wait on the network. */
function usePreloadPages() {
  const router = useRouter()
  useEffect(() => {
    const load = () => {
      for (const route of Object.values(router.routesById)) void router.loadRouteChunk(route)?.catch(() => undefined)
    }
    if ("requestIdleCallback" in window) {
      const handle = requestIdleCallback(load, { timeout: 2_000 })
      return () => cancelIdleCallback(handle)
    }
    const timer = setTimeout(load, 500)
    return () => clearTimeout(timer)
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
