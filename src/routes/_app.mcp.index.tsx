import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ChevronRight, LoaderCircle, LogIn, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react"
import { useState } from "react"
import { McpStatusDot } from "~/client/components/mcp-picker"
import { CardGridSkeleton } from "~/client/components/skeleton"
import { InfoTip } from "~/client/components/info-tip"
import { Switch } from "~/client/components/ui"
import { useDex } from "~/client/lib/dex"
import { AUTH_ICON, AUTH_LABEL, followConnect } from "~/client/lib/mcp"
import { MCP_STATUS_LABEL, type McpServerInfo } from "~/shared/mcp"
import { MCP_TEMPLATES } from "~/shared/mcp-templates"

export const Route = createFileRoute("/_app/mcp/")({
  // Set by the OAuth callback on the way back from a server's sign-in page.
  validateSearch: (search: Record<string, unknown>): { connected?: string; error?: string; server?: string } => ({
    ...(typeof search.connected === "string" && { connected: search.connected }),
    ...(typeof search.error === "string" && { error: search.error }),
    ...(typeof search.server === "string" && { server: search.server })
  }),
  component: McpPage
})

const iconButton = "rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"

function ServerCard({ server, index }: { server: McpServerInfo; index: number }) {
  const { stub } = useDex()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const AuthIcon = AUTH_ICON[server.auth]

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await stub.connectMcpServer(server.id)
      if (!result.ok) setError(result.error)
      followConnect(result)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="animate-rise rounded-xl border border-zinc-800 bg-zinc-900/40 p-4" style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-medium text-zinc-100">{server.name}</h2>
            <span className="flex shrink-0 items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {AuthIcon && <AuthIcon className="size-3" />}
              {AUTH_LABEL[server.auth]}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">{server.url}</p>
        </div>
        <div className="-mt-1 -mr-1.5 flex shrink-0 items-center">
          {server.status !== "authenticating" && (
            <button type="button" onClick={connect} disabled={busy} title="Reconnect" aria-label={`Reconnect ${server.name}`} className={iconButton}>
              <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
            </button>
          )}
          <Link to="/mcp/$serverId" params={{ serverId: server.id }} title="Edit" aria-label={`Edit ${server.name}`} className={iconButton}>
            <Pencil className="size-4" />
          </Link>
          <button
            type="button"
            title="Remove"
            aria-label={`Remove ${server.name}`}
            onClick={async () => {
              if (!confirm(`Remove “${server.name}”? Chats and agents using it lose its tools, and its sign-in is forgotten.`)) return
              await stub.deleteMcpServer(server.id)
            }}
            className={`${iconButton} hover:text-red-400`}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className="flex items-center gap-1.5 text-zinc-300">
          <McpStatusDot status={server.status} />
          {MCP_STATUS_LABEL[server.status]}
        </span>
        {server.status === "authenticating" && (
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <LogIn className="size-3.5" />} Sign in
          </button>
        )}
        <span className="ml-auto flex items-center gap-2 text-zinc-400">
          New chats
          <Switch label={`Attach ${server.name} to new chats`} checked={server.defaultOn} onChange={(on) => void stub.setMcpServerDefault(server.id, on)} />
        </span>
      </div>
      {(error ?? server.error) && server.status !== "ready" && <p className="mt-2 text-xs break-words text-red-400">{error ?? server.error}</p>}

      {server.tools.length > 0 && (
        <details className="group mt-2">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
            {server.tools.length} {server.tools.length === 1 ? "tool" : "tools"}
            <span className="text-zinc-600">· {server.prefix}__…</span>
          </summary>
          <ul className="mt-2 space-y-1.5 border-l border-zinc-800 pl-3">
            {server.tools.map((tool) => (
              <li key={tool.name} className="text-xs">
                <code className="text-zinc-200">{tool.name}</code>
                {tool.description && <p className="line-clamp-2 text-zinc-500">{tool.description}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}

function McpPage() {
  const { state } = useDex()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const servers = state?.mcp ?? []
  const returned = search.connected ?? search.server
  const returnedName = servers.find((server) => server.id === returned)?.name ?? "the server"
  const dismiss = () => void navigate({ to: "/mcp", search: {}, replace: true })
  const unused = MCP_TEMPLATES.filter((template) => !servers.some((server) => server.url === template.url))

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pt-10">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">MCP servers</h1>
            <InfoTip label="About mcp servers">Remote tools for Dex. Each chat and agent picks the servers it uses; servers marked “On for new chats” attach to plain new chats.</InfoTip>
          </div>
          <Link
            to="/mcp/$serverId"
            params={{ serverId: "new" }}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            <Plus className="size-4" /> Add server
          </Link>
        </div>

        {(search.connected || search.error) && (
          <div
            className={`mb-4 flex animate-rise items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
              search.error ? "border-red-900/60 bg-red-950/30 text-red-200" : "border-emerald-900/60 bg-emerald-950/30 text-emerald-200"
            }`}
          >
            <span className="min-w-0 flex-1 break-words">
              {search.error ? `Signing in to ${returnedName} failed: ${search.error}` : `Signed in to ${returnedName}. Its tools are loading.`}
            </span>
            <button type="button" onClick={dismiss} title="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
              <X className="size-4" />
            </button>
          </div>
        )}

        {!state ? (
          <CardGridSkeleton count={3} columns="" />
        ) : servers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
            No MCP servers yet. Add one below or by URL.
          </p>
        ) : (
          <ul className="grid gap-3">
            {servers.map((server, index) => (
              <ServerCard key={server.id} server={server} index={index} />
            ))}
          </ul>
        )}

        {unused.length > 0 && (
          <>
            <h2 className="mt-8 mb-2 px-1 text-xs font-medium tracking-wide text-zinc-500 uppercase">Popular servers</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {unused.map((template) => {
                const AuthIcon = AUTH_ICON[template.auth]
                return (
                  <li key={template.id}>
                    <Link
                      to="/mcp/$serverId"
                      params={{ serverId: "new" }}
                      search={{ template: template.id }}
                      className="flex h-full flex-col rounded-xl border border-zinc-800/80 px-3.5 py-3 hover:border-zinc-700 hover:bg-zinc-900/60"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                        {template.name}
                        <span className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-normal text-zinc-400">
                          {AuthIcon && <AuthIcon className="size-3" />}
                          {AUTH_LABEL[template.auth]}
                        </span>
                      </span>
                      <span className="mt-1 text-xs leading-relaxed text-zinc-500">{template.note}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
