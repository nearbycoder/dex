import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router"
import {
  AlarmClock,
  BarChart3,
  Bell,
  Bot,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Drama,
  FolderGit2,
  FolderOpen,
  KeyRound,
  LockKeyhole,
  LogOut,
  MessageSquarePlus,
  Monitor,
  PanelLeftClose,
  Plug,
  Plus,
  Settings,
  Sparkles,
  SlidersHorizontal,
  X
} from "lucide-react"
import { type ReactNode, type TouchEvent, useEffect, useRef, useState } from "react"
import { forgetSavedState, useDex } from "~/client/lib/dex"
import { haptic } from "~/client/lib/haptics"
import { timeAgo } from "~/client/lib/format"
import { useNav } from "~/client/lib/mobile-nav"
import { UpdateButton } from "~/client/lib/updates"
import { findModel } from "~/shared/models"
import { lookPng } from "~/client/lib/sidekick-art"
import { AGENT_COLORS } from "~/shared/agents"
import type { CharacterProfile } from "~/shared/characters"
import { connectedProviders, type SessionMeta } from "~/shared/protocol"
import { AgentAvatar, CharacterAvatar } from "./agent-avatar"
import { mcpNeedsAttention } from "./mcp-picker"
import { ModelLogo } from "./model-logo"
import { inboxState, SessionMenu, type SessionMenuHandle, snoozedLabel, useNaming } from "./session-menu"
import { ChatListSkeleton } from "./skeleton"
import { useNow } from "./vm-status"

/** Configuration pages: on these the sidebar shows the settings links instead of the chats. */
const SETTINGS_AREA = ["/settings", "/notifications", "/machine", "/projects", "/agents", "/sidekicks", "/skills", "/secrets", "/mcp", "/files", "/usage", "/access"]
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

/** Unread chats in the tab's title and on the installed app's icon. */
function useUnreadBadge(count: number) {
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "")
    document.title = count ? `(${count}) ${base}` : base
    const nav = navigator as Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    void (count ? nav.setAppBadge?.(count) : nav.clearAppBadge?.())?.catch(() => undefined)
  }, [count])
}

export function Sidebar() {
  const { drawerOpen: open, closeDrawer: onClose, collapsed, toggleCollapsed, holdOpen } = useNav()
  const { state, viewer, connected } = useDex()
  useUnreadBadge(state?.sessions.filter((session) => session.unread).length ?? 0)
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
  // No model subscription at all: nothing can answer.
  const clineMissing = state ? !Object.values(connectedProviders(state)).some(Boolean) : false

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
    {
      to: "/settings",
      label: "General",
      icon: <SlidersHorizontal className="size-4" />,
      hint: clineMissing && <Hint dot="bg-amber-500" title="Connect a model subscription" />
    },
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
    { to: "/sidekicks", label: "Sidekicks", icon: <Drama className="size-4" />, hint: <Hint count={state?.characters.length} /> },
    { to: "/skills", label: "Skills", icon: <Sparkles className="size-4" /> },
    {
      to: "/mcp",
      label: "MCP servers",
      icon: <Plug className="size-4" />,
      hint: mcpAttention && <Hint dot="bg-amber-500" title="A server needs attention" />
    },
    { to: "/secrets", label: "Secrets", icon: <LockKeyhole className="size-4" /> },
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
              {state && <Characters characters={state.characters} sessions={state.sessions} activeId={activeId} onPick={onClose} />}
              <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-zinc-600 uppercase">Chats</div>
              {!state && <ChatListSkeleton />}
              {state && (
                <ChatGroups
                  // A character's conversations live under them, not in the inbox.
                  sessions={state.sessions.filter((session) => !session.characterId)}
                  activeId={activeId}
                  onPick={onClose}
                  renderRow={(session, group) => (
                    <ChatRow key={session.id} session={session} group={group} active={session.id === activeId} onPick={onClose} />
                  )}
                />
              )}
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
                (clineMissing || mcpAttention) && <Hint dot="bg-amber-500" title={clineMissing ? "Connect a model subscription" : "A server needs attention"} />
              )}
              <ChevronRight className={`size-4 text-zinc-600 ${running > 0 || clineMissing || mcpAttention ? "" : "ml-auto"}`} />
            </button>
          )}
          <UpdateButton />
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

