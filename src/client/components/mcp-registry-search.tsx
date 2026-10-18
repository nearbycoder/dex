import { Link } from "@tanstack/react-router"
import { AlertTriangle, Check, ChevronRight, CircleX, Info, LoaderCircle, Plus, Search, ShieldCheck, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useDex } from "~/client/lib/dex"
import type { CheckStatus, McpCheckReport, RegistryServer } from "~/shared/mcp-registry"

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Registry results for `query`, debounced longer than usual: the registry is slow for queries it hasn't seen lately. */
function useRegistrySearch(query: string) {
  const { stub } = useDex()
  const [state, setState] = useState<{ query: string; results: RegistryServer[]; loading: boolean; error: string | null }>({
    query: "",
    results: [],
    loading: false,
    error: null
  })
  const q = query.trim()
  useEffect(() => {
    if (q.length < 2) {
      setState({ query: q, results: [], loading: false, error: null })
      return
    }
    let current = true
    setState((previous) => ({ ...previous, loading: true, error: null }))
    const timer = setTimeout(() => {
      stub
        .searchMcpRegistry(q)
        .then((results) => current && setState({ query: q, results, loading: false, error: null }))
        .catch((error: unknown) => current && setState({ query: q, results: [], loading: false, error: errorText(error) }))
    }, 450)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [q, stub])
  return state
}

const STATUS_ICON: Record<CheckStatus, { icon: typeof Check; className: string }> = {
  pass: { icon: Check, className: "text-emerald-400" },
  warn: { icon: AlertTriangle, className: "text-amber-400" },
  fail: { icon: CircleX, className: "text-red-400" },
  info: { icon: Info, className: "text-zinc-500" }
}

function Report({ report }: { report: McpCheckReport }) {
  return (
    <>
      <ul className="space-y-1.5">
        {report.checks.map((check) => {
          const { icon: Icon, className } = STATUS_ICON[check.status]
          return (
            <li key={check.id} className="flex items-start gap-2 text-xs">
              <Icon className={`mt-0.5 size-3.5 shrink-0 ${className}`} />
              <span className="min-w-0">
                <span className="text-zinc-300">{check.label}</span>
                <span className="text-zinc-500"> · </span>
                <span className="break-words text-zinc-400">{check.detail}</span>
              </span>
            </li>
          )
        })}
      </ul>
      {report.tools.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {report.tools.slice(0, 16).map((tool) => (
            <code key={tool} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">
              {tool}
            </code>
          ))}
          {report.tools.length > 16 && <span className="px-1 text-[11px] text-zinc-500">+{report.tools.length - 16} more</span>}
        </div>
      )}
    </>
  )
}

/** One registry result: opening it runs the checks; then add it with the editor prefilled. */
function ResultRow({ server, added }: { server: RegistryServer; added: boolean }) {
  const { stub } = useDex()
  const [open, setOpen] = useState(false)
  const [report, setReport] = useState<McpCheckReport | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const needsKey = server.headers.some((header) => header.required)

  const toggle = async () => {
    setOpen(!open)
    if (open || report || checking) return
    setChecking(true)
    setError(null)
    try {
      setReport(await stub.checkMcpServer(server))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setChecking(false)
    }
  }

  const failed = report?.checks.some((check) => check.status === "fail") ?? false
  const auth = report?.auth ?? (needsKey ? "headers" : "none")
  const header = report?.header ?? server.headers.find((each) => each.required)?.name

  return (
    <li className="border-b border-zinc-800/80 last:border-0">
      <button type="button" onClick={() => void toggle()} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <ChevronRight className={`size-4 shrink-0 text-zinc-600 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-zinc-100">{server.title}</span>
            {needsKey && <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">API key</span>}
            {server.transport === "sse" && <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">SSE</span>}
            {server.templated && <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">Needs setup</span>}
          </span>
          <span className="block truncate font-mono text-[11px] text-zinc-500">{server.name}</span>
        </span>
        {added && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-400">
            <Check className="size-3.5" /> Added
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 pl-9">
          {server.description && <p className="mb-2 text-sm text-zinc-300">{server.description}</p>}
          <p className="mb-2.5 truncate font-mono text-[11px] text-zinc-500" title={server.url}>
            {server.url}
          </p>
          {checking ? (
            <p className="flex items-center gap-2 text-xs text-zinc-500">
              <LoaderCircle className="size-3.5 animate-spin" /> Checking it: connecting, reading its sign-in and tools, looking at its source…
            </p>
          ) : error ? (
            <p className="text-xs break-words text-red-400">{error}</p>
          ) : (
            report && <Report report={report} />
          )}
          {report && !added && (
            <Link
              to="/mcp/$serverId"
              params={{ serverId: "new" }}
              search={{ name: server.title, url: server.url, auth, ...(header ? { header } : {}) }}
              className={`mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
                failed ? "border border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "bg-emerald-600 text-white hover:bg-emerald-500"
              }`}
            >
              <Plus className="size-3.5" /> {failed ? "Add anyway" : "Add server"}
            </Link>
          )}
        </div>
      )}
    </li>
  )
}

/** Search the official MCP Registry for remote servers, with checks on each before you add it. */
export function McpRegistrySearch() {
  const { state } = useDex()
  const [query, setQuery] = useState("")
  const search = useRegistrySearch(query)
  const addedUrls = new Set((state?.mcp ?? []).map((server) => server.url.replace(/\/$/, "")))
  const searching = query.trim().length >= 2

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the MCP Registry"
          aria-label="Search the MCP Registry"
          className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 py-2.5 pr-9 pl-9 text-base text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none md:text-sm [&::-webkit-search-cancel-button]:hidden"
        />
        {search.loading ? (
          <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-zinc-500" />
        ) : (
          query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-200">
              <X className="size-4" />
            </button>
          )
        )}
      </div>
      {searching && (
        <div className="mt-3">
          {search.error ? (
            <p className="px-1 text-sm text-red-400">{search.error}</p>
          ) : search.results.length > 0 ? (
            <>
              <ul className="animate-fade overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
                {search.results.map((server) => (
                  <ResultRow key={server.name} server={server} added={addedUrls.has(server.url.replace(/\/$/, ""))} />
                ))}
              </ul>
              <p className="mt-2 flex items-center gap-1.5 px-1 text-[11px] text-zinc-600">
                <ShieldCheck className="size-3.5" /> The registry verifies who published a server, not the server itself: open one to check it.
              </p>
            </>
          ) : search.loading ? (
            <p className="px-1 text-xs text-zinc-500">Searching… the registry can take a few seconds for a new search.</p>
          ) : (
            search.query === query.trim() && <p className="px-1 text-sm text-zinc-500">No remote servers named like “{query.trim()}”.</p>
          )}
        </div>
      )}
    </div>
  )
}
