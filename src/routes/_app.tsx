import { createFileRoute, Link, Outlet, redirect, useLocation, useMatch } from "@tanstack/react-router"
import { MessageSquarePlus } from "lucide-react"
import { useEffect } from "react"
import { Sidebar } from "~/client/components/sidebar"
import { DexProvider } from "~/client/lib/dex"
import { MenuButton, NavContext, useNavState, useVisualViewportHeight } from "~/client/lib/mobile-nav"
import { useHaptics } from "~/client/lib/haptics"
import { getViewer } from "~/server/viewer"

/** Signed-in shell. Client-rendered: it holds the WebSocket to the user's agent. */
export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async () => {
    const { viewer } = await getViewer()
    if (!viewer) throw redirect({ to: "/login" })
    return { viewer }
  },
  component: AppLayout
})

function AppLayout() {
  const { viewer } = Route.useRouteContext()
  const nav = useNavState()
  useVisualViewportHeight()
  useHaptics()
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
