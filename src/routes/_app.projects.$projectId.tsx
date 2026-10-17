import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Check, LoaderCircle, MessageSquarePlus, Plus, Trash2, X } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { AGENT_ICON_COMPONENTS, AgentAvatar } from "~/client/components/agent-avatar"
import { useDex } from "~/client/lib/dex"
import { AGENT_COLORS, AGENT_ICONS, type AgentColor } from "~/shared/agents"
import { type ProjectDraft, repoDirName } from "~/shared/projects"
import { VM_SIZES, type VmSize } from "~/shared/protocol"

export const Route = createFileRoute("/_app/projects/$projectId")({ component: ProjectEditor })

const blank: ProjectDraft = {
  name: "",
  description: "",
  icon: "briefcase",
  color: "sky",
  repos: [{ url: "", branch: "", dir: "" }],
  setupScript: "",
  instructions: "",
  starter: "",
  vmSize: null
}

const fieldBase =
  "rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none md:text-sm"
const field = `w-full ${fieldBase}`

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-zinc-500">{hint}</span>}
      <div className="mt-2">{children}</div>
    </div>
  )
}

function ProjectEditor() {
  const { projectId } = Route.useParams()
  const { state, stub } = useDex()
  const navigate = useNavigate()
  const isNew = projectId === "new"
  const existing = state?.projects.find((project) => project.id === projectId)
  const [draft, setDraft] = useState<ProjectDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (draft || !state) return
    if (isNew) setDraft(blank)
    else if (existing) setDraft({ ...existing, repos: existing.repos.length ? existing.repos : blank.repos })
  }, [state, existing, isNew, draft])

  if (!state) return <div className="p-8 text-sm text-zinc-500">Connecting to your agent…</div>
  if (!isNew && !existing) {
    return (
      <div className="p-8 text-sm text-zinc-500">
        This project no longer exists.{" "}
        <Link to="/projects" className="text-emerald-400 hover:underline">
          Back to projects
        </Link>
      </div>
    )
  }
  if (!draft) return null

  const update = (patch: Partial<ProjectDraft>) => {
    setDraft({ ...draft, ...patch })
    setSaved(false)
  }
  const setRepo = (index: number, patch: Partial<ProjectDraft["repos"][number]>) =>
    update({ repos: draft.repos.map((repo, i) => (i === index ? { ...repo, ...patch } : repo)) })

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const result = await stub.saveProject(draft)
      setDraft({ ...result, repos: result.repos.length ? result.repos : blank.repos })
      setSaved(true)
      if (isNew) await navigate({ to: "/projects/$projectId", params: { projectId: result.id }, replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pt-10">
        <Link to="/projects" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200">
          <ArrowLeft className="size-4" /> Projects
        </Link>

        <div className="mb-6 flex items-center gap-4">
          <AgentAvatar icon={draft.icon} color={draft.color} size={56} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{draft.name || (isNew ? "New project" : "Untitled")}</h1>
            <p className="truncate text-sm text-zinc-400">{draft.description || "What this project is"}</p>
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
            <label className="block">
              <span className="text-sm font-medium text-zinc-200">Name</span>
              <input value={draft.name} onChange={(event) => update({ name: event.target.value })} placeholder="Dex" maxLength={60} required className={`${field} mt-2`} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-zinc-200">Description</span>
              <input
                value={draft.description}
                onChange={(event) => update({ description: event.target.value })}
                placeholder="Agent harness on Cloudflare"
                maxLength={200}
                className={`${field} mt-2`}
              />
            </label>
          </div>

          <Field label="Repositories" hint="Cloned into ~/work/<folder> on each chat's VM. Use owner/repo for GitHub, or any https:// git URL.">
            <div className="space-y-2">
              {draft.repos.map((repo, index) => (
                <div key={index} className="flex flex-wrap gap-2 rounded-lg border border-zinc-800/80 p-2 sm:flex-nowrap sm:border-0 sm:p-0">
                  <input
                    value={repo.url}
                    onChange={(event) => setRepo(index, { url: event.target.value })}
                    placeholder="owner/repo"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className={`${fieldBase} w-full min-w-0 font-mono sm:flex-[3]`}
                  />
                  <input
                    value={repo.branch}
                    onChange={(event) => setRepo(index, { branch: event.target.value })}
                    placeholder="branch"
                    autoCapitalize="off"
                    spellCheck={false}
                    className={`${fieldBase} min-w-0 flex-1 font-mono`}
                  />
                  <input
                    value={repo.dir}
                    onChange={(event) => setRepo(index, { dir: event.target.value })}
                    placeholder={repo.url ? repoDirName(repo.url) : "folder"}
                    autoCapitalize="off"
                    spellCheck={false}
                    className={`${fieldBase} min-w-0 flex-1 font-mono`}
                  />
                  <button
                    type="button"
                    title="Remove repository"
                    onClick={() => update({ repos: draft.repos.filter((_, i) => i !== index) })}
                    className="shrink-0 rounded-lg px-2 text-zinc-500 hover:text-red-400"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => update({ repos: [...draft.repos, { url: "", branch: "", dir: "" }] })}
                className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100"
              >
                <Plus className="size-4" /> Add repository
              </button>
              {!state.github.connected && (
                <p className="text-xs text-amber-300/90">
                  GitHub isn't connected, so only public repos clone.{" "}
                  <Link to="/settings" className="underline">
                    Connect it in Settings
                  </Link>
                </p>
              )}
            </div>
          </Field>

          <Field
            label="Setup script"
            hint={
              <>
                Bash, run once in ~/work after cloning each new VM, with <code>set -e</code>. It can run for up to 30 minutes; its log is ~/work/.dex/setup.log.
              </>
            }
          >
            <textarea
              value={draft.setupScript}
              onChange={(event) => update({ setupScript: event.target.value })}
              rows={6}
              spellCheck={false}
              placeholder={"cd my-app\nnpm ci\ncp .env.example .env"}
              className={`${field} font-mono text-[13px] leading-relaxed md:text-xs`}
            />
          </Field>

          <Field label="Notes for Dex" hint="Architecture, conventions, how to run and test. Added to the system prompt of this project's chats.">
            <textarea
              value={draft.instructions}
              onChange={(event) => update({ instructions: event.target.value })}
              rows={5}
              placeholder={"TypeScript monorepo. Run `npm test` before committing.\nPRs go against main."}
              className={`${field} text-[13px] leading-relaxed md:text-sm`}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starter prompt" hint="Prefilled when you pick the project.">
              <input value={draft.starter} onChange={(event) => update({ starter: event.target.value })} placeholder="In my-app, " className={field} />
            </Field>
            <Field label="VM size" hint="For this project's chats.">
              <select
                value={draft.vmSize ?? ""}
                onChange={(event) => update({ vmSize: (event.target.value || null) as VmSize | null })}
                className={field}
              >
                <option value="">Default ({state.settings.vmSize})</option>
                {VM_SIZES.map((size) => (
                  <option key={size.id} value={size.id}>
                    {size.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Icon">
            <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-12">
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
                    className={`flex aspect-square items-center justify-center rounded-lg border ${
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

          {error && <p className="text-sm break-words text-red-400">{error}</p>}

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-900 pt-5">
            <button
              type="submit"
              disabled={saving || !draft.name.trim()}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
              {isNew ? "Create project" : saved ? "Saved" : "Save"}
            </button>
            {!isNew && (
              <>
                <Link
                  to="/chat"
                  search={{ project: projectId }}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  <MessageSquarePlus className="size-4" /> Start chat
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(`Delete “${draft.name}”? Its chats and their VMs stay.`)) return
                    await stub.deleteProject(projectId)
                    await navigate({ to: "/projects" })
                  }}
                  className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:text-red-400"
                >
                  <Trash2 className="size-4" /> Delete
                </button>
              </>
            )}
          </div>
          <p className="text-xs text-zinc-600">Changes apply to new chats' VMs. On an existing VM, use “Re-run setup” on the Machines page.</p>
        </form>
      </div>
    </div>
  )
}
