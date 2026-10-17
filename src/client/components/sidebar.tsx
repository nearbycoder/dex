import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { FolderOpen, LogOut, MessageSquarePlus, Settings, Trash2, X } from "lucide-react"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, viewer, stub, connected } = useDex()
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const activeId = "sessionId" in params ? params.sessionId : undefined

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-full w-72 shrink-0 flex-col border-r border-zinc-900 bg-zinc-950 transition-transform duration-200 md:static md:w-64 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
      <div className="flex items-center gap-2 px-4 py-4">
        <img src="/favicon.svg" alt="" className="size-7 rounded-md" />
        <span className="font-semibold tracking-tight">Dex</span>
        <span
          className={`ml-auto size-2 rounded-full ${connected ? "bg-emerald-500" : "animate-pulse bg-amber-500"}`}
          title={connected ? "Connected to your agent" : "Connecting…"}
        />
        <button type="button" onClick={onClose} title="Close menu" className="-mr-1 rounded-md p-1 text-zinc-500 hover:text-zinc-200 md:hidden">
          <X className="size-5" />
        </button>
      </div>
      <div className="px-3">
        <Link
          to="/chat"
          className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
        >
          <MessageSquarePlus className="size-4" /> New chat
        </Link>
      </div>
      <nav className="scrollbar-thin mt-4 flex-1 space-y-0.5 overflow-y-auto px-3">
        <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-zinc-600 uppercase">Chats</div>
        {state?.sessions.length === 0 && <div className="px-2 py-1 text-xs text-zinc-600">No chats yet</div>}
        {state?.sessions.map((session) => (
          <div key={session.id} className="group relative">
            <Link
              to="/chat/$sessionId"
              params={{ sessionId: session.id }}
              className={`flex items-center gap-2 rounded-lg py-1.5 pr-8 pl-2 text-sm md:pr-2 ${
                session.id === activeId ? "bg-zinc-900 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
              }`}
            >
              {session.busy && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />}
              <span className="truncate">{session.title}</span>
              <span className="ml-auto hidden shrink-0 text-[10px] text-zinc-600 md:inline md:group-hover:hidden">{timeAgo(session.updatedAt)}</span>
            </Link>
            <button
              type="button"
              title="Delete chat"
              onClick={async () => {
                if (!confirm(`Delete “${session.title}”?`)) return
                await stub.deleteSession(session.id)
                if (session.id === activeId) void navigate({ to: "/chat" })
              }}
              className="absolute top-1.5 right-1.5 rounded p-0.5 text-zinc-500 hover:text-red-400 md:hidden md:group-hover:block"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </nav>
      <div className="space-y-0.5 border-t border-zinc-900 p-3">
        <Link
          to="/files"
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 [&.active]:bg-zinc-900 [&.active]:text-zinc-100"
        >
          <FolderOpen className="size-4" /> Workspace
        </Link>
        <Link
          to="/settings"
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 [&.active]:bg-zinc-900 [&.active]:text-zinc-100"
        >
          <Settings className="size-4" /> Settings
          {state && !state.cline.connected && <span className="ml-auto size-2 rounded-full bg-amber-500" />}
        </Link>
        <div className="flex items-center gap-2 px-2 pt-2">
          {viewer.avatarUrl ? (
            <img src={viewer.avatarUrl} alt="" className="size-6 rounded-full" />
          ) : (
            <div className="flex size-6 items-center justify-center rounded-full bg-zinc-800 text-xs">{viewer.name[0]}</div>
          )}
          <span className="truncate text-sm text-zinc-400">{viewer.login}</span>
          <form method="post" action="/auth/logout" className="ml-auto">
            <button type="submit" title="Sign out" className="rounded p-1 text-zinc-500 hover:text-zinc-200">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
      </aside>
    </>
  )
}
