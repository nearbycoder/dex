import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router"
import {
  BarChart3,
  Bell,
  Bot,
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  FolderOpen,
  KeyRound,
  LogOut,
  MessageSquarePlus,
  Monitor,
  PanelLeftClose,
  Plug,
  Settings,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { forgetSavedState, useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import { useNav } from "~/client/lib/mobile-nav"
import { findModel } from "~/shared/models"
import { AgentAvatar } from "./agent-avatar"
import { mcpNeedsAttention } from "./mcp-picker"
import { ModelLogo } from "./model-logo"
import { Bone } from "./skeleton"

/** Configuration pages: on these the sidebar shows the settings links instead of the chats. */
const SETTINGS_AREA = ["/settings", "/notifications", "/machine", "/projects", "/agents", "/mcp", "/files", "/usage", "/access"]
const inSettingsArea = (pathname: string) => SETTINGS_AREA.some((path) => pathname === path || pathname.startsWith(`${path}/`))

const linkClass =
  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 [&.active]:bg-zinc-900 [&.active]:text-zinc-100"

/** A settings link's trailing hint: a count, a status dot, or both. */
function Hint({ count, dot, title }: { count?: number; dot?: string; title?: string }) {
  if (!count && !dot) return null
  return (
    <span className="ml-auto flex items-center gap-1.5 text-[11px] text-zinc-500" title={title}>
      {count ? count : null}
      {dot && <span className={`size-2 rounded-full ${dot}`} />}
    </span>
  )
}

export function Sidebar() {
  const { drawerOpen: open, closeDrawer: onClose, collapsed, toggleCollapsed, holdOpen } = useNav()
  const { state, viewer, stub, connected } = useDex()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const params = useParams({ strict: false })
  const activeId = "sessionId" in params ? params.sessionId : undefined
  const settingsMode = inSettingsArea(pathname)
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  // Where "Chats" goes back to: the chat you were last in.
  const lastChat = useRef<string | null>(null)
  if (activeId) lastChat.current = activeId

  const running = state?.vms.filter((vm) => vm.status === "running").length ?? 0
  const vmChanging = state?.vms.some((vm) => vm.status === "starting" || vm.status === "stopping") ?? false
  const mcpAttention = state?.mcp.some(mcpNeedsAttention) ?? false
  const clineMissing = state ? !state.cline.connected : false

  // Switching sidebars keeps the phone drawer open, so you can go on from there.
  const openSettings = () => {
    holdOpen()
    void navigate({ to: "/settings" })
  }
  const backToChats = () => {
    holdOpen()
    const chat = lastChat.current && state?.sessions.some((session) => session.id === lastChat.current) ? lastChat.current : null
    void (chat ? navigate({ to: "/chat/$sessionId", params: { sessionId: chat } }) : navigate({ to: "/chat" }))
  }

  const waiting = state?.access.pending.filter((action) => action.status === "pending" && Date.now() - action.createdAt < 3_600_000).length ?? 0

  const settingsLinks: Array<{ to: string; label: string; icon: ReactNode; hint?: ReactNode; show?: boolean }> = [
    { to: "/settings", label: "General", icon: <SlidersHorizontal className="size-4" />, hint: clineMissing && <Hint dot="bg-amber-500" title="Connect ClinePass" /> },
    { to: "/notifications", label: "Notifications", icon: <Bell className="size-4" /> },
    {
      to: "/machine",
      label: "Machines",
      icon: <Monitor className="size-4" />,
      show: state?.vmConfigured ?? false,
      hint: (running > 0 || vmChanging) && (
        <Hint
          count={running}
          dot={vmChanging ? "animate-pulse bg-amber-500" : running ? "bg-emerald-500" : "bg-zinc-700"}
          title={`${running} running of ${state?.vms.length ?? 0}`}
        />
      )
    },
    { to: "/projects", label: "Projects", icon: <FolderGit2 className="size-4" /> },
    { to: "/agents", label: "Agents", icon: <Bot className="size-4" /> },
    { to: "/mcp", label: "MCP servers", icon: <Plug className="size-4" />, hint: mcpAttention && <Hint dot="bg-amber-500" title="A server needs attention" /> },
    { to: "/files", label: "Workspace", icon: <FolderOpen className="size-4" /> },
    { to: "/usage", label: "Usage", icon: <BarChart3 className="size-4" /> },
    {
      to: "/access",
      label: "Access & API",
      icon: <KeyRound className="size-4" />,
      hint: waiting > 0 && <Hint count={waiting} dot="bg-amber-500" title={`${waiting} waiting for your confirmation`} />
    }
  ]

  return (
    <>
      {/* Always rendered so it can fade in and out with the drawer. */}
      <div
        className={`fixed inset-0 z-30 bg-black/60 transition-opacity duration-300 ease-fluid md:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`dex-sidebar dex-chrome fixed inset-y-0 left-0 z-40 flex h-full w-[min(18rem,85vw)] shrink-0 flex-col border-r border-zinc-900 bg-zinc-950 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] shadow-2xl shadow-black/60 transition-transform duration-300 ease-fluid md:static md:w-64 md:translate-x-0 md:pt-0 md:pl-0 md:shadow-none lg:w-72 ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "md:hidden" : ""}`}
      >
      <div className="flex items-center gap-2 px-4 py-4">
        <img src="/favicon.svg" alt="" className="size-7" />
        <span className="font-semibold tracking-tight">Dex</span>
        <span
          className={`ml-auto size-2 rounded-full ${connected ? "bg-emerald-500" : "animate-pulse bg-amber-500"}`}
          title={connected ? "Connected to your agent" : "Connecting…"}
        />
        <button type="button" onClick={onClose} title="Close menu" className="-mr-1 rounded-md p-1 text-zinc-500 hover:text-zinc-200 md:hidden">
          <X className="size-5" />
        </button>
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Hide sidebar (⌘B)"
          className="dex-collapse -mr-1 hidden rounded-md p-1 text-zinc-500 hover:text-zinc-200 md:block"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      {settingsMode ? (
        // Settings: links to every configuration page, and a way back to the chats.
        <div key="settings" className="flex min-h-0 flex-1 animate-fade flex-col">
          <div className="px-3">
            <button
              type="button"
              onClick={backToChats}
              className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
            >
              <ChevronLeft className="size-4" /> Chats
            </button>
          </div>
          <nav className="scrollbar-thin mt-4 flex-1 space-y-0.5 overflow-y-auto px-3">
            <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-zinc-600 uppercase">Settings</div>
            {settingsLinks
              .filter((link) => link.show !== false)
              .map((link) => (
                <Link key={link.to} to={link.to} activeOptions={{ exact: link.to === "/settings" }} onClick={onClose} className={linkClass}>
                  {link.icon} {link.label}
                  {link.hint}
                </Link>
              ))}
          </nav>
        </div>
      ) : (
        <div key="chats" className="flex min-h-0 flex-1 animate-fade flex-col">
          <div className="px-3">
            <Link
              to="/chat"
              onClick={onClose}
              className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
            >
              <MessageSquarePlus className="size-4" /> New chat
            </Link>
          </div>
          <nav className="scrollbar-thin mt-4 flex-1 space-y-0.5 overflow-y-auto px-3">
            <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-zinc-600 uppercase">Chats</div>
          {!state &&
            [82, 64, 74, 56, 70].map((width, index) => (
              <div key={index} className="px-2 py-2">
                <Bone className="h-3.5" style={{ width: `${width}%` }} />
              </div>
            ))}
          {state?.sessions.length === 0 && <div className="px-2 py-1 text-xs text-zinc-600">No chats yet</div>}
          {state?.sessions.map((session) => (
            <div key={session.id} className="group relative animate-fade">
              <Link
                to="/chat/$sessionId"
                params={{ sessionId: session.id }}
                onClick={onClose}
                className={`block rounded-lg py-2 pr-8 pl-2.5 ${
                  session.id === activeId ? "bg-zinc-900 text-zinc-100" : "text-zinc-300 hover:bg-zinc-900/60 hover:text-zinc-100"
                }`}
              >
                <div className="truncate text-sm">{session.title}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
                  {(() => {
                    const agent = session.agentId ? state.agents.find((candidate) => candidate.id === session.agentId) : undefined
                    const project = session.projectId ? state.projects.find((candidate) => candidate.id === session.projectId) : undefined
                    return project ? (
                      <>
                        <AgentAvatar icon={project.icon} color={project.color} size={14} />
                        <span className="max-w-24 shrink-0 truncate text-zinc-400">{project.name}</span>
                        {agent && <span className="truncate text-zinc-500">· {agent.name}</span>}
                      </>
                    ) : agent ? (
                      <>
                        <AgentAvatar icon={agent.icon} color={agent.color} size={14} />
                        <span className="shrink-0 text-zinc-400">{agent.name}</span>
                        <span className="text-zinc-700">·</span>
                        <span className="truncate">{findModel(session.model)?.name ?? session.model}</span>
                      </>
                    ) : (
                      <>
                        <ModelLogo modelId={session.model} className="size-3.5" />
                        <span className="truncate">{findModel(session.model)?.name ?? session.model}</span>
                      </>
                    )
                  })()}
                  <span className="text-zinc-700">·</span>
                  {session.busy ? (
                    <span className="flex shrink-0 items-center gap-1 text-emerald-400">
                      <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" /> working
                    </span>
                  ) : (
                    <span className="shrink-0" title={new Date(session.updatedAt).toLocaleString()}>
                      {timeAgo(session.updatedAt)}
                    </span>
                  )}
                </div>
              </Link>
              <button
                type="button"
                title="Delete chat"
                onClick={async () => {
                  if (!confirm(`Delete “${session.title}”?`)) return
                  await stub.deleteSession(session.id)
                  if (session.id === activeId) void navigate({ to: "/chat" })
                }}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-red-400 md:hidden md:group-hover:block"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          </nav>
        </div>
      )}
      <div className="space-y-0.5 border-t border-zinc-900 p-3">
        {!settingsMode && (
          <button type="button" onClick={openSettings} className={`${linkClass} w-full`}>
            <Settings className="size-4" /> Settings
            {running > 0 ? (
              <Hint count={running} dot="bg-emerald-500" title={`${running} VM${running === 1 ? "" : "s"} running`} />
            ) : (
              (clineMissing || mcpAttention) && <Hint dot="bg-amber-500" title={clineMissing ? "Connect ClinePass" : "A server needs attention"} />
            )}
            <ChevronRight className={`size-4 text-zinc-600 ${running > 0 || clineMissing || mcpAttention ? "" : "ml-auto"}`} />
          </button>
        )}
        <div className="flex items-center gap-2 px-2 pt-2">
          {viewer.avatarUrl ? (
            <img src={viewer.avatarUrl} alt="" className="size-6 rounded-full" />
          ) : (
            <div className="flex size-6 items-center justify-center rounded-full bg-zinc-800 text-xs">{viewer.name[0]}</div>
          )}
          <span className="truncate text-sm text-zinc-400">{viewer.login}</span>
          <form method="post" action="/auth/logout" onSubmit={forgetSavedState} className="ml-auto">
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
