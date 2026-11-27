import { useNavigate } from "@tanstack/react-router"
import {
  Bot,
  FileText,
  FolderKanban,
  KeyRound,
  Layers,
  LoaderCircle,
  MessageSquare,
  MessageSquarePlus,
  Monitor,
  Plug,
  Search,
  Settings,
  Sparkles,
  X
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useDexActions, useDexSelector } from "~/client/lib/dex"
import type { SearchHit, SearchKind } from "~/shared/search"

const KIND_ICON: Record<SearchKind, typeof MessageSquare> = {
  chat: MessageSquare,
  file: FileText,
  agent: Bot,
  space: Layers,
  sidekick: Sparkles,
  mcp: Plug
}

const KIND_LABEL: Record<SearchKind, string> = {
  chat: "Chat",
  file: "File",
  agent: "Agent",
  space: "Space",
  sidekick: "Sidekick",
  mcp: "MCP"
}

interface PaletteItem {
  readonly key: string
  readonly title: string
  readonly subtitle: string
  readonly snippet?: string
  readonly route: string
  readonly icon: typeof MessageSquare
  readonly badge: string
}

const QUICK_NAV: ReadonlyArray<PaletteItem> = [
  { key: "nav:new", title: "New chat", subtitle: "Start a fresh conversation", route: "/chat", icon: MessageSquarePlus, badge: "Action" },
  { key: "nav:files", title: "Workspace files", subtitle: "Browse and edit /workspace", route: "/files", icon: FileText, badge: "Page" },
  { key: "nav:mcp", title: "MCP servers", subtitle: "Manage connected tools & resources", route: "/mcp", icon: Plug, badge: "Page" },
  { key: "nav:agents", title: "Agents", subtitle: "Configure specialized agents", route: "/agents", icon: Bot, badge: "Page" },
  { key: "nav:projects", title: "Projects", subtitle: "Repositories and VM setup scripts", route: "/projects", icon: FolderKanban, badge: "Page" },
  { key: "nav:machine", title: "Machines", subtitle: "Cloud VMs & desktops", route: "/machine", icon: Monitor, badge: "Page" },
  { key: "nav:access", title: "Access & Webhooks", subtitle: "API tokens, inbound webhooks, audit log", route: "/access", icon: KeyRound, badge: "Page" },
  { key: "nav:settings", title: "Settings", subtitle: "Providers, defaults, and instructions", route: "/settings", icon: Settings, badge: "Page" }
]

export const openCommandPalette = () => window.dispatchEvent(new CustomEvent("dex:open-command-palette"))

