import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Ban, Check, LoaderCircle, MessageSquarePlus, Plus, Search, Trash2, X } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { AGENT_ICON_COMPONENTS, AgentAvatar } from "~/client/components/agent-avatar"
import { RepoCard, RepoSheet } from "~/client/components/repo-picker"
import { EditorSkeleton } from "~/client/components/skeleton"
import { InfoTip } from "~/client/components/info-tip"
import { useDex } from "~/client/lib/dex"
import { AGENT_COLORS, AGENT_ICONS, type AgentColor } from "~/shared/agents"
import { githubFullName, normalizeRepoUrl, type ProjectDraft, type ProjectImageCandidate, type ProjectRepo, repoLabel } from "~/shared/projects"
import { VM_SIZES, type VmSize } from "~/shared/protocol"

export const Route = createFileRoute("/_app/projects/$projectId")({ component: ProjectEditorPage })

const blank: ProjectDraft = {
  name: "",
  description: "",
  icon: "briefcase",
  color: "sky",
  repos: [],
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
      <span className="flex items-center gap-1 text-sm font-medium text-zinc-200">
        {label}
        {hint && <InfoTip>{hint}</InfoTip>}
      </span>
      
      <div className="mt-2">{children}</div>
    </div>
  )
}

/** Under the repo list: why private repos might be missing, and the fix. */
function GitHubNote() {
  const { state } = useDex()
  const github = state?.github
  if (!github) return null
  if (github.connected && github.expired) {
    return (
      <p className="text-xs text-amber-300/90">
        GitHub stopped accepting your connection, so private repos won't clone.{" "}
        {github.via === "oauth" ? (
          <a href="/auth/github/connect" className="font-medium underline">
            Reconnect
          </a>
        ) : (
          <Link to="/settings" className="font-medium underline">
            Replace the token
          </Link>
        )}
      </p>
    )
  }
  if (!github.connected) {
    return (
      <p className="text-xs text-zinc-500">
        Public repos only until you{" "}
        <Link to="/settings" className="text-zinc-300 underline">
          connect GitHub
        </Link>
        .
      </p>
    )
  }
  return null
}

/**
 * The project's picture: favicons, app icons, and logos found in its first GitHub repo, or the owner's avatar, shown
 * instead of the icon. Looked up on its own when the project has a repo and no picture yet; otherwise on request.
 */
