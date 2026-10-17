import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { Sidebar } from "~/client/components/sidebar"
import { DexProvider } from "~/client/lib/dex"
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
  return (
    <DexProvider viewer={viewer}>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
    </DexProvider>
  )
}
