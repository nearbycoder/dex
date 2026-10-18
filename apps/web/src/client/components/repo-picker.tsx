import { Link } from "@tanstack/react-router"
import { ExternalLink, GitFork, Globe, LoaderCircle, Lock } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import { type GitHubAccess, type GitHubRepo, repoLabel } from "~/shared/projects"

const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/

/**
 * The repo field: type to search the repos your GitHub connection can reach (private and org ones included) and
 * public ones, or type any owner/repo or https git URL yourself.
 */
export function RepoPicker({ value, onChange, className }: { value: string; onChange: (value: string) => void; className: string }) {
  const { stub, connected } = useDex()
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const listId = useId()
  // Search what's typed; once a repo is picked (a full GitHub URL), browsing starts from the recent list again.
  const query = value.includes("://") ? "" : value.trim()

  useEffect(() => {
    if (!open || !connected) return
    let current = true
    setLoading(true)
    const timer = setTimeout(() => {
      stub
        .searchGitHubRepos(query)
        .then((repos) => {
          if (!current) return
          setResults(repos)
          setError(null)
          setActive(0)
        })
        .catch((cause: unknown) => current && setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => current && setLoading(false))
    }, 250)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [open, query, stub, connected])

  const pick = (repo: GitHubRepo) => {
    onChange(repo.fullName)
    setOpen(false)
  }

  return (
    <div className="relative w-full min-w-0 sm:flex-[3]">
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (!open || !results.length) return
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            setActive((index) => (index + (event.key === "ArrowDown" ? 1 : results.length - 1)) % results.length)
          } else if (event.key === "Enter") {
            event.preventDefault()
            pick(results[active]!)
          } else if (event.key === "Escape") setOpen(false)
        }}
        placeholder="Search repos or owner/repo"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={`${className} w-full font-mono`}
      />
      {open && (loading || results.length > 0 || error) && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 animate-pop overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900 shadow-xl shadow-black/50">
          <ul id={listId} role="listbox" className="scrollbar-thin max-h-72 overflow-y-auto p-1">
            {results.map((repo, index) => (
              <li key={repo.fullName}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(repo)}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${index === active ? "bg-zinc-800" : ""}`}
                >
                  <img src={repo.ownerAvatar} alt="" className="mt-0.5 size-5 shrink-0 rounded" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-sm text-zinc-100">{repo.fullName}</span>
                      {repo.private ? (
                        <Lock className="size-3 shrink-0 text-amber-400" aria-label="Private" />
                      ) : (
                        !repo.accessible && <Globe className="size-3 shrink-0 text-zinc-500" aria-label="Public, from GitHub search" />
                      )}
                      {repo.fork && <GitFork className="size-3 shrink-0 text-zinc-500" aria-label="Fork" />}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">
                      {[repo.archived && "Archived", repo.description, repo.pushedAt && `pushed ${timeAgo(Date.parse(repo.pushedAt))}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {loading && !results.length && (
            <p className="flex items-center gap-2 px-3.5 py-3 text-xs text-zinc-500">
              <LoaderCircle className="size-3.5 animate-spin" /> Looking through your repos…
            </p>
          )}
          {error && <p className="px-3.5 py-2.5 text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  )
}

/** The branch field, suggesting the picked GitHub repo's branches (default first). */
export function BranchPicker({ repo, value, onChange, className }: { repo: string; value: string; onChange: (value: string) => void; className: string }) {
  const { stub, connected } = useDex()
  const [branches, setBranches] = useState<string[]>([])
  const listId = useId()
  const fullName = repoLabel(repo)
  useEffect(() => {
    if (!connected || !GITHUB_SHORTHAND.test(fullName)) return setBranches([])
    let current = true
    const timer = setTimeout(() => {
      stub
        .listGitHubBranches(fullName)
        .then((names) => current && setBranches(names))
        .catch(() => current && setBranches([]))
    }, 400)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [fullName, stub, connected])
  return (
    <>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={branches[0] ?? "branch"}
        list={branches.length ? listId : undefined}
        autoCapitalize="off"
        spellCheck={false}
        className={`${className} min-w-0 flex-1 font-mono`}
      />
      {branches.length > 0 && (
        <datalist id={listId}>
          {branches.map((branch) => (
            <option key={branch} value={branch} />
          ))}
        </datalist>
      )}
    </>
  )
}

/** Under the repo list: whose repos the search covers, which orgs Dex can see, and where to grant it more. */
export function GitHubAccessNote() {
  const { stub, state, connected } = useDex()
  const [access, setAccess] = useState<GitHubAccess | null>(null)
  const login = state?.github.login
  const asked = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!connected || asked.current === login) return
    asked.current = login
    stub
      .githubRepoAccess()
      .then(setAccess)
      .catch(() => setAccess(null))
  }, [stub, connected, login])

  if (!state?.github.connected) {
    return (
      <p className="text-xs text-amber-300/90">
        Public repos only until you{" "}
        <Link to="/settings" className="underline">
          connect GitHub
        </Link>
        .
      </p>
    )
  }
  if (state.github.expired) {
    return (
      <p className="text-xs leading-relaxed text-amber-300/90">
        GitHub stopped accepting your connection, so only public repos show.{" "}
        {state.github.via === "oauth" ? (
          <a href="/auth/github/connect" className="font-medium underline">
            Reconnect GitHub
          </a>
        ) : (
          <Link to="/settings" className="font-medium underline">
            Replace the token in Settings
          </Link>
        )}
      </p>
    )
  }
  if (!access?.connected) return null
  return (
    <p className="text-xs leading-relaxed text-zinc-500">
      Searching repos @{access.login} can reach{access.orgs.length ? `, including ${access.orgs.length === 1 ? "1 org" : `${access.orgs.length} orgs`}` : ""}.{" "}
      {access.manageUrl && (
        <a href={access.manageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-zinc-400 hover:text-zinc-100 hover:underline">
          {access.via === "oauth" ? "Missing an org? Grant Dex access" : "Missing a repo? Edit the token's access"} <ExternalLink className="size-3" />
        </a>
      )}
    </p>
  )
}