function ProjectPicture({ draft, onChange }: { draft: ProjectDraft; onChange: (image: string | null) => void }) {
  const { stub } = useDex()
  const repo = draft.repos.map((entry) => githubFullName(normalizeRepoUrl(entry.url) ?? "")).find((name): name is string => Boolean(name))
  const [found, setFound] = useState<{ repo: string; candidates: ProjectImageCandidate[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const look = async (name: string) => {
    setLoading(true)
    setError(null)
    try {
      const candidates = await stub.projectImageCandidates(name)
      setFound((current) => (repo === name || !current ? { repo: name, candidates } : current))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (repo && !draft.image && found?.repo !== repo) void look(repo)
    // Only when the repo changes; picking a picture shouldn't search again.
  }, [repo])

  if (!repo) return <p className="text-xs text-zinc-500">Add a GitHub repo to use its favicon or logo.</p>
  const candidates = found?.repo === repo ? found.candidates : []
  const tile = "flex size-12 items-center justify-center rounded-xl border p-2 transition"
  const selectedTile = "border-emerald-500 bg-emerald-950/40"
  const idleTile = "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" title="No picture: the icon below" aria-pressed={!draft.image} onClick={() => onChange(null)} className={`${tile} ${!draft.image ? selectedTile : idleTile}`}>
          <Ban className="size-4 text-zinc-500" />
        </button>
        {draft.image && !candidates.some((candidate) => candidate.dataUrl === draft.image) && (
          <span title="Current picture" className={`${tile} ${selectedTile}`}>
            <img src={draft.image} alt="" className="size-full object-contain" />
          </span>
        )}
        {candidates.map((candidate) => {
          const selected = draft.image === candidate.dataUrl
          return (
            <button
              key={candidate.path}
              type="button"
              title={candidate.path === "avatar" ? `${repo.split("/")[0]}'s GitHub avatar` : candidate.path}
              aria-pressed={selected}
              onClick={() => onChange(candidate.dataUrl)}
              className={`${tile} ${selected ? selectedTile : idleTile}`}
            >
              <img src={candidate.dataUrl} alt={candidate.path} className={`size-full object-contain ${candidate.path === "avatar" ? "rounded-md" : ""}`} />
            </button>
          )
        })}
        {loading ? (
          <span className="flex items-center gap-1.5 px-1 text-xs text-zinc-500">
            <LoaderCircle className="size-3.5 animate-spin" /> Looking in {repo}…
          </span>
        ) : (
          found?.repo !== repo && (
            <button type="button" onClick={() => void look(repo)} className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-300 hover:border-zinc-700">
              <Search className="size-3.5" /> Find in {repo}
            </button>
          )
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {found?.repo === repo && !loading && (
        <p className="text-xs text-zinc-500">{candidates.length ? `From ${repo}. Hover a picture for its file.` : `No favicon or logo found in ${repo}.`}</p>
      )}
    </div>
  )
}

/** Keyed by id: moving from one item (or “new”) to another starts a fresh draft instead of keeping the last one. */
function ProjectEditorPage() {
  const { projectId } = Route.useParams()
  return <ProjectEditor key={projectId} />
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
  // The repo sheet: adding one (index null) or editing the repo at index.
  const [sheet, setSheet] = useState<{ index: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (draft || !state) return
    if (isNew) setDraft(blank)
    else if (existing) setDraft({ ...existing })
  }, [state, existing, isNew, draft])

  if (!state) return <EditorSkeleton kind="project" />
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
      setDraft({ ...result })
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
          <AgentAvatar icon={draft.icon} color={draft.color} image={draft.image} size={56} />
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

          <Field label="Repositories" hint="Cloned into ~/work/<folder> on each chat's VM. Add your GitHub repos (private and org ones included), any public repo, or a git URL.">
            <div className="space-y-2">
              {draft.repos.filter((repo) => repo.url.trim()).map((repo, index) => (
                <RepoCard
                  key={`${repo.url}:${index}`}
                  repo={repo}
                  onEdit={() => setSheet({ index })}
                  onRemove={() => update({ repos: draft.repos.filter((_, i) => i !== index) })}
                />
              ))}
              <button
                type="button"
                onClick={() => setSheet({ index: null })}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700 py-3 text-sm text-zinc-300 hover:border-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-100"
              >
                <Plus className="size-4" /> Add repository
              </button>
              <GitHubNote />
            </div>
          </Field>
          {sheet && (
            <RepoSheet
              editing={sheet.index === null ? null : (draft.repos[sheet.index] ?? null)}
              existing={new Set(draft.repos.map((repo) => repoLabel(repo.url).toLowerCase()))}
              onClose={() => setSheet(null)}
              onSave={(repo: ProjectRepo) => {
                update({ repos: sheet.index === null ? [...draft.repos, repo] : draft.repos.map((each, i) => (i === sheet.index ? repo : each)) })
                setSheet(null)
              }}
            />
          )}

          <Field
            label="Setup script"
            hint={
              <>
                Bash, run once in ~/work after cloning each new VM, with <code>set -e</code>. It can run for up to 30 minutes; its log is
                ~/work/.dex/setup.log. Changes apply to new VMs; on an existing one, use “Re-run setup” on its Machine page.
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

          <Field label="Picture" hint="A favicon or logo from the project's repo, shown instead of the icon.">
            <ProjectPicture draft={draft} onChange={(image) => update({ image })} />
          </Field>

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

          {error && <p className="text-sm break-words text-red-400">{error}</p>}

          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-zinc-900 bg-zinc-950/90 px-4 py-3 backdrop-blur">
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
        </form>
      </div>
    </div>
  )
}