/**
 * Global `⌘K` / `Ctrl+K` Command Palette combining instant local state navigation
 * with live Durable Object SQLite FTS5 search over workspace files and chat history.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const [remote, setRemote] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { stub } = useDexActions()
  const sessions = useDexSelector((s) => s?.sessions)
  const agents = useDexSelector((s) => s?.agents)
  const spaces = useDexSelector((s) => s?.spaces)
  const mcp = useDexSelector((s) => s?.mcp)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    const onCustom = () => setOpen(true)
    window.addEventListener("keydown", onKey)
    window.addEventListener("dex:open-command-palette", onCustom)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("dex:open-command-palette", onCustom)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setQuery("")
      setRemote([])
      setActive(0)
      return
    }
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  // Debounced SQLite FTS5 search in the Durable Object
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setRemote([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      stub
        .search(q, 20)
        .then((hits) => {
          if (!cancelled) setRemote(hits)
        })
        .catch(() => {
          if (!cancelled) setRemote([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query, stub])

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      const recent: PaletteItem[] = (sessions ?? []).slice(0, 6).map((session) => ({
        key: `chat:${session.id}`,
        title: session.title,
        subtitle: session.lastReply || session.model,
        route: `/chat/${session.id}`,
        icon: MessageSquare,
        badge: "Recent"
      }))
      return [...recent, ...QUICK_NAV]
    }
    const seen = new Set<string>()
    const out: PaletteItem[] = []
    const push = (item: PaletteItem) => {
      if (seen.has(item.route)) return
      seen.add(item.route)
      out.push(item)
    }
    // Live FTS5 hits first (includes workspace file body matches!)
    for (const hit of remote) {
      push({
        key: `fts:${hit.kind}:${hit.id}`,
        title: hit.title,
        subtitle: hit.subtitle,
        snippet: hit.snippet,
        route: hit.route,
        icon: KIND_ICON[hit.kind] ?? Search,
        badge: KIND_LABEL[hit.kind] ?? hit.kind
      })
    }
    // Instant local matches while FTS5 is in flight
    for (const nav of QUICK_NAV) {
      if (nav.title.toLowerCase().includes(q) || nav.subtitle.toLowerCase().includes(q)) push(nav)
    }
    for (const session of sessions ?? []) {
      if (session.title.toLowerCase().includes(q) || (session.lastReply ?? "").toLowerCase().includes(q)) {
        push({
          key: `local:chat:${session.id}`,
          title: session.title,
          subtitle: session.model,
          snippet: session.lastReply ?? undefined,
          route: `/chat/${session.id}`,
          icon: MessageSquare,
          badge: "Chat"
        })
      }
    }
    for (const space of spaces ?? []) {
      if (space.name.toLowerCase().includes(q) || space.goal.toLowerCase().includes(q)) {
        push({ key: `local:space:${space.id}`, title: space.name, subtitle: space.goal || "Space", route: `/chat/${space.sessionId}`, icon: Layers, badge: "Space" })
      }
    }
    for (const agent of agents ?? []) {
      if (agent.name.toLowerCase().includes(q) || agent.description.toLowerCase().includes(q)) {
        push({ key: `local:agent:${agent.id}`, title: agent.name, subtitle: agent.description || agent.model, route: `/agents/${agent.id}`, icon: Bot, badge: "Agent" })
      }
    }
    for (const server of mcp ?? []) {
      if (server.name.toLowerCase().includes(q) || server.tools.some((t) => t.name.toLowerCase().includes(q))) {
        push({ key: `local:mcp:${server.id}`, title: server.name, subtitle: `${server.tools.length} tools`, route: `/mcp/${server.id}`, icon: Plug, badge: "MCP" })
      }
    }
    return out.slice(0, 20)
  }, [query, remote, sessions, agents, spaces, mcp])

  useEffect(() => {
    setActive((prev) => (items.length ? Math.min(prev, items.length - 1) : 0))
  }, [items.length])

  const pick = (item: PaletteItem) => {
    setOpen(false)
    const qIndex = item.route.indexOf("?")
    if (qIndex !== -1) {
      const to = item.route.slice(0, qIndex)
      const search = Object.fromEntries(new URLSearchParams(item.route.slice(qIndex + 1)))
      void navigate({ to: to as never, search: search as never })
      return
    }
    void navigate({ to: item.route as never })
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[12vh] backdrop-blur-xs"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-xl animate-pop overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/70"
      >
        <div className="flex items-center gap-2.5 border-b border-zinc-800/90 px-4 py-3">
          {searching ? <LoaderCircle className="size-4 shrink-0 animate-spin text-emerald-400" /> : <Search className="size-4 shrink-0 text-zinc-500" />}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                setOpen(false)
              } else if (event.key === "ArrowDown") {
                event.preventDefault()
                setActive((i) => (items.length ? (i + 1) % items.length : 0))
              } else if (event.key === "ArrowUp") {
                event.preventDefault()
                setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0))
              } else if (event.key === "Enter" && items[active]) {
                event.preventDefault()
                pick(items[active]!)
              }
            }}
            placeholder="Search chats, workspace files, MCP tools, agents…"
            className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200">
            <X className="size-4" />
          </button>
        </div>
        <div className="scrollbar-thin max-h-[60vh] overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-zinc-500">No matches for “{query.trim()}”.</p>
          ) : (
            items.map((item, index) => {
              const Icon = item.icon
              const selected = index === active
              return (
                <button
                  key={item.key}
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(item)}
                  className={`flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                    selected ? "bg-zinc-900 text-zinc-100" : "text-zinc-300 hover:bg-zinc-900/60"
                  }`}
                >
                  <Icon className={`mt-0.5 size-4 shrink-0 ${selected ? "text-emerald-400" : "text-zinc-500"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{item.title}</span>
                      <span className="ml-auto shrink-0 rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-400">{item.badge}</span>
                    </div>
                    {item.snippet ? (
                      <p className="mt-0.5 truncate text-xs text-zinc-400">{item.snippet}</p>
                    ) : (
                      <p className="mt-0.5 truncate text-xs text-zinc-500">{item.subtitle}</p>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
        <div className="flex items-center justify-between border-t border-zinc-900 px-3.5 py-2 text-[11px] text-zinc-500">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span className="font-mono">⌘K</span>
        </div>
      </div>
    </div>
  )
}
