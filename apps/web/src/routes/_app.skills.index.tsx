import { createFileRoute, Link } from "@tanstack/react-router"
import { Check, ChevronRight, Download, ExternalLink, LoaderCircle, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react"
import { useState } from "react"
import { InfoTip } from "~/client/components/info-tip"
import { SkillCardsSkeleton } from "~/client/components/skeleton"
import { Switch } from "~/client/components/ui"
import { useDex } from "~/client/lib/dex"
import { useSkillSearch } from "~/client/lib/skills"
import { type DirectorySkill, formatInstalls, type SkillInfo, type SkillPreview } from "~/shared/skills"

export const Route = createFileRoute("/_app/skills/")({ component: SkillsPage })

const iconButton = "rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
const SUGGESTIONS = ["pdf", "frontend design", "code review", "testing", "docs", "seo"]

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** One skills.sh result: install it straight away, or open it to read what it would add first. */
function ResultRow({ skill, installed }: { skill: DirectorySkill; installed: boolean }) {
  const { stub } = useDex()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<SkillPreview | null>(null)
  const [busy, setBusy] = useState<"preview" | "install" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = async () => {
    setOpen(!open)
    if (open || preview) return
    setBusy("preview")
    setError(null)
    try {
      setPreview(await stub.previewSkill(skill.source, skill.skillId))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(null)
    }
  }

  const install = async () => {
    setBusy("install")
    setError(null)
    try {
      await stub.installSkill(skill.source, skill.skillId)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="border-b border-zinc-800/80 last:border-0">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" onClick={() => void toggle()} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronRight className={`size-4 shrink-0 text-zinc-600 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-zinc-100">{skill.name}</span>
            <span className="block truncate font-mono text-xs text-zinc-500">{skill.source}</span>
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-500" title={`${skill.installs.toLocaleString()} installs`}>
          <Download className="size-3" />
          {formatInstalls(skill.installs)}
        </span>
        {installed ? (
          <span className="flex w-20 shrink-0 items-center justify-center gap-1 text-xs text-emerald-400">
            <Check className="size-3.5" /> Installed
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void install()}
            disabled={busy === "install"}
            className="flex w-20 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-60"
          >
            {busy === "install" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Install
          </button>
        )}
      </div>
      {error && <p className="px-3 pb-2.5 pl-9 text-xs break-words text-red-400">{error}</p>}
      {open && !error && (
        <div className="px-3 pb-3 pl-9">
          {busy === "preview" || !preview ? (
            <p className="flex items-center gap-2 text-xs text-zinc-500">
              <LoaderCircle className="size-3.5 animate-spin" /> Reading it from GitHub…
            </p>
          ) : (
            <>
              <p className="text-sm text-zinc-300">{preview.description || "No description."}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                <span>
                  {preview.files.length ? `SKILL.md + ${preview.files.length} ${preview.files.length === 1 ? "file" : "files"}` : "SKILL.md"} ·{" "}
                  {Math.max(1, Math.round(preview.size / 1024))} KB
                </span>
                <a href={preview.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-100">
                  GitHub <ExternalLink className="size-3" />
                </a>
              </p>
              <details className="group mt-2">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
                  <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" /> Instructions
                </summary>
                <pre className="scrollbar-thin mt-2 max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed whitespace-pre-wrap text-zinc-300">
                  {preview.instructions}
                </pre>
              </details>
            </>
          )}
        </div>
      )}
    </li>
  )
}

function SkillCard({ skill, index }: { skill: SkillInfo; index: number }) {
  const { stub } = useDex()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <li className="animate-rise rounded-xl border border-zinc-800 bg-zinc-900/40 p-4" style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-mono text-sm font-medium text-zinc-100">/{skill.id}</h2>
            <span className="shrink-0 truncate rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{skill.source ?? "Yours"}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">{skill.description}</p>
        </div>
        <div className="-mt-1 -mr-1.5 flex shrink-0 items-center">
          {skill.source && (
            <button
              type="button"
              title="Update from GitHub"
              aria-label={`Update ${skill.id}`}
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await stub.updateSkill(skill.id)
                } catch (cause) {
                  setError(errorText(cause))
                } finally {
                  setBusy(false)
                }
              }}
              className={iconButton}
            >
              <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
            </button>
          )}
          <Link to="/skills/$skillId" params={{ skillId: skill.id }} title="View and edit" aria-label={`Edit ${skill.id}`} className={iconButton}>
            <Pencil className="size-4" />
          </Link>
          <button
            type="button"
            title="Remove"
            aria-label={`Remove ${skill.id}`}
            onClick={async () => {
              if (!confirm(`Remove /${skill.id}? Chats stop using it.`)) return
              await stub.removeSkill(skill.id)
            }}
            className={`${iconButton} hover:text-red-400`}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="text-zinc-500">
          {skill.files ? `${skill.files + 1} files` : "1 file"} · {Math.max(1, Math.round(skill.size / 1024))} KB
        </span>
        <span className="ml-auto flex items-center gap-2 text-zinc-400">
          Auto
          <InfoTip label="About auto">On: chats load it by themselves when a request matches. Off: only when you start a message with /{skill.id}.</InfoTip>
          <Switch label={`Let chats use ${skill.id} on their own`} checked={skill.auto} onChange={(on) => void stub.setSkillAuto(skill.id, on)} />
        </span>
      </div>
      {error && <p className="mt-2 text-xs break-words text-red-400">{error}</p>}
    </li>
  )
}

function SkillsPage() {
  const { state } = useDex()
  const [query, setQuery] = useState("")
  const search = useSkillSearch(query)
  const skills = state?.skills ?? []
  const installed = new Set(skills.map((skill) => `${skill.source}/${skill.path?.split("/").pop() ?? skill.id}`))
  const searching = query.trim().length >= 2

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pt-10">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">Skills</h1>
            <InfoTip label="About skills">
              Instructions for particular tasks. Start a message with /name to use one, or let chats pick them up on their own (Auto). Skills come from
              other people's repos: read one before installing it.
            </InfoTip>
          </div>
          <Link
            to="/skills/$skillId"
            params={{ skillId: "new" }}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            <Plus className="size-4" /> New skill
          </Link>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills.sh"
            aria-label="Search skills.sh"
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

        {searching ? (
          <div className="mt-3">
            {search.error ? (
              <p className="px-1 text-sm text-red-400">{search.error}</p>
            ) : search.results.length > 0 ? (
              <ul className="animate-fade overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
                {search.results.map((skill) => (
                  <ResultRow key={skill.id} skill={skill} installed={installed.has(skill.id)} />
                ))}
              </ul>
            ) : (
              !search.loading && search.query === query.trim() && <p className="px-1 text-sm text-zinc-500">No skills match “{query.trim()}”.</p>
            )}
          </div>
        ) : (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setQuery(suggestion)}
                className="rounded-full border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <h2 className="mt-8 mb-2 px-1 text-xs font-medium tracking-wide text-zinc-500 uppercase">Installed</h2>
        {!state ? (
          <SkillCardsSkeleton count={2} />
        ) : skills.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
            No skills yet. Search skills.sh above, or write your own.
          </p>
        ) : (
          <ul className="grid gap-3">
            {skills.map((skill, index) => (
              <SkillCard key={skill.id} skill={skill} index={index} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
