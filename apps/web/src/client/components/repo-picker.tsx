import { Link } from "@tanstack/react-router"
import { ArrowLeft, Check, ChevronRight, ExternalLink, GitBranch, GitFork, Link2, LoaderCircle, Lock, Pencil, Search, Star, X } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import { type GitHubAccess, type GitHubRepo, type ProjectRepo, repoDirName, repoLabel } from "~/shared/projects"
import { GitHubMark } from "./github-mark"

const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** A few languages' GitHub colors, for the dot beside a repo's language. */
const LANGUAGE_COLOR: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572a5",
  Rust: "#dea584",
  Go: "#00add8",
  Swift: "#f05138",
  Kotlin: "#a97bff",
  Java: "#b07219",
  Ruby: "#701516",
  "C#": "#178600",
  "C++": "#f34b7d",
  C: "#555555",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Dart: "#00b4ab",
  PHP: "#4f5d95",
  Elixir: "#6e4a7e"
}

/** An owner's avatar in a fixed box (so it can't collapse), falling back to their initial. */
export function RepoAvatar({ owner, src, size = "size-9" }: { owner: string; src?: string; size?: string }) {
  const [failed, setFailed] = useState(false)
  const url = src || `https://avatars.githubusercontent.com/${encodeURIComponent(owner)}?s=96`
  return (
    <span className={`relative flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-800 text-sm font-semibold text-zinc-300 uppercase`}>
      {owner.slice(0, 1)}
      {!failed && <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />}
    </span>
  )
}

const isGitHub = (url: string) => GITHUB_SHORTHAND.test(repoLabel(url))

/** One repo in the project editor: who and what, its branch and folder; tap to change, × to remove. */
export function RepoCard({ repo, onEdit, onRemove }: { repo: ProjectRepo; onEdit: () => void; onRemove: () => void }) {
  const label = repoLabel(repo.url)
  const github = isGitHub(repo.url)
  const [owner = "", name = label] = github ? label.split("/") : []
  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
      <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {github ? (
          <RepoAvatar owner={owner} />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-400">
            <Link2 className="size-4" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-zinc-100">
            {github ? (
              <>
                <span className="text-zinc-500">{owner}/</span>
                <span className="font-medium">{name}</span>
              </>
            ) : (
              <span className="font-mono text-xs">{label}</span>
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
            <span className="inline-flex min-w-0 items-center gap-1">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate">{repo.branch || "default branch"}</span>
            </span>
            <span className="truncate font-mono">~/work/{repo.dir || repoDirName(repo.url)}</span>
          </span>
        </span>
        <Pencil className="size-3.5 shrink-0 text-zinc-600" />
      </button>
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="shrink-0 rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400">
        <X className="size-4" />
      </button>
    </div>
  )
}

/** The panel: full height on phones (sized to what the keyboard leaves), a dialog on larger screens. */
function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    addEventListener("keydown", onKey)
    // The page behind doesn't scroll while the sheet is open.
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      removeEventListener("keydown", onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])
  return createPortal(
    <div className="fixed inset-x-0 top-0 z-50 flex h-[var(--app-height,100dvh)] items-end justify-center md:items-center md:p-6">
      <div className="absolute inset-0 animate-fade bg-black/70" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex h-full w-full animate-rise flex-col overflow-hidden bg-zinc-950 pt-[env(safe-area-inset-top)] md:h-[min(720px,100%)] md:max-w-xl md:rounded-2xl md:border md:border-zinc-800 md:pt-0 md:shadow-2xl md:shadow-black/60"
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

function SheetHeader({ title, onBack, onClose }: { title: ReactNode; onBack?: () => void; onClose: () => void }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-900 px-2">
      {onBack ? (
        <button type="button" onClick={onBack} aria-label="Back" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
          <ArrowLeft className="size-5" />
        </button>
      ) : (
        <span className="w-2" />
      )}
      <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-zinc-100">{title}</h2>
      <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
        <X className="size-5" />
      </button>
    </div>
  )
}

function RepoRow({ repo, added, onPick }: { repo: GitHubRepo; added: boolean; onPick: () => void }) {
  const [owner, name] = repo.fullName.split("/")
  return (
    <button
      type="button"
      disabled={added}
      onClick={onPick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-zinc-900 active:bg-zinc-900 disabled:opacity-50"
    >
      <RepoAvatar owner={repo.owner} src={repo.ownerAvatar} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-sm text-zinc-100">
            <span className="text-zinc-500">{owner}/</span>
            <span className="font-medium">{name}</span>
          </span>
          {repo.private && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-800/60 px-1.5 py-px text-[10px] font-medium text-amber-300">
              <Lock className="size-2.5" /> Private
            </span>
          )}
          {repo.fork && <GitFork className="size-3 shrink-0 text-zinc-500" aria-label="Fork" />}
          {repo.archived && <span className="shrink-0 rounded-full border border-zinc-700 px-1.5 py-px text-[10px] text-zinc-400">Archived</span>}
        </span>
        {repo.description && <span className="mt-0.5 block truncate text-xs text-zinc-400">{repo.description}</span>}
        <span className="mt-1 flex items-center gap-3 text-[11px] text-zinc-500">
          {repo.language && (
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: LANGUAGE_COLOR[repo.language] ?? "#71717a" }} />
              {repo.language}
            </span>
          )}
          {repo.stars > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Star className="size-3" /> {repo.stars.toLocaleString()}
            </span>
          )}
          {repo.pushedAt && <span>pushed {timeAgo(Date.parse(repo.pushedAt))}</span>}
        </span>
      </span>
      {added ? <Check className="size-4 shrink-0 text-emerald-400" aria-label="Added" /> : <ChevronRight className="size-4 shrink-0 text-zinc-600" />}
    </button>
  )
}

