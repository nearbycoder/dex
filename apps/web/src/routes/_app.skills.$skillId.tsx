import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Check, ExternalLink, FileText, LoaderCircle, RefreshCw, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { SkillEditorSkeleton } from "~/client/components/skeleton"
import { Field, FormBar, inputClass, Switch } from "~/client/components/ui"
import { useDex } from "~/client/lib/dex"
import { type SkillDetail, skillSlug } from "~/shared/skills"

export const Route = createFileRoute("/_app/skills/$skillId")({ component: SkillEditorPage })

interface Draft {
  name: string
  description: string
  instructions: string
  auto: boolean
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Keyed by id: moving between skills (or to “new”) starts a fresh draft. */
function SkillEditorPage() {
  const { skillId } = Route.useParams()
  return <SkillEditor key={skillId} />
}

function SkillEditor() {
  const { skillId } = Route.useParams()
  const { state, stub, connected } = useDex()
  const navigate = useNavigate()
  const isNew = skillId === "new"
  const [skill, setSkill] = useState<SkillDetail | null | undefined>(isNew ? null : undefined)
  const [draft, setDraft] = useState<Draft | null>(isNew ? { name: "", description: "", instructions: "", auto: true } : null)
  const [busy, setBusy] = useState<"save" | "update" | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Refetched when the skill changes anywhere (updated from GitHub, edited by a chat).
  const listed = state?.skills.find((entry) => entry.id === skillId)

  useEffect(() => {
    if (isNew || !connected) return
    let current = true
    stub
      .getSkill(skillId)
      .then((detail) => {
        if (!current) return
        setSkill(detail)
        if (detail) setDraft((previous) => previous ?? { name: detail.id, description: detail.description, instructions: detail.instructions, auto: detail.auto })
      })
      .catch((cause: unknown) => current && setError(errorText(cause)))
    return () => {
      current = false
    }
  }, [isNew, connected, stub, skillId, listed?.updatedAt])

  if (skill === null && !isNew) {
    return (
      <div className="p-8 text-sm text-zinc-500">
        This skill no longer exists.{" "}
        <Link to="/skills" className="text-emerald-400 hover:underline">
          Back to skills
        </Link>
      </div>
    )
  }
  if (!draft) return <SkillEditorSkeleton />

  const update = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch })
    setSaved(false)
  }

  const save = async () => {
    setBusy("save")
    setError(null)
    try {
      const result = await stub.saveSkill({ ...(isNew ? {} : { id: skillId }), ...draft })
      setSkill(result)
      setDraft({ name: result.id, description: result.description, instructions: result.instructions, auto: result.auto })
      setSaved(true)
      if (result.id !== skillId) await navigate({ to: "/skills/$skillId", params: { skillId: result.id }, replace: true })
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(null)
    }
  }

  const name = skillSlug(draft.name)

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 pt-6 md:pt-10">
        <Link to="/skills" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200">
          <ArrowLeft className="size-4" /> Skills
        </Link>

        <div className="mb-6 min-w-0">
          <h1 className="truncate font-mono text-2xl font-semibold tracking-tight">/{name || (isNew ? "new-skill" : skillId)}</h1>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-sm text-zinc-400">
            {skill?.source ? (
              <a
                href={`https://github.com/${skill.source}${skill.path ? `/tree/HEAD/${skill.path}` : ""}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 truncate hover:text-zinc-100"
              >
                <span className="truncate">{skill.source}</span> <ExternalLink className="size-3 shrink-0" />
              </a>
            ) : (
              "Start a message with this to use it."
            )}
          </p>
        </div>

        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <Field label="Name" info="What you type after / to use it: lowercase letters, digits, and dashes.">
            <input value={draft.name} onChange={(event) => update({ name: event.target.value })} placeholder="release-notes" maxLength={64} className={`${inputClass} font-mono`} required />
          </Field>
          <Field label="When to use it" info="Chats decide whether a request needs this skill from this description, so say what it's for and when it applies.">
            <textarea
              value={draft.description}
              onChange={(event) => update({ description: event.target.value })}
              rows={3}
              maxLength={1000}
              placeholder="Writes release notes from merged pull requests. Use when asked for a changelog or release notes."
              className={inputClass}
              required
            />
          </Field>
          <Field label="Instructions" info="Markdown, given to the chat when the skill is used.">
            <textarea
              value={draft.instructions}
              onChange={(event) => update({ instructions: event.target.value })}
              rows={16}
              placeholder={"# Release notes\n\n1. List the PRs merged since the last tag…"}
              className={`${inputClass} font-mono text-[13px] leading-relaxed md:text-xs`}
              required
            />
          </Field>
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-zinc-200">Auto</span>
              <span className="block text-xs text-zinc-500">Chats load it on their own when a request matches.</span>
            </span>
            <Switch label="Let chats use this skill on their own" checked={draft.auto} onChange={(auto) => update({ auto })} />
          </div>

          {skill && skill.fileList.length > 0 && (
            <Field as="div" label="Files" info="Come with the skill; chats read them when its instructions say to. Updating from GitHub refreshes them.">
              <ul className="divide-y divide-zinc-800/80 rounded-lg border border-zinc-800">
                {skill.fileList.map((file) => (
                  <li key={file.path} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <FileText className="size-3.5 shrink-0 text-zinc-500" />
                    <span className="min-w-0 flex-1 truncate font-mono text-zinc-300">{file.path}</span>
                    <span className="shrink-0 text-zinc-600">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                  </li>
                ))}
              </ul>
            </Field>
          )}

          {error && <p className="text-sm break-words text-red-400">{error}</p>}

          <FormBar>
            <button
              type="submit"
              disabled={busy !== null || !name || !draft.description.trim() || !draft.instructions.trim()}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {busy === "save" ? <LoaderCircle className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
              {isNew ? "Create skill" : saved ? "Saved" : "Save"}
            </button>
            {skill?.source && (
              <button
                type="button"
                disabled={busy !== null}
                title="Replaces it with the latest from GitHub, edits included"
                onClick={async () => {
                  setBusy("update")
                  setError(null)
                  try {
                    const result = await stub.updateSkill(skillId)
                    setSkill(result)
                    setDraft({ name: result.id, description: result.description, instructions: result.instructions, auto: result.auto })
                  } catch (cause) {
                    setError(errorText(cause))
                  } finally {
                    setBusy(null)
                  }
                }}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
              >
                <RefreshCw className={`size-4 ${busy === "update" ? "animate-spin" : ""}`} /> Update
              </button>
            )}
            {!isNew && (
              <button
                type="button"
                onClick={async () => {
                  if (!confirm(`Remove /${skillId}? Chats stop using it.`)) return
                  await stub.removeSkill(skillId)
                  await navigate({ to: "/skills" })
                }}
                className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:text-red-400"
              >
                <Trash2 className="size-4" /> Remove
              </button>
            )}
          </FormBar>
        </form>
      </div>
    </div>
  )
}
