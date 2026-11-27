import { Database, FileText, FolderKanban, MessageSquare } from "lucide-react"
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react"
import { useDexActions, useDexSelector } from "~/client/lib/dex"
import type { WorkspaceFile } from "~/shared/protocol"

export interface MentionMenuHandle {
  onKeyDown(event: React.KeyboardEvent): boolean
}

interface MentionOption {
  readonly key: string
  readonly label: string
  readonly subtitle: string
  readonly insert: string
  readonly icon: typeof FileText
  readonly badge: string
}

/**
 * `@` context mention popover for the composer: lets users pull Workspace files,
 * connected MCP resources, Projects, and other Chats straight into a prompt.
 */
export const MentionMenu = forwardRef<
  MentionMenuHandle,
  {
    query: string
    onPick: (insert: string) => void
    onClose: () => void
  }
>(function MentionMenu({ query, onPick, onClose }, ref) {
  const { stub } = useDexActions()
  const mcp = useDexSelector((s) => s?.mcp)
  const projects = useDexSelector((s) => s?.projects)
  const sessions = useDexSelector((s) => s?.sessions)
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    let cancelled = false
    stub
      .listFiles()
      .then((list) => {
        if (!cancelled) setFiles(list)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [stub])

  const options = useMemo<MentionOption[]>(() => {
    const q = query.trim().toLowerCase()
    const all: MentionOption[] = []

    for (const server of mcp ?? []) {
      for (const resource of server.resources ?? []) {
        all.push({
          key: `mcp:${server.id}:${resource.uri}`,
          label: resource.name || resource.uri,
          subtitle: `${server.name} · ${resource.uri}`,
          insert: `@mcp:${server.prefix}:${resource.uri}`,
          icon: Database,
          badge: server.name
        })
      }
    }
    for (const file of files) {
      const rel = file.path.replace(/^\/workspace\//, "")
      all.push({
        key: `file:${file.path}`,
        label: rel,
        subtitle: file.path,
        insert: `@file:${file.path}`,
        icon: FileText,
        badge: "File"
      })
    }
    for (const project of projects ?? []) {
      all.push({
        key: `proj:${project.id}`,
        label: project.name,
        subtitle: project.repos.map((r) => r.url).join(", ") || "Project",
        insert: `@project:${project.name}`,
        icon: FolderKanban,
        badge: "Project"
      })
    }
    for (const session of (sessions ?? []).slice(0, 12)) {
      all.push({
        key: `chat:${session.id}`,
        label: session.title,
        subtitle: `Chat ${session.id}`,
        insert: `@chat:${session.id}`,
        icon: MessageSquare,
        badge: "Chat"
      })
    }
    const filtered = q
      ? all.filter((item) => item.label.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q) || item.badge.toLowerCase().includes(q))
      : all
    return filtered.slice(0, 10)
  }, [query, mcp, files, projects, sessions])

  useEffect(() => {
    setActive((prev) => (options.length ? Math.min(prev, options.length - 1) : 0))
  }, [options.length])

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown(event) {
        if (event.key === "Escape") {
          event.preventDefault()
          onClose()
          return true
        }
        if (!options.length) return false
        if (event.key === "ArrowDown") {
          event.preventDefault()
          setActive((i) => (i + 1) % options.length)
          return true
        }
        if (event.key === "ArrowUp") {
          event.preventDefault()
          setActive((i) => (i - 1 + options.length) % options.length)
          return true
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault()
          onPick(options[active]!.insert)
          return true
        }
        return false
      }
    }),
    [options, active, onPick, onClose]
  )

  return (
    <div className="absolute right-0 bottom-full left-0 z-40 mb-1.5 animate-pop overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60">
      <div className="border-b border-zinc-900 px-3 py-1.5 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
        Attach context (@file, @mcp, @project, @chat)
      </div>
      {options.length === 0 ? (
        <p className="px-3 py-3 text-xs text-zinc-500">No matching files, MCP resources, or chats.</p>
      ) : (
        <ul className="scrollbar-thin max-h-60 overflow-y-auto p-1">
          {options.map((option, index) => {
            const Icon = option.icon
            const selected = index === active
            return (
              <li key={option.key}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    onPick(option.insert)
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs ${
                    selected ? "bg-zinc-900 text-zinc-100" : "text-zinc-300 hover:bg-zinc-900/60"
                  }`}
                >
                  <Icon className={`size-3.5 shrink-0 ${selected ? "text-emerald-400" : "text-zinc-500"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{option.label}</span>
                    <span className="block truncate text-[11px] text-zinc-500">{option.subtitle}</span>
                  </span>
                  <span className="shrink-0 rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-400">{option.badge}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
})
