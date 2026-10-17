import { createFileRoute, Link, Outlet, redirect, useLocation, useMatch } from "@tanstack/react-router"
import { MessageSquarePlus } from "lucide-react"
import { useEffect, useState } from "react"
import { Sidebar } from "~/client/components/sidebar"
import { DexProvider } from "~/client/lib/dex"
import { MenuButton, MobileNavContext } from "~/client/lib/mobile-nav"
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
  const [navOpen, setNavOpen] = useState(false)
  const { pathname } = useLocation()
  // Chat and Machine pages put the menu button in their own header.
  const inChat = useMatch({ from: "/_app/chat/$sessionId", shouldThrow: false }) !== undefined
  const ownHeader = inChat || pathname === "/machine"

  useEffect(() => setNavOpen(false), [pathname])

  return (
    <DexProvider viewer={viewer}>
      <MobileNavContext.Provider value={() => setNavOpen(true)}>
        <div className="flex h-dvh overflow-hidden">
          <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
          <main className="flex min-w-0 flex-1 flex-col">
            {!ownHeader && (
              <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-900 px-4 md:hidden">
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
      </MobileNavContext.Provider>
    </DexProvider>
  )
}
