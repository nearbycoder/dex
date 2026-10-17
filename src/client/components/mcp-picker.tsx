import { Link } from "@tanstack/react-router"
import { Check, Plug, Settings2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { MCP_STATUS_LABEL, type McpServerInfo, type McpStatus } from "~/shared/mcp"

const DOT: Record<McpStatus, string> = {
  ready: "bg-emerald-500",
  authenticating: "bg-amber-500",
  failed: "bg-red-500",
  connecting: "animate-pulse bg-amber-500",
  connected: "animate-pulse bg-amber-500",
  discovering: "animate-pulse bg-amber-500",
  disconnected: "bg-zinc-600"
}

export function McpStatusDot({ status, className = "" }: { status: McpStatus; className?: string }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${DOT[status]} ${className}`} title={MCP_STATUS_LABEL[status]} />
}

export const mcpNeedsAttention = (server: McpServerInfo) => server.status === "authenticating" || server.status === "failed"

/** Composer menu for the MCP servers whose tools a chat can use. */
export function McpPicker(props: {
  servers: ReadonlyArray<McpServerInfo>
  selected: ReadonlyArray<string>
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [upward, setUpward] = useState(true)
  const root = useRef<HTMLDivElement>(null)
  const attached = props.servers.filter((server) => props.selected.includes(server.id))

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", close)
      document.removeEventListener("keydown", escape)
    }
  }, [open])

  const toggleMenu = () => {
    const rect = root.current?.getBoundingClientRect()
    if (rect) setUpward(rect.top > window.innerHeight - rect.bottom)
    setOpen((value) => !value)
  }

  const toggle = (id: string) =>
    props.onChange(props.selected.includes(id) ? props.selected.filter((other) => other !== id) : [...props.selected, id])

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        disabled={props.disabled}
        onClick={toggleMenu}
        title={attached.length ? `MCP: ${attached.map((server) => server.name).join(", ")}` : "Attach MCP servers"}
        aria-label={attached.length ? `MCP servers: ${attached.length}` : "MCP servers"}
        className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs disabled:opacity-50 sm:gap-1.5 sm:pr-2 ${
          attached.length ? "border-emerald-800/70 bg-emerald-950/30 text-emerald-300" : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
        }`}
      >
        <Plug className="size-3.5" />
        {/* Phones show just the plug and a count, so the toolbar stays on one line. */}
        {attached.length > 0 && <span className="sm:hidden">{attached.length}</span>}
        <span className="hidden sm:inline">
          {attached.length ? (attached.length === 1 ? <span className="inline-block max-w-24 truncate align-bottom">{attached[0]!.name}</span> : `${attached.length} MCP`) : "MCP"}
        </span>
        {attached.some(mcpNeedsAttention) && <span className="size-1.5 rounded-full bg-amber-500" />}
      </button>
      {open && (
        <div
          className={`absolute left-0 z-50 w-72 max-w-[calc(100vw-2rem)] animate-pop overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50 ${
            upward ? "bottom-full mb-1.5 origin-bottom-left" : "top-full mt-1.5 origin-top-left"
          }`}
        >
          <div className="px-3 pt-2.5 pb-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">MCP servers for this chat</div>
          {props.servers.length === 0 ? (
            <p className="px-3 py-2 text-xs leading-relaxed text-zinc-500">No MCP servers yet. Connect one to give Dex its tools.</p>
          ) : (
            <ul className="scrollbar-thin max-h-72 overflow-y-auto py-1">
              {props.servers.map((server) => {
                const selected = props.selected.includes(server.id)
                return (
                  <li key={server.id}>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={selected}
                      onClick={() => toggle(server.id)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-zinc-900"
                    >
                      <span
                        className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                          selected ? "border-emerald-500 bg-emerald-600 text-white" : "border-zinc-700"
                        }`}
                      >
                        {selected && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-zinc-100">{server.name}</span>
                        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                          <McpStatusDot status={server.status} />
                          {server.status === "ready" ? `${server.tools.length} tools` : MCP_STATUS_LABEL[server.status]}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <Link
            to="/mcp"
            className="flex items-center gap-1.5 border-t border-zinc-900 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          >
            <Settings2 className="size-3.5" /> Manage MCP servers
          </Link>
        </div>
      )}
    </div>
  )
}
