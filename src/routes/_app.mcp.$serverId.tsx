import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, LoaderCircle, Plus, Trash2, X } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { McpStatusDot } from "~/client/components/mcp-picker"
import { EditorSkeleton } from "~/client/components/skeleton"
import { InfoTip } from "~/client/components/info-tip"
import { useDex } from "~/client/lib/dex"
import { AUTH_ICON, AUTH_LABEL, followConnect } from "~/client/lib/mcp"
import { MCP_STATUS_LABEL, type McpAuth, type McpServerDraft, type McpTransport } from "~/shared/mcp"
import { MCP_TEMPLATES } from "~/shared/mcp-templates"

export const Route = createFileRoute("/_app/mcp/$serverId")({
  validateSearch: (search: Record<string, unknown>): { template?: string } => (typeof search.template === "string" ? { template: search.template } : {}),
  component: McpEditorPage
})

type HeaderRow = { name: string; value: string; saved: boolean }
type Draft = Omit<McpServerDraft, "headers"> & { headers: HeaderRow[] }

const fieldBase = "rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none md:text-sm"
const field = `w-full ${fieldBase}`

const AUTH_HINT: Record<McpAuth, string> = {
  none: "For public servers that need no credentials.",
  headers: "Sent with every request: an API key, a bearer token, or any custom header.",
  oauth: "After saving you sign in on the provider's page; Dex registers itself and keeps the token fresh."
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <span className="flex items-center gap-1 text-sm font-medium text-zinc-200">
        {label}
        {hint && <InfoTip>{hint}</InfoTip>}
      </span>
      
      <div className="mt-2">{children}</div>
    </div>
  )
}

/** Keyed by id: moving from one item (or “new”) to another starts a fresh draft instead of keeping the last one. */
function McpEditorPage() {
  const { serverId } = Route.useParams()
  return <McpEditor key={serverId} />
}