function RowsLoading() {
  return (
    <div className="space-y-1 px-1 py-1">
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-3">
          <div className="dex-bone size-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="dex-bone h-3.5 rounded" style={{ width: `${[52, 38, 60, 45, 34][index]}%` }} />
            <div className="dex-bone h-2.5 rounded" style={{ width: `${[70, 55, 40, 64, 50][index]}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Step one: find the repo (yours first, then public), filtered by owner. */
function PickRepo({
  existing,
  onPick,
  onUrl,
  onClose
}: {
  existing: ReadonlySet<string>
  onPick: (repo: GitHubRepo) => void
  onUrl: (url: string) => void
  onClose: () => void
}) {
  const { stub, state } = useDex()
  const github = state?.github
  const [query, setQuery] = useState("")
  const [owner, setOwner] = useState<string | null>(null)
  const [access, setAccess] = useState<GitHubAccess | null>(null)
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [urlMode, setUrlMode] = useState(false)
  const [url, setUrl] = useState("")
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    stub.githubRepoAccess().then(setAccess, () => setAccess(null))
  }, [stub])

  useEffect(() => {
    let current = true
    setError(null)
    const timer = setTimeout(
      () => {
        stub
          .searchGitHubRepos(query.trim(), owner ?? undefined)
          .then((found) => current && setRepos(found))
          .catch((cause: unknown) => current && (setError(errorText(cause)), setRepos([])))
      },
      query ? 250 : 0
    )
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [query, owner, stub])

  const owners = access?.connected && access.login ? [{ login: access.login, avatarUrl: "" }, ...access.orgs] : []
  const mine = repos?.filter((repo) => repo.accessible) ?? []
  const others = repos?.filter((repo) => !repo.accessible) ?? []

  return (
    <>
      <SheetHeader title="Add a repository" onClose={onClose} />
      <div className="shrink-0 space-y-3 px-4 pt-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            ref={input}
            type="search"
            name="repo-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={owner ? `Search ${owner}'s repos` : "Search your repos and GitHub"}
            aria-label="Search repositories"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900 py-2.5 pr-9 pl-9 text-base text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none md:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear" className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-200">
              <X className="size-4" />
            </button>
          )}
        </div>
        {owners.length > 0 && (
          <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4">
            <button
              type="button"
              onClick={() => setOwner(null)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${owner === null ? "bg-zinc-100 font-medium text-zinc-900" : "border border-zinc-800 text-zinc-300"}`}
            >
              All
            </button>
            {owners.map((each) => (
              <button
                key={each.login}
                type="button"
                onClick={() => setOwner(owner === each.login ? null : each.login)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-xs ${owner === each.login ? "bg-zinc-100 font-medium text-zinc-900" : "border border-zinc-800 text-zinc-300"}`}
              >
                <RepoAvatar owner={each.login} src={each.avatarUrl || undefined} size="size-5" />
                {each.login}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2">
        {github?.connected && github.expired && (
          <Notice>
            GitHub stopped accepting your connection, so only public repos show.{" "}
            {github.via === "oauth" ? <a href="/auth/github/connect" className="font-medium underline">Reconnect</a> : <Link to="/settings" className="font-medium underline">Replace the token</Link>}
          </Notice>
        )}
        {github && !github.connected && (
          <Notice>
            Connect GitHub to see your private and org repos.{" "}
            {github.oauthAvailable ? <a href="/auth/github/connect" className="font-medium underline">Connect</a> : <Link to="/settings" className="font-medium underline">Settings</Link>}
          </Notice>
        )}
        {repos === null ? (
          <RowsLoading />
        ) : error ? (
          <p className="px-4 py-6 text-center text-sm text-red-400">{error}</p>
        ) : repos.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-500">{query ? `No repos match “${query}”.` : "No repos here yet."}</p>
        ) : (
          <>
            {mine.length > 0 && <GroupLabel>{query || owner ? "Your repos" : "Recently pushed"}</GroupLabel>}
            {mine.map((repo) => (
              <RepoRow key={repo.fullName} repo={repo} added={existing.has(repo.fullName.toLowerCase())} onPick={() => onPick(repo)} />
            ))}
            {others.length > 0 && <GroupLabel>Public on GitHub</GroupLabel>}
            {others.map((repo) => (
              <RepoRow key={repo.fullName} repo={repo} added={existing.has(repo.fullName.toLowerCase())} onPick={() => onPick(repo)} />
            ))}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-zinc-900 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {urlMode ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              // The sheet renders in a portal inside the project form, and React bubbles submit through portals:
              // without this, Next would also save the project.
              event.stopPropagation()
              if (url.trim()) onUrl(url.trim())
            }}
          >
            <input
              autoFocus
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://gitlab.com/team/app.git"
              aria-label="Git URL"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-base text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none md:text-sm"
            />
            <button type="submit" disabled={!url.trim()} className="shrink-0 rounded-lg bg-zinc-100 px-3 text-sm font-medium text-zinc-900 disabled:opacity-40">
              Next
            </button>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-3 text-xs">
            <button type="button" onClick={() => setUrlMode(true)} className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-100">
              <Link2 className="size-3.5" /> Use a git URL
            </button>
            {access?.manageUrl && (
              <a href={access.manageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-200">
                {access.via === "oauth" ? "Missing an org? Grant access" : "Edit token access"} <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        )}
      </div>
    </>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="mx-3 mt-2 mb-1 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs leading-relaxed text-amber-200">{children}</p>
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <p className="px-4 pt-3 pb-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{children}</p>
}

/** Step two: which branch, and which folder under ~/work. */
function ConfigureRepo({
  repo,
  url,
  initial,
  editing,
  onBack,
  onClose,
  onSave
}: {
  repo: GitHubRepo | null
  url: string
  initial: ProjectRepo | null
  editing: boolean
  onBack?: () => void
  onClose: () => void
  onSave: (repo: ProjectRepo) => void
}) {
  const { stub } = useDex()
  const fullName = repo?.fullName ?? (isGitHub(url) ? repoLabel(url) : null)
  const [branches, setBranches] = useState<string[] | null>(fullName ? null : [])
  const [branch, setBranch] = useState(initial?.branch ?? "")
  const [filter, setFilter] = useState("")
  const [dir, setDir] = useState(initial?.dir ?? "")
  const target = fullName ?? url

  useEffect(() => {
    if (!fullName) return
    let current = true
    stub.listGitHubBranches(fullName).then(
      (names) => current && setBranches(names),
      () => current && setBranches([])
    )
    return () => {
      current = false
    }
  }, [fullName, stub])

  const defaultBranch = branches?.[0] ?? repo?.defaultBranch ?? null
  // The default branch has its own row above the list (unless you're filtering).
  const shown = (branches ?? []).filter((name) => (filter ? name.toLowerCase().includes(filter.toLowerCase()) : name !== defaultBranch)).slice(0, 100)
  const [owner = "", name = target] = fullName ? fullName.split("/") : []

  return (
    <>
      <SheetHeader title={editing ? "Edit repository" : "Add a repository"} onBack={onBack} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
          {fullName ? (
            <RepoAvatar owner={owner} src={repo?.ownerAvatar} size="size-11" />
          ) : (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-400">
              <Link2 className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-zinc-100">
              {fullName ? (
                <>
                  <span className="text-zinc-500">{owner}/</span>
                  <span className="font-semibold">{name}</span>
                </>
              ) : (
                <span className="font-mono text-xs">{url}</span>
              )}
            </p>
            {repo?.description && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{repo.description}</p>}
            {fullName && (
              <a
                href={`https://github.com/${fullName}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200"
              >
                <GitHubMark className="size-3" /> View on GitHub
              </a>
            )}
          </div>
        </div>

        <p className="mt-6 mb-2 text-sm font-medium text-zinc-200">Branch</p>
        {fullName ? (
          branches === null ? (
            <p className="flex items-center gap-2 py-3 text-xs text-zinc-500">
              <LoaderCircle className="size-3.5 animate-spin" /> Loading branches…
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-zinc-800">
              {branches.length > 8 && (
                <div className="relative border-b border-zinc-800">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-zinc-500" />
                  <input
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder={`Filter ${branches.length} branches`}
                    aria-label="Filter branches"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="w-full bg-transparent py-2.5 pr-3 pl-9 text-base text-zinc-100 placeholder:text-zinc-500 focus:outline-none md:text-sm"
                  />
                </div>
              )}
              <div className="max-h-64 overflow-y-auto overscroll-contain">
                {!filter && (
                  <BranchOption label="Default branch" detail={defaultBranch ?? undefined} selected={branch === ""} onSelect={() => setBranch("")} />
                )}
                {shown.map((each) => (
                  <BranchOption key={each} label={each} selected={branch === each} onSelect={() => setBranch(each)} mono />
                ))}
                {branches.length === 0 && <p className="px-3 py-2.5 text-xs text-zinc-500">Couldn't list branches; the default is used.</p>}
              </div>
            </div>
          )
        ) : (
          <input
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="Default branch"
            aria-label="Branch"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-base text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none md:text-sm"
          />
        )}

        <p className="mt-6 mb-2 text-sm font-medium text-zinc-200">Folder</p>
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900 focus-within:border-zinc-600">
          <span className="pl-3 font-mono text-sm text-zinc-500">~/work/</span>
          <input
            value={dir}
            onChange={(event) => setDir(event.target.value)}
            placeholder={repoDirName(fullName ? `https://github.com/${fullName}` : url)}
            aria-label="Folder"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-2 pr-3 font-mono text-base text-zinc-100 placeholder:text-zinc-600 focus:outline-none md:text-sm"
          />
        </div>
        <p className="mt-1.5 text-xs text-zinc-500">Where it's cloned on each chat's VM.</p>
      </div>
      <div className="shrink-0 border-t border-zinc-900 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => onSave({ url: fullName ?? url, branch, dir: dir.trim() })}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          <Check className="size-4" /> {editing ? "Save" : "Add repository"}
        </button>
      </div>
    </>
  )
}

function BranchOption({ label, detail, selected, onSelect, mono }: { label: string; detail?: string; selected: boolean; onSelect: () => void; mono?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="flex w-full items-center gap-3 border-b border-zinc-800/70 px-3 py-2.5 text-left last:border-b-0 hover:bg-zinc-900"
    >
      <span className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${selected ? "border-emerald-500 bg-emerald-500" : "border-zinc-600"}`}>
        {selected && <span className="size-1.5 rounded-full bg-white" />}
      </span>
      <span className={`min-w-0 flex-1 truncate text-sm text-zinc-100 ${mono ? "font-mono" : ""}`}>{label}</span>
      {detail && <span className="shrink-0 truncate font-mono text-xs text-zinc-500">{detail}</span>}
    </button>
  )
}

/**
 * Adding or editing a project repo: search your GitHub repos (or any public one, or a git URL), then pick the
 * branch and folder.
 */
export function RepoSheet({
  editing,
  existing,
  onSave,
  onClose
}: {
  /** The repo being edited, or null to add one. */
  editing: ProjectRepo | null
  /** Repos already in the project (`owner/name`, lowercase), shown as added. */
  existing: ReadonlySet<string>
  onSave: (repo: ProjectRepo) => void
  onClose: () => void
}) {
  const [picked, setPicked] = useState<{ repo: GitHubRepo | null; url: string } | null>(editing ? { repo: null, url: editing.url } : null)
  return (
    <Sheet onClose={onClose}>
      {picked ? (
        <ConfigureRepo
          repo={picked.repo}
          url={picked.url}
          initial={editing}
          editing={Boolean(editing)}
          onBack={editing ? undefined : () => setPicked(null)}
          onClose={onClose}
          onSave={onSave}
        />
      ) : (
        <PickRepo existing={existing} onPick={(repo) => setPicked({ repo, url: repo.fullName })} onUrl={(url) => setPicked({ repo: null, url })} onClose={onClose} />
      )}
    </Sheet>
  )
}