/** Sidekicks whose picture this page is drawing, so each is drawn once. */
const snapshotting = new Set<string>()

/**
 * Sidekicks, pinned above the chats: each opens their conversation. Shown once you have one; until then a single
 * quiet row offers to make one.
 */
function Characters({
  characters,
  sessions,
  activeId,
  onPick
}: {
  characters: ReadonlyArray<CharacterProfile>
  sessions: ReadonlyArray<SessionMeta>
  activeId: string | undefined
  onPick: () => void
}) {
  const { stub } = useDex()
  // A look set from a chat or over MCP has no picture yet for the apps, which show pictures rather than draw looks:
  // the first page that sees one draws and saves it.
  useEffect(() => {
    for (const character of characters) {
      if (!character.look || character.image || snapshotting.has(character.id)) continue
      snapshotting.add(character.id)
      void lookPng(character.look, (AGENT_COLORS[character.color] ?? AGENT_COLORS.violet)[0])
        .then((image) => stub.saveCharacter({ ...character, image }))
        .catch(() => undefined)
    }
  }, [characters, stub])
  const header = (
    <div className="flex items-center px-2 pb-1">
      <span className="text-[11px] font-medium tracking-wide text-zinc-600 uppercase">Sidekicks</span>
      <Link
        to="/sidekicks/$characterId"
        params={{ characterId: "new" }}
        onClick={onPick}
        title="New sidekick"
        aria-label="New sidekick"
        className="-my-1 -mr-1 ml-auto rounded-md p-1 text-zinc-600 hover:bg-zinc-900 hover:text-zinc-200"
      >
        <Plus className="size-3.5" />
      </Link>
    </div>
  )
  if (characters.length === 0) {
    return (
      <div className="mb-4">
        {header}
        <Link
          to="/sidekicks/$characterId"
          params={{ characterId: "new" }}
          onClick={onPick}
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-300"
        >
          <span className="flex size-7 items-center justify-center rounded-full border border-dashed border-zinc-700">
            <Plus className="size-3.5" />
          </span>
          Make a sidekick to talk to
        </Link>
      </div>
    )
  }
  const byId = new Map(sessions.map((session) => [session.id, session]))
  return (
    <div className="mb-4">
      {header}
      {characters.map((character) => {
        const session = byId.get(character.sessionId)
        const active = activeId !== undefined && byId.get(activeId)?.characterId === character.id
        // Something they said that you haven't seen (not while you're looking at it).
        const unread = Boolean(session?.unread) && !active
        return (
          <Link
            key={character.id}
            to="/chat/$sessionId"
            params={{ sessionId: character.sessionId }}
            onClick={onPick}
            className={`flex animate-fade items-center gap-2.5 rounded-lg px-2.5 py-1.5 ${active ? "bg-zinc-900 text-zinc-100" : "text-zinc-300 hover:bg-zinc-900/60 hover:text-zinc-100"}`}
          >
            <span className="relative shrink-0">
              <CharacterAvatar character={character} size={28} />
              {session?.busy && <span className="absolute -right-0.5 -bottom-0.5 size-2.5 animate-pulse rounded-full bg-emerald-500 ring-2 ring-zinc-950" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className={`truncate text-sm ${unread ? "font-semibold text-zinc-50" : ""}`}>{character.name}</span>
                {session && !session.busy && (
                  <span className={`ml-auto shrink-0 text-[11px] ${unread ? "text-sky-300" : "text-zinc-600"}`} title={new Date(session.updatedAt).toLocaleString()}>
                    {session.updatedAt > session.createdAt + 1_000 ? timeAgo(session.updatedAt) : ""}
                  </span>
                )}
              </span>
              <span className={`block truncate text-[11px] ${session?.busy ? "text-emerald-400" : unread ? "text-zinc-300" : "text-zinc-500"}`}>
                {session?.busy ? "typing…" : unread && session?.lastReply ? session.lastReply : character.tagline || "Say hi"}
              </span>
            </span>
            {unread && <span className="size-2 shrink-0 rounded-full bg-sky-400" aria-label="Unread" />}
          </Link>
        )
      })}
    </div>
  )
}

/** One chat in the sidebar: title, its agent / project / model, and when it last did something (or when it wakes). */
function ChatRow({ session, group, active, onPick }: { session: SessionMeta; group: ChatGroup; active: boolean; onPick: () => void }) {
  const { state } = useDex()
  const naming = useNaming(session.id)
  const menu = useRef<SessionMenuHandle>(null)
  const press = useLongPress((x, y) => menu.current?.openAt(x, y))
  if (!state) return null
  return (
    <div className="group relative animate-fade">
      <Link
        to="/chat/$sessionId"
        params={{ sessionId: session.id }}
        {...press.handlers}
        onClick={(event) => {
          // The tap that ends a long press opened the menu; it doesn't open the chat too.
          if (press.consume()) {
            event.preventDefault()
            return
          }
          onPick()
        }}
        // Right-click (and Android's long press) opens the chat's menu instead of the browser's.
        onContextMenu={(event) => {
          event.preventDefault()
          menu.current?.openAt(event.clientX, event.clientY)
        }}
        // No iOS link preview or text selection on a long press.
        style={{ WebkitTouchCallout: "none" }}
        className={`block rounded-lg py-2 pr-8 pl-2.5 select-none [@media(hover:none)]:pr-2.5 ${
          active
            ? "bg-zinc-900 text-zinc-100"
            : group === "settled"
              ? "text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-200"
              : "text-zinc-300 hover:bg-zinc-900/60 hover:text-zinc-100"
        }`}
      >
        <div className="flex items-center gap-2">
          <div className={`truncate text-sm ${naming ? "animate-pulse text-zinc-400" : session.unread && !active ? "font-semibold text-zinc-50" : ""}`}>{session.title}</div>
          {session.unread && !active && <span className="ml-auto size-2 shrink-0 rounded-full bg-sky-400" aria-label="Unread" />}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
          {(() => {
            const agent = session.agentId ? state.agents.find((candidate) => candidate.id === session.agentId) : undefined
            const project = session.projectId ? state.projects.find((candidate) => candidate.id === session.projectId) : undefined
            return project ? (
              <>
                <AgentAvatar icon={project.icon} color={project.color} image={project.image} size={14} />
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
          ) : group === "snoozed" && session.snoozedUntil ? (
            <span className="flex shrink-0 items-center gap-1 text-sky-300/80" title={new Date(session.snoozedUntil).toLocaleString()}>
              <AlarmClock className="size-3" /> {snoozedLabel(session.snoozedUntil)}
            </span>
          ) : (
            <span className="shrink-0" title={new Date(session.updatedAt).toLocaleString()}>
              {timeAgo(session.updatedAt)}
            </span>
          )}
        </div>
      </Link>
      {/* On touch screens a long press opens it, so the row gets the room the button took. */}
      <SessionMenu
        session={session}
        handle={menu}
        className="absolute top-1/2 right-1.5 -translate-y-1/2 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:aria-expanded:opacity-100 [@media(hover:none)]:hidden"
      />
    </div>
  )
}

/**
 * A press held still for about half a second on a touch screen calls `onLongPress` where the finger is. Moving
 * (scrolling the list) cancels it. `consume()` tells the click that follows a long press to do nothing.
 */
function useLongPress(onLongPress: (x: number, y: number) => void, ms = 450) {
  const state = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean }>({ timer: null, x: 0, y: 0, fired: false })
  const cancel = () => {
    if (state.current.timer) clearTimeout(state.current.timer)
    state.current.timer = null
  }
  useEffect(() => cancel, [])
  return {
    consume: () => {
      const fired = state.current.fired
      state.current.fired = false
      return fired
    },
    handlers: {
      onTouchStart: (event: TouchEvent) => {
        const touch = event.touches[0]
        if (!touch || event.touches.length > 1) return cancel()
        cancel()
        state.current = { timer: null, x: touch.clientX, y: touch.clientY, fired: false }
        state.current.timer = setTimeout(() => {
          state.current.timer = null
          state.current.fired = true
          haptic()
          onLongPress(state.current.x, state.current.y)
        }, ms)
      },
      onTouchMove: (event: TouchEvent) => {
        const touch = event.touches[0]
        if (touch && Math.hypot(touch.clientX - state.current.x, touch.clientY - state.current.y) > 10) cancel()
      },
      onTouchEnd: cancel,
      onTouchCancel: cancel
    }
  }
}

type ChatGroup = "inbox" | "snoozed" | "settled"

/** Remembers whether a group is open, per device. */
function useGroupOpen(name: string) {
  const key = `dex.sidebar.${name}`
  const [open, setOpen] = useState(() => typeof localStorage !== "undefined" && localStorage.getItem(key) === "1")
  return [open, (value: boolean) => (setOpen(value), localStorage.setItem(key, value ? "1" : "0"))] as const
}

function GroupHeader({ label, count, open, onToggle, icon }: { label: string; count: number; open: boolean; onToggle: () => void; icon: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="mt-3 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium tracking-wide text-zinc-600 uppercase hover:text-zinc-300"
    >
      <ChevronRight className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} />
      {icon}
      {label}
      <span className="ml-auto font-normal tracking-normal text-zinc-600 normal-case">{count}</span>
    </button>
  )
}

/**
 * The chat list as an inbox: chats needing you first, then Snoozed (until each one's time) and Settled (done for
 * now), both collapsible. A chat leaves those groups by itself when something new happens in it or its snooze ends.
 */
function ChatGroups({
  sessions,
  activeId,
  renderRow
}: {
  sessions: ReadonlyArray<SessionMeta>
  activeId: string | undefined
  onPick: () => void
  renderRow: (session: SessionMeta, group: ChatGroup) => ReactNode
}) {
  const now = useNow(30_000)
  const [snoozedOpen, setSnoozedOpen] = useGroupOpen("snoozed")
  const [settledOpen, setSettledOpen] = useGroupOpen("settled")
  const inbox = sessions.filter((session) => inboxState(session, now) === "inbox")
  const snoozed = sessions.filter((session) => inboxState(session, now) === "snoozed").sort((a, b) => (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0))
  const settled = sessions.filter((session) => inboxState(session, now) === "settled").sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0))
  // The open chat stays visible even if its group is collapsed.
  const showSnoozed = snoozedOpen || snoozed.some((session) => session.id === activeId)
  const showSettled = settledOpen || settled.some((session) => session.id === activeId)

  return (
    <>
      {sessions.length === 0 ? (
        <div className="px-2 py-1 text-xs text-zinc-600">No chats yet</div>
      ) : inbox.length === 0 ? (
        <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-600">
          <CheckCheck className="size-3.5" /> All caught up
        </div>
      ) : (
        inbox.map((session) => renderRow(session, "inbox"))
      )}
      {snoozed.length > 0 && (
        <>
          <GroupHeader
            label="Snoozed"
            count={snoozed.length}
            open={showSnoozed}
            onToggle={() => setSnoozedOpen(!showSnoozed)}
            icon={<AlarmClock className="size-3" />}
          />
          {showSnoozed && snoozed.map((session) => renderRow(session, "snoozed"))}
        </>
      )}
      {settled.length > 0 && (
        <>
          <GroupHeader
            label="Settled"
            count={settled.length}
            open={showSettled}
            onToggle={() => setSettledOpen(!showSettled)}
            icon={<CheckCheck className="size-3" />}
          />
          {showSettled && settled.map((session) => renderRow(session, "settled"))}
        </>
      )}
    </>
  )
}
