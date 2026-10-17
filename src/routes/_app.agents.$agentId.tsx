import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Check, LoaderCircle, MessageSquarePlus, Plug, Trash2 } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { AGENT_ICON_COMPONENTS, AgentAvatar } from "~/client/components/agent-avatar"
import { McpStatusDot } from "~/client/components/mcp-picker"
import { ModelPicker } from "~/client/components/model-picker"
import { PageSkeleton } from "~/client/components/skeleton"
import { InfoTip } from "~/client/components/info-tip"
import { useDex } from "~/client/lib/dex"
import { AGENT_COLORS, AGENT_ICONS, type AgentColor, type AgentDraft } from "~/shared/agents"
import { DEFAULT_MODEL_ID, DEFAULT_THINKING } from "~/shared/models"

export const Route = createFileRoute("/_app/agents/$agentId")({ component: AgentEditorPage })

const blank = (model: string, thinking: AgentDraft["thinking"]): AgentDraft => ({
  name: "",
  description: "",
  icon: "bot",
  color: "emerald",
  instructions: "",
  starter: "",
  model,
  thinking,
  mcpServers: []
})

const field = "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none md:text-sm"

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-center gap-1 text-sm font-medium text-zinc-200">
        {label}
        {hint && <InfoTip>{hint}</InfoTip>}
      </span>
      
      <div className="mt-2">{children}</div>
    </label>
  )
}

/** Keyed by id: moving from one item (or “new”) to another starts a fresh draft instead of keeping the last one. */
function AgentEditorPage() {
  const { agentId } = Route.useParams()
  return <AgentEditor key={agentId} />
}

function AgentEditor() {
  const { agentId } = Route.useParams()
  const { state, stub } = useDex()
  const navigate = useNavigate()
  const isNew = agentId === "new"
  const existing = state?.agents.find((agent) => agent.id === agentId)
  const [draft, setDraft] = useState<AgentDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load once the agent (or the defaults for a new one) is known.
  useEffect(() => {
    if (draft || !state) return
    if (isNew) setDraft(blank(state.settings.defaultModel ?? DEFAULT_MODEL_ID, state.settings.defaultThinking ?? DEFAULT_THINKING))
    else if (existing) setDraft({ ...existing })
  }, [state, existing, isNew, draft])

  if (!state) return <PageSkeleton variant="form" />
  if (!isNew && !existing) {
    return (
      <div className="p-8 text-sm text-zinc-500">
        This agent no longer exists.{" "}
        <Link to="/agents" className="text-emerald-400 hover:underline">
          Back to agents
        </Link>
      </div>
    )
  }
  if (!draft) return null

  const update = (patch: Partial<AgentDraft>) => {
    setDraft({ ...draft, ...patch })
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const result = await stub.saveAgent(draft)
      setDraft({ ...result })
      setSaved(true)
      if (isNew) await navigate({ to: "/agents/$agentId", params: { agentId: result.id }, replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pt-10">
        <Link to="/agents" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200">
          <ArrowLeft className="size-4" /> Agents
        </Link>

        {/* Live preview of how the agent appears on the Home Screen. */}
        <div className="mb-6 flex items-center gap-4">
          <AgentAvatar icon={draft.icon} color={draft.color} size={56} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{draft.name || (isNew ? "New agent" : "Untitled")}</h1>
            <p className="truncate text-sm text-zinc-400">{draft.description || "Describe what this agent is for"}</p>
          </div>
        </div>

        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input value={draft.name} onChange={(event) => update({ name: event.target.value })} placeholder="PR Reviewer" maxLength={60} className={field} required />
            </Field>
            <Field label="Description">
              <input
                value={draft.description}
                onChange={(event) => update({ description: event.target.value })}
                placeholder="Reviews pull requests for bugs"
                maxLength={200}
                className={field}
              />
            </Field>
          </div>

          <Field label="Icon">
            <div className="flex flex-wrap gap-1.5">
              {AGENT_ICONS.map((icon) => {
                const Icon = AGENT_ICON_COMPONENTS[icon]
                const selected = icon === draft.icon
                return (
                  <button
                    key={icon}
                    type="button"
                    title={icon}
                    aria-pressed={selected}
                    onClick={() => update({ icon })}
                    className={`flex size-9 items-center justify-center rounded-lg border ${
                      selected ? "border-emerald-500 bg-emerald-950/40 text-emerald-300" : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
                    }`}
                  >
                    <Icon className="size-4.5" />
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label="Color">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(AGENT_COLORS) as AgentColor[]).map((color) => {
                const [background, foreground] = AGENT_COLORS[color]
                const selected = color === draft.color
                return (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    aria-pressed={selected}
                    onClick={() => update({ color })}
                    className={`flex size-9 items-center justify-center rounded-full ring-offset-2 ring-offset-zinc-950 ${selected ? "ring-2 ring-zinc-200" : ""}`}
                    style={{ background }}
                  >
                    <span className="size-3.5 rounded-full" style={{ background: foreground }} />
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label="Model and thinking" hint="New chats with this agent start with these; you can still change them per chat.">
            <ModelPicker model={draft.model} thinking={draft.thinking} onChange={(value) => update(value)} />
          </Field>

          <Field label="MCP servers" hint="Attached to new chats with this agent; you can still change them per chat.">
            {state.mcp.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No MCP servers yet.{" "}
                <Link to="/mcp/$serverId" params={{ serverId: "new" }} className="text-emerald-400 hover:underline">
                  Connect one
                </Link>
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {state.mcp.map((server) => {
                  const selected = draft.mcpServers?.includes(server.id) ?? false
                  return (
                    <button
                      key={server.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        update({
                          mcpServers: selected ? (draft.mcpServers ?? []).filter((id) => id !== server.id) : [...(draft.mcpServers ?? []), server.id]
                        })
                      }
                      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                        selected ? "border-emerald-600/70 bg-emerald-950/40 text-emerald-200" : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      {selected ? <Check className="size-3.5" /> : <Plug className="size-3.5" />}
                      {server.name}
                      <McpStatusDot status={server.status} />
                    </button>
                  )
                })}
              </div>
            )}
          </Field>

          <Field label="Instructions" hint="The agent's role and workflow, added to the system prompt of its chats. Edits apply to existing chats too.">
            <textarea
              value={draft.instructions}
              onChange={(event) => update({ instructions: event.target.value })}
              rows={10}
              placeholder={"You review pull requests like a careful senior engineer.\n1. …"}
              className={`${field} font-mono text-[13px] leading-relaxed md:text-xs`}
            />
          </Field>

          <Field label="Starter prompt" hint="Prefilled in the message box when you pick this agent.">
            <input
              value={draft.starter}
              onChange={(event) => update({ starter: event.target.value })}
              placeholder="Review https://github.com/OWNER/REPO/pull/"
              className={field}
            />
          </Field>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-zinc-900 bg-zinc-950/90 px-4 py-3 backdrop-blur">
            <button
              type="submit"
              disabled={saving || !draft.name.trim()}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
              {isNew ? "Create agent" : saved ? "Saved" : "Save"}
            </button>
            {!isNew && (
              <>
                <Link
                  to="/chat"
                  search={{ agent: agentId }}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  <MessageSquarePlus className="size-4" /> Start chat
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(`Delete “${draft.name}”? Its chats stay, as plain chats.`)) return
                    await stub.deleteAgent(agentId)
                    await navigate({ to: "/agents" })
                  }}
                  className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:text-red-400"
                >
                  <Trash2 className="size-4" /> Delete
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
