import { createFileRoute, Link } from "@tanstack/react-router"
import { Bot, Check, Copy, KeyRound, LoaderCircle, MousePointerClick, Plug, ShieldAlert, Trash2, X } from "lucide-react"
import { useEffect, useState } from "react"
import { AccessSkeleton } from "~/client/components/skeleton"
import { Page, Section } from "~/client/components/ui"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import { ACCESS_RISKS, type AccessRisk, type CreatedAccessToken } from "~/shared/access"

/** Chats and external agents managing Dex: MCP tokens, confirmations waiting on you, and what ran. */
export const Route = createFileRoute("/_app/access")({ component: AccessPage })

const EXPIRY = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: 0, label: "Never" }
]

function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs text-zinc-500">{label}</div>
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 pr-1.5 pl-3">
        <code className={`min-w-0 flex-1 truncate font-mono text-xs ${secret ? "text-amber-200" : "text-zinc-200"}`}>{value}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1_500)
            })
          }}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  )
}

function AccessPage() {
  const { state, stub } = useDex()
  const [origin, setOrigin] = useState("")
  const [label, setLabel] = useState("")
  const [scope, setScope] = useState<AccessRisk>("write")
  const [days, setDays] = useState(90)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedAccessToken | null>(null)
  const [answering, setAnswering] = useState<string | null>(null)
  const [allActivity, setAllActivity] = useState(false)

  useEffect(() => setOrigin(window.location.origin), [])

  if (!state) return <AccessSkeleton />
  const { access } = state
  const endpoint = `${origin}/api/mcp`
  const pending = access.pending.filter((action) => action.status === "pending" && Date.now() - action.createdAt < 3_600_000)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      setCreated(await stub.createAccessToken(label, scope, days || null))
      setLabel("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const answer = async (id: string, approve: boolean) => {
    setAnswering(id)
    try {
      await stub.resolvePendingAction(id, approve)
    } finally {
      setAnswering(null)
    }
  }

  const token = created?.secret ?? "dexk.…"
  const claudeCommand = `claude mcp add --transport http dex ${endpoint} --header "Authorization: Bearer ${token}"`
  const jsonConfig = JSON.stringify({ mcpServers: { dex: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)

  return (
    <Page
      title="Access & API"
      info={
        <>
          Chats and external agents can manage Dex: start and message chats, create agents and projects, run VMs, and more. In a chat, just ask
          (“start a chat per repo”). Deleting anything, changing settings, editing existing agents or projects, and adding MCP servers need your
          confirmation in the chat, or a Full token over MCP. Chats started by chats go at most two levels deep, and every operation is logged below.
        </>
      }
    >
        {pending.length > 0 && (
          <Section title="Waiting for you" info="Chats asked to do these. Nothing happens until you confirm.">
            <ul className="divide-y divide-zinc-800/80">
              {pending.map((action) => (
                <li key={action.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <ShieldAlert className="size-4 shrink-0 text-amber-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm break-words text-zinc-100">{action.summary}</span>
                    <Link to="/chat/$sessionId" params={{ sessionId: action.sessionId }} className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline">
                      from {state.sessions.find((session) => session.id === action.sessionId)?.title ?? "a chat"} · {timeAgo(action.createdAt)}
                    </Link>
                  </span>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      disabled={answering !== null}
                      onClick={() => void answer(action.id, true)}
                      className="flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
                    >
                      {answering === action.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Confirm
                    </button>
                    <button
                      type="button"
                      disabled={answering !== null}
                      onClick={() => void answer(action.id, false)}
                      className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
                    >
                      <X className="size-3.5" /> Decline
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="MCP" info="Connect Claude Code, Claude Desktop, Cursor, or any MCP client. Each token has its own access level and expiry, and can be revoked any time.">
          <div className="space-y-4">
            <CopyField label="Endpoint (Streamable HTTP)" value={endpoint} />

            {created ? (
              <div className="space-y-3 rounded-xl border border-amber-900/60 bg-amber-950/20 p-3">
                <p className="flex items-center gap-2 text-sm text-amber-200">
                  <KeyRound className="size-4" /> Copy this token now. It won't be shown again.
                </p>
                <CopyField label={`${created.token.label} · ${ACCESS_RISKS.find((risk) => risk.id === created.token.scope)?.label}`} value={created.secret} secret />
                <CopyField label="Claude Code" value={claudeCommand} secret />
                <div>
                  <div className="mb-1 text-xs text-zinc-500">Other clients (JSON config)</div>
                  <pre className="scrollbar-thin overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-300">{jsonConfig}</pre>
                </div>
                <button type="button" onClick={() => setCreated(null)} className="text-xs text-zinc-400 hover:text-zinc-100">
                  Done
                </button>
              </div>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void create()
                }}
              >
                <label className="block">
                  <span className="mb-1 block text-xs text-zinc-500">New token</span>
                  <input
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Name, e.g. Claude Code on my laptop"
                    maxLength={60}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-600"
                  />
                </label>
                <fieldset>
                  <legend className="mb-1 text-xs text-zinc-500">Access</legend>
                  <div className="flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
                    {ACCESS_RISKS.map((risk) => (
                      <label
                        key={risk.id}
                        className={`relative flex-1 cursor-pointer rounded-md px-2 py-1.5 text-center text-sm transition-colors ${scope === risk.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
                      >
                        <input type="radio" name="scope" value={risk.id} checked={scope === risk.id} onChange={() => setScope(risk.id)} className="sr-only" />
                        {risk.label}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-500">{ACCESS_RISKS.find((risk) => risk.id === scope)?.description}</p>
                </fieldset>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-zinc-500">
                    Expires
                    <select
                      value={days}
                      onChange={(event) => setDays(Number(event.target.value))}
                      className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-zinc-200"
                    >
                      {EXPIRY.map((option) => (
                        <option key={option.days} value={option.days}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    disabled={busy || !label.trim()}
                    className="ml-auto flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
                  >
                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Create token
                  </button>
                </div>
                {error && <p className="text-sm text-red-400">{error}</p>}
              </form>
            )}

            {access.tokens.length > 0 && (
              <ul className="divide-y divide-zinc-800/80 border-t border-zinc-800/80">
                {access.tokens.map((item) => {
                  const expired = item.expiresAt !== null && item.expiresAt < Date.now()
                  return (
                    <li key={item.id} className="flex items-center gap-3 py-2.5">
                      <Plug className="size-4 shrink-0 text-zinc-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-zinc-200">{item.label}</span>
                        <span className="block truncate text-xs text-zinc-500">
                          {ACCESS_RISKS.find((risk) => risk.id === item.scope)?.label} · {item.lastUsedAt ? `used ${timeAgo(item.lastUsedAt)}` : "never used"} ·{" "}
                          {expired ? <span className="text-amber-300">expired</span> : item.expiresAt ? `expires ${new Date(item.expiresAt).toLocaleDateString()}` : "no expiry"}
                        </span>
                      </span>
                      <button
                        type="button"
                        title="Revoke"
                        onClick={() => {
                          if (confirm(`Revoke “${item.label}”? Agents using it lose access immediately.`)) void stub.revokeAccessToken(item.id)
                        }}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                      >
                        <Trash2 className="size-3.5" /> Revoke
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Section>

        <Section title="Activity" info="Every app operation run by a chat, an external agent, or a button in a chat's UI, newest first.">
          {access.audit.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-800/80">
              {(allActivity ? access.audit : access.audit.slice(0, 8)).map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 py-2">
                  {entry.actor === "mcp" ? (
                    <Plug className="mt-0.5 size-3.5 shrink-0 text-sky-400" />
                  ) : entry.actor === "user" ? (
                    <Check className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                  ) : entry.actor === "ui" ? (
                    <MousePointerClick className="mt-0.5 size-3.5 shrink-0 text-violet-400" />
                  ) : (
                    <Bot className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm break-words ${entry.ok ? "text-zinc-200" : "text-zinc-400"}`}>{entry.summary}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {entry.actor === "user" ? "You confirmed, for " : entry.actor === "ui" ? "From a button in " : ""}
                      {entry.actorLabel} · {timeAgo(entry.at)}
                      {!entry.ok && entry.error && <span className="text-red-400"> · {entry.error}</span>}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!allActivity && access.audit.length > 8 && (
            <button type="button" onClick={() => setAllActivity(true)} className="mt-1 text-xs text-zinc-400 hover:text-zinc-100">
              Show all {access.audit.length}
            </button>
          )}
        </Section>
    </Page>
  )
}
