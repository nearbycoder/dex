import { Link } from "@tanstack/react-router"
import { Check, Copy, KeyRound, LoaderCircle, Pause, Play, RefreshCw, Send, Trash2, Webhook } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ask } from "~/client/components/confirm-dialog"
import { Section } from "~/client/components/ui"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import type { CreatedWebhook, WebhookInfo, WebhookTarget } from "~/shared/webhooks"

function CopyLine({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
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

export function WebhooksSection({ origin }: { origin: string }) {
  const { state, stub } = useDex()
  const [name, setName] = useState("")
  const [kind, setKind] = useState<WebhookTarget["kind"]>("session")
  const [targetId, setTargetId] = useState("")
  const [prompt, setPrompt] = useState("")
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [lastTest, setLastTest] = useState<{ id: string; sessionId: string } | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedWebhook | null>(null)

  const sessions = state?.sessions ?? []
  const spaces = state?.spaces ?? []
  const agents = state?.agents ?? []
  const webhooks = state?.webhooks ?? []

  const options =
    kind === "session"
      ? sessions.map((s) => ({ id: s.id, label: s.title }))
      : kind === "space"
        ? spaces.map((s) => ({ id: s.id, label: s.name }))
        : agents.map((a) => ({ id: a.id, label: a.name }))

  useEffect(() => {
    if (!options.some((opt) => opt.id === targetId)) {
      setTargetId(options[0]?.id ?? "")
    }
  }, [kind, options, targetId])

  if (!state) return null

  const resolveTarget = (target: WebhookTarget): string => {
    if (target.kind === "session") return `Chat · ${sessions.find((s) => s.id === target.sessionId)?.title ?? target.sessionId.slice(0, 8)}`
    if (target.kind === "space") return `Space · ${spaces.find((s) => s.id === target.spaceId)?.name ?? target.spaceId.slice(0, 8)}`
    return `New chat with ${agents.find((a) => a.id === target.agentId)?.name ?? "agent"}`
  }

  const create = async () => {
    if (!name.trim() || !targetId) return
    setBusy(true)
    setError(null)
    try {
      const target: WebhookTarget =
        kind === "session"
          ? { kind: "session", sessionId: targetId }
          : kind === "space"
            ? { kind: "space", spaceId: targetId }
            : { kind: "agent", agentId: targetId }
      const saved = await stub.saveWebhook({ name: name.trim(), target, prompt: prompt.trim() || undefined })
      if (saved.secret) setCreated({ webhook: saved.webhook, secret: saved.secret })
      setName("")
      setPrompt("")
      toast.success(`Webhook “${saved.webhook.name}” created`)
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause)
      setError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  const toggleEnabled = async (hook: WebhookInfo) => {
    setError(null)
    try {
      await stub.saveWebhook({
        id: hook.id,
        name: hook.name,
        enabled: !hook.enabled,
        target: hook.target,
        prompt: hook.prompt
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const createdUrl = created ? `${origin}${created.webhook.path}` : ""
  const curlExample = created
    ? `curl -X POST "${createdUrl}" -H "Content-Type: application/json" -H "Authorization: Bearer ${created.secret}" -d '{"event":"ping","ok":true}'`
    : ""

  return (
    <Section
      title="Webhooks"
      info="Trigger Dex from GitHub, Linear, Stripe, CI pipelines, or any HTTP sender. Requests are verified with HMAC-SHA256 (X-Dex-Signature-256, X-Hub-Signature-256, Linear-Signature) or Authorization: Bearer."
    >
      <div className="space-y-4">
        {created ? (
          <div className="space-y-3 rounded-xl border border-amber-900/60 bg-amber-950/20 p-3">
            <p className="flex items-center gap-2 text-sm text-amber-200">
              <KeyRound className="size-4" /> Copy this signing secret now. It won't be shown again.
            </p>
            <CopyLine label={`${created.webhook.name} · Endpoint URL`} value={createdUrl} />
            <CopyLine label="Signing secret (HMAC-SHA256 or Bearer)" value={created.secret} secret />
            <CopyLine label="Quick test (curl)" value={curlExample} secret />
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
              <span className="mb-1 block text-xs text-zinc-500">New webhook</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Name, e.g. GitHub PRs or CI alerts"
                maxLength={60}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-600"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <fieldset>
                <legend className="mb-1 text-xs text-zinc-500">Deliver to</legend>
                <div className="flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
                  {(
                    [
                      ["session", "Chat"],
                      ["space", "Space"],
                      ["agent", "Agent"]
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={kind === id}
                      onClick={() => setKind(id)}
                      className={`flex-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
                        kind === id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">Target</span>
                <select
                  value={targetId}
                  onChange={(event) => setTargetId(event.target.value)}
                  disabled={options.length === 0}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600 disabled:opacity-50"
                >
                  {options.length === 0 ? (
                    <option value="">No {kind}s yet</option>
                  ) : (
                    options.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs text-zinc-500">Prompt template (optional)</span>
              <input
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="e.g. Triage this {{event}} event and summarize action items."
                maxLength={500}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-600"
              />
            </label>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={busy || !name.trim() || !targetId}
                className="ml-auto flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Webhook className="size-4" />} Create webhook
              </button>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </form>
        )}

        {webhooks.length > 0 && (
          <ul className="divide-y divide-zinc-800/80 border-t border-zinc-800/80">
            {webhooks.map((hook) => {
              const fullUrl = `${origin}${hook.path}`
              return (
                <li key={hook.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span
                    className={`size-2 shrink-0 rounded-full ${hook.enabled ? "bg-emerald-500" : "bg-zinc-600"}`}
                    title={hook.enabled ? "Enabled" : "Paused"}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-200">{hook.name}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {resolveTarget(hook.target)} ·{" "}
                      {hook.triggerCount > 0
                        ? `${hook.triggerCount} ${hook.triggerCount === 1 ? "run" : "runs"}${hook.lastTriggeredAt ? ` · last ${timeAgo(hook.lastTriggeredAt)}` : ""}`
                        : "never triggered"}
                    </span>
                    {hook.lastError && <span className="block truncate text-xs text-red-400">{hook.lastError}</span>}
                    {lastTest?.id === hook.id && (
                      <Link
                        to="/chat/$sessionId"
                        params={{ sessionId: lastTest.sessionId }}
                        className="mt-0.5 inline-block text-xs text-emerald-400 hover:underline"
                      >
                        Test delivered — open chat
                      </Link>
                    )}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      title="Copy webhook URL"
                      onClick={() => {
                        void navigator.clipboard.writeText(fullUrl).then(() => {
                          setCopiedId(hook.id)
                          setTimeout(() => setCopiedId((prev) => (prev === hook.id ? null : prev)), 1_500)
                        })
                      }}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      {copiedId === hook.id ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                    </button>
                    <button
                      type="button"
                      disabled={testing === hook.id}
                      title="Send a test event"
                      onClick={async () => {
                        setTesting(hook.id)
                        setError(null)
                        try {
                          const res = await stub.testWebhook(hook.id)
                          setLastTest({ id: hook.id, sessionId: res.sessionId })
                          toast.success(`Test event sent to “${hook.name}”`)
                        } catch (cause) {
                          const msg = cause instanceof Error ? cause.message : String(cause)
                          setError(msg)
                          toast.error(msg)
                        } finally {
                          setTesting(null)
                        }
                      }}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-emerald-300 disabled:opacity-50"
                    >
                      {testing === hook.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                    </button>
                    <button
                      type="button"
                      title={hook.enabled ? "Pause webhook" : "Resume webhook"}
                      onClick={() => void toggleEnabled(hook)}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      {hook.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                    </button>
                    <button
                      type="button"
                      title="Rotate signing secret"
                      onClick={async () => {
                        if (
                          !(await ask({
                            title: `Rotate secret for “${hook.name}”?`,
                            body: "Senders using the old secret will fail immediately until updated.",
                            confirm: "Rotate"
                          }))
                        )
                          return
                        setCreated(await stub.rotateWebhookSecret(hook.id))
                      }}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-amber-300"
                    >
                      <RefreshCw className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Delete webhook"
                      onClick={async () => {
                        if (
                          !(await ask({
                            title: `Delete “${hook.name}”?`,
                            body: "Future requests to this webhook URL will return 404.",
                            confirm: "Delete"
                          }))
                        )
                          return
                        await stub.deleteWebhook(hook.id)
                      }}
                      className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Section>
  )
}
