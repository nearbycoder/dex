import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Check, LoaderCircle, MessageCircle, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { ask } from "~/client/components/confirm-dialog"
import { EditorSkeleton } from "~/client/components/skeleton"
import { SpaceGlyph } from "~/client/components/space-panel"
import { Field, inputClass } from "~/client/components/ui"
import { useDex } from "~/client/lib/dex"
import { MAX_SPACE_GOAL, MAX_SPACE_NAME, type SpaceDraft, spaceThreads } from "~/shared/spaces"

export const Route = createFileRoute("/_app/spaces/$spaceId")({ component: SpaceEditorPage })

function SpaceEditorPage() {
  const { spaceId } = Route.useParams()
  return <SpaceEditor key={spaceId} />
}

/** A space's name, goal, and project; creating one opens its chat, where you tell it what to work on. */
function SpaceEditor() {
  const { spaceId } = Route.useParams()
  const { state, stub } = useDex()
  const navigate = useNavigate()
  const isNew = spaceId === "new"
  const existing = state?.spaces?.find((space) => space.id === spaceId)
  const [draft, setDraft] = useState<SpaceDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (draft || !state) return
    if (isNew) setDraft({ name: "", goal: "", projectId: null })
    else if (existing) setDraft({ id: existing.id, name: existing.name, goal: existing.goal, projectId: existing.projectId })
  }, [state, existing, isNew, draft])

  if (!state) return <EditorSkeleton kind="space" />
  if (!isNew && !existing) {
    return (
      <div className="p-8 text-sm text-zinc-500">
        This space no longer exists.{" "}
        <Link to="/chat" className="text-emerald-400 hover:underline">
          Back to chats
        </Link>
      </div>
    )
  }
  if (!draft) return null

  const update = (patch: Partial<SpaceDraft>) => {
    setDraft({ ...draft, ...patch })
    setSaved(false)
  }
  const threads = existing ? spaceThreads(existing, state.sessions) : []

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const result = await stub.saveSpace(draft)
      setDraft({ id: result.id, name: result.name, goal: result.goal, projectId: result.projectId })
      setSaved(true)
      // A new space: straight to telling it what to work on.
      if (isNew) await navigate({ to: "/chat/$sessionId", params: { sessionId: result.sessionId } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pt-10">
        <Link
          to={existing ? "/chat/$sessionId" : "/chat"}
          params={existing ? { sessionId: existing.sessionId } : undefined}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" /> {existing ? existing.name : "Chats"}
        </Link>

        <div className="mb-6 flex items-center gap-4">
          <SpaceGlyph size={56} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{draft.name || (isNew ? "New space" : "Untitled")}</h1>
            <p className="truncate text-sm text-zinc-400">
              {isNew ? "One conversation that starts and directs threads for you." : `${threads.length} thread${threads.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <Field label="Name">
            <input
              autoFocus={isNew}
              value={draft.name}
              maxLength={MAX_SPACE_NAME}
              onChange={(event) => update({ name: event.target.value })}
              placeholder="Launch week, Security review, Billing v2…"
              className={inputClass}
            />
          </Field>
          <Field label="Goal" hint="What the work is for; Dex keeps the threads pointed at it. Optional.">
            <textarea
              value={draft.goal ?? ""}
              maxLength={MAX_SPACE_GOAL}
              rows={4}
              onChange={(event) => update({ goal: event.target.value })}
              placeholder="Ship service accounts and handle what comes in after launch."
              className={`${inputClass} resize-y`}
            />
          </Field>
          <Field label="Project" hint="Threads work in this project, each on its own VM with the repos cloned.">
            <select value={draft.projectId ?? ""} onChange={(event) => update({ projectId: event.target.value || null })} className={inputClass}>
              <option value="">No project</option>
              {state.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-zinc-900 bg-zinc-950/90 px-4 py-3 backdrop-blur">
            <button
              type="submit"
              disabled={saving || !draft.name.trim()}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
              {isNew ? "Create space" : saved ? "Saved" : "Save"}
            </button>
            {existing && (
              <>
                <Link
                  to="/chat/$sessionId"
                  params={{ sessionId: existing.sessionId }}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  <MessageCircle className="size-4" /> Open
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    const body = `Deletes the space, its chat, and its ${threads.length} thread${threads.length === 1 ? "" : "s"} with their VMs. Its notes stay in the workspace. This can't be undone.`
                    if (!(await ask({ title: `Delete ${existing.name}?`, body, confirm: "Delete" }))) return
                    await stub.deleteSpace(existing.id)
                    await navigate({ to: "/chat" })
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