function McpEditor() {
  const { serverId } = Route.useParams()
  const { template: templateId } = Route.useSearch()
  const { state, stub } = useDex()
  const navigate = useNavigate()
  const isNew = serverId === "new"
  const existing = state?.mcp.find((server) => server.id === serverId)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [placeholder, setPlaceholder] = useState("Bearer sk-…")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (draft || !state) return
    if (existing) {
      setDraft({
        id: existing.id,
        name: existing.name,
        url: existing.url,
        transport: existing.transport,
        auth: existing.auth,
        defaultOn: existing.defaultOn,
        headers: existing.headerNames.map((name) => ({ name, value: "", saved: true }))
      })
    } else if (isNew) {
      const template = MCP_TEMPLATES.find((candidate) => candidate.id === templateId)
      if (template?.header) setPlaceholder(template.header.placeholder)
      setDraft({
        name: template?.name ?? "",
        url: template?.url ?? "",
        transport: "auto",
        auth: template?.auth ?? "none",
        defaultOn: false,
        headers: [{ name: template?.header?.name ?? "Authorization", value: "", saved: false }]
      })
    }
  }, [state, existing, isNew, draft, templateId])

  if (!state) return <EditorSkeleton kind="mcp" />
  if (!isNew && !existing) {
    return (
      <div className="p-8 text-sm text-zinc-500">
        This server no longer exists.{" "}
        <Link to="/mcp" className="text-emerald-400 hover:underline">
          Back to MCP servers
        </Link>
      </div>
    )
  }
  if (!draft) return null

  const update = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  const setHeader = (index: number, patch: Partial<HeaderRow>) =>
    update({ headers: draft.headers.map((header, i) => (i === index ? { ...header, ...patch } : header)) })

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const result = await stub.saveMcpServer({ ...draft, headers: draft.headers.map(({ name, value }) => ({ name, value })) })
      if (!result.ok) {
        setError(result.error)
        // Saved but couldn't connect: keep editing the saved server.
        if (isNew && result.id) await navigate({ to: "/mcp/$serverId", params: { serverId: result.id }, replace: true })
        return
      }
      if (result.authUrl) return followConnect(result)
      await navigate({ to: "/mcp" })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pt-10">
        <Link to="/mcp" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200">
          <ArrowLeft className="size-4" /> MCP servers
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{isNew ? "Add MCP server" : draft.name || "MCP server"}</h1>
        {existing && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-400">
            <McpStatusDot status={existing.status} /> {MCP_STATUS_LABEL[existing.status]}
            {existing.status === "ready" && ` · ${existing.tools.length} tools`}
          </p>
        )}

        <form
          className="mt-6 space-y-6"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <label className="block">
              <span className="text-sm font-medium text-zinc-200">Name</span>
              <input value={draft.name} onChange={(event) => update({ name: event.target.value })} placeholder="GitHub" maxLength={60} required className={`${field} mt-2`} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-zinc-200">URL</span>
              <input
                value={draft.url}
                onChange={(event) => update({ url: event.target.value })}
                placeholder="https://example.com/mcp"
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                required
                className={`${field} mt-2 font-mono`}
              />
            </label>
          </div>

          <Field label="Authentication" hint={AUTH_HINT[draft.auth]}>
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
              {(["none", "headers", "oauth"] as const).map((auth) => {
                const Icon = AUTH_ICON[auth]
                return (
                  <button
                    key={auth}
                    type="button"
                    aria-pressed={draft.auth === auth}
                    onClick={() => update({ auth })}
                    className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm ${
                      draft.auth === auth ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    {Icon && <Icon className="size-3.5" />}
                    {AUTH_LABEL[auth]}
                  </button>
                )
              })}
            </div>
          </Field>

          {draft.auth === "headers" && (
            <Field label="Headers" hint="Values are encrypted and never shown again; leave a saved value empty to keep it.">
              <div className="space-y-2">
                {draft.headers.map((header, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      value={header.name}
                      onChange={(event) => setHeader(index, { name: event.target.value, saved: false })}
                      placeholder="Authorization"
                      autoCapitalize="off"
                      spellCheck={false}
                      className={`${fieldBase} w-2/5 min-w-0 font-mono`}
                    />
                    <input
                      value={header.value}
                      onChange={(event) => setHeader(index, { value: event.target.value })}
                      placeholder={header.saved ? "•••••••• saved" : placeholder}
                      type="password"
                      autoComplete="off"
                      className={`${fieldBase} min-w-0 flex-1 font-mono`}
                    />
                    <button
                      type="button"
                      title="Remove header"
                      onClick={() => update({ headers: draft.headers.filter((_, i) => i !== index) })}
                      className="shrink-0 rounded-lg px-2 text-zinc-500 hover:text-red-400"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => update({ headers: [...draft.headers, { name: "", value: "", saved: false }] })}
                  className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100"
                >
                  <Plus className="size-4" /> Add header
                </button>
              </div>
            </Field>
          )}

          <details className="group">
            <summary className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-200">Advanced</summary>
            <div className="mt-3">
              <Field label="Transport" hint="Auto tries Streamable HTTP, then falls back to SSE.">
                <select value={draft.transport} onChange={(event) => update({ transport: event.target.value as McpTransport })} className={field}>
                  <option value="auto">Auto</option>
                  <option value="streamable-http">Streamable HTTP</option>
                  <option value="sse">SSE (legacy)</option>
                </select>
              </Field>
            </div>
          </details>

          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={draft.defaultOn} onChange={(event) => update({ defaultOn: event.target.checked })} className="mt-0.5 size-4 accent-emerald-600" />
            <span>
              <span className="flex items-center gap-1 text-sm text-zinc-200">
                On for new chats
                <InfoTip>Attach it to new chats that don't use an agent. Agents choose their own servers.</InfoTip>
              </span>
            </span>
          </label>

          {error && <p className="text-sm break-words text-red-400">{error}</p>}

          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-zinc-900 bg-zinc-950/90 px-4 py-3 backdrop-blur">
            <button
              type="submit"
              disabled={saving || !draft.name.trim() || !draft.url.trim()}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {saving && <LoaderCircle className="size-4 animate-spin" />}
              {saving ? "Connecting…" : draft.auth === "oauth" && (isNew || existing?.status !== "ready") ? "Save and sign in" : isNew ? "Add and connect" : "Save"}
            </button>
            {!isNew && (
              <button
                type="button"
                onClick={async () => {
                  if (!confirm(`Remove “${draft.name}”? Chats and agents using it lose its tools.`)) return
                  await stub.deleteMcpServer(serverId)
                  await navigate({ to: "/mcp" })
                }}
                className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:text-red-400"
              >
                <Trash2 className="size-4" /> Remove
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
