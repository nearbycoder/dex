import type { GitHubAccess, GitHubRepo } from "~/shared/projects"

const API = "https://api.github.com"
const TIMEOUT_MS = 10_000
const PAGES = 5
const CACHE_MS = 5 * 60_000

/** GitHub turned the connected account's token down (revoked, expired, or the app's access removed). */
class GitHubRejected extends Error {}

export interface GitHubAuth {
  readonly token: string
  readonly login: string
  /** How it was connected: OAuth (Connect with GitHub) or a pasted token. */
  readonly via: "oauth" | "token"
}

interface RawRepo {
  full_name: string
  private: boolean
  description: string | null
  default_branch: string
  pushed_at: string | null
  fork: boolean
  archived: boolean
  owner: { login: string; avatar_url: string }
  language?: string | null
  stargazers_count?: number
}

const toRepo = (raw: RawRepo, accessible: boolean): GitHubRepo => ({
  fullName: raw.full_name,
  private: raw.private,
  description: raw.description ?? "",
  defaultBranch: raw.default_branch,
  pushedAt: raw.pushed_at,
  fork: raw.fork,
  archived: raw.archived,
  owner: raw.owner.login,
  ownerAvatar: raw.owner.avatar_url,
  accessible,
  language: raw.language ?? null,
  stars: raw.stargazers_count ?? 0
})

/**
 * Repos for the project editor, through the user's GitHub connection: every repo it can reach (theirs, ones they
 * collaborate on, and their orgs', private included where the org allowed Dex), plus GitHub search for public repos
 * anywhere. Without a connection, search only (public repos, GitHub's anonymous rate limit).
 */
export class GitHubRepos {
  private cache: { login: string; at: number; repos: GitHubRepo[] } | null = null

  constructor(
    private readonly auth: () => Promise<GitHubAuth | null>,
    private readonly clientId: () => Promise<string | null>,
    /** Called when GitHub rejects the token, so the app can show the connection as needing a reconnect. */
    private readonly rejected: () => void
  ) {}

  private async get<T>(path: string, token: string | null): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "Dex (repos)", "x-github-api-version": "2022-11-28", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (response.status === 401) {
      if (token) {
        this.rejected()
        throw new GitHubRejected("GitHub didn't accept the connected account: reconnect it in Settings.")
      }
      throw new Error("GitHub turned the request down.")
    }
    if (response.status === 403 || response.status === 429) throw new Error(`GitHub is rate limiting${token ? "" : " anonymous searches; connect GitHub in Settings for more"}. Try again in a minute.`)
    if (!response.ok) throw new Error(`GitHub returned ${response.status}.`)
    return (await response.json()) as T
  }

  /** Every repo the connection can reach, most recently pushed first (cached for a few minutes). */
  private async accessible(auth: GitHubAuth): Promise<GitHubRepo[]> {
    if (this.cache?.login === auth.login && Date.now() - this.cache.at < CACHE_MS) return this.cache.repos
    const repos: GitHubRepo[] = []
    for (let page = 1; page <= PAGES; page++) {
      const batch = await this.get<RawRepo[]>(`/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`, auth.token)
      repos.push(...batch.map((raw) => toRepo(raw, true)))
      if (batch.length < 100) break
    }
    this.cache = { login: auth.login, at: Date.now(), repos }
    return repos
  }

  forget() {
    this.cache = null
  }

  /**
   * Repos matching `query` (all words, in the name or description): the user's first, then public ones. With
   * `owner`, only that account's or org's repos.
   */
  async search(query: string, owner?: string): Promise<GitHubRepo[]> {
    const q = query.trim().toLowerCase().slice(0, 100)
    const only = owner && /^[\w.-]{1,100}$/.test(owner) ? owner.toLowerCase() : null
    let auth = await this.auth()
    // A rejected connection still finds public repos (anonymously) while it waits for a reconnect.
    const mine = auth
      ? await this.accessible(auth).catch((error: unknown) => {
          if (!(error instanceof GitHubRejected)) throw error
          auth = null
          return [] as GitHubRepo[]
        })
      : []
    const owned = only ? mine.filter((repo) => repo.owner.toLowerCase() === only) : mine
    if (!q) {
      if (owned.length || !only) return owned.filter((repo) => !repo.archived).slice(0, 40)
      // An owner the connection can't list (someone else's): their public repos.
      const theirs = await this.get<RawRepo[]>(`/users/${only}/repos?per_page=40&sort=pushed`, auth?.token ?? null).catch(() => [] as RawRepo[])
      return theirs.map((raw) => toRepo(raw, false))
    }
    const words = q.split(/\s+/)
    const name = (repo: GitHubRepo) => repo.fullName.toLowerCase()
    const matches = owned
      .filter((repo) => words.every((word) => name(repo).includes(word) || repo.description.toLowerCase().includes(word)))
      .sort((a, b) => {
        const score = (repo: GitHubRepo) => {
          const short = name(repo).split("/")[1] ?? ""
          return name(repo) === q || short === q ? 0 : short.startsWith(q) ? 1 : name(repo).includes(q) ? 2 : 3
        }
        return score(a) - score(b) || Number(a.archived) - Number(b.archived) || Date.parse(b.pushedAt ?? "0") - Date.parse(a.pushedAt ?? "0")
      })
      .slice(0, 30)
    // Public repos anywhere (and, with a connection, private ones it can see) by name.
    if (q.length >= 2 && matches.length < 30) {
      const scope = only ? ` user:${only}` : ""
      const found = await this.get<{ items?: RawRepo[] }>(`/search/repositories?q=${encodeURIComponent(`${q} in:name${scope}`)}&per_page=15`, auth?.token ?? null).catch(() => ({ items: [] }))
      for (const raw of found.items ?? []) {
        if (!matches.some((repo) => repo.fullName === raw.full_name)) matches.push(toRepo(raw, mine.some((repo) => repo.fullName === raw.full_name)))
      }
    }
    return matches.slice(0, 40)
  }

  /** A repo's branches, its default first. */
  async branches(fullName: string): Promise<string[]> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return []
    const auth = await this.auth()
    const load = (token: string | null) =>
      Promise.all([this.get<RawRepo>(`/repos/${fullName}`, token), this.get<Array<{ name: string }>>(`/repos/${fullName}/branches?per_page=100`, token)])
    // A rejected connection: public repos still list their branches.
    const [repo, branches] = await load(auth?.token ?? null).catch((error: unknown) => {
      if (error instanceof GitHubRejected) return load(null)
      throw error
    })
    const names = branches.map((branch) => branch.name)
    return [repo.default_branch, ...names.filter((name) => name !== repo.default_branch)]
  }

  /** Who's connected, which orgs Dex can see, and where to grant it more. */
  async access(): Promise<GitHubAccess> {
    const auth = await this.auth()
    if (!auth) return { connected: false, login: null, via: null, orgs: [], manageUrl: null }
    const orgs = await this.get<Array<{ login: string; avatar_url: string }>>("/user/orgs?per_page=100", auth.token).catch(() => [])
    const clientId = auth.via === "oauth" ? await this.clientId() : null
    return {
      connected: true,
      login: auth.login,
      via: auth.via,
      orgs: orgs.map((org) => ({ login: org.login, avatarUrl: org.avatar_url })),
      // OAuth: GitHub's page for Dex's app, where you grant (or request) access to each org. A token: its settings.
      manageUrl: clientId ? `https://github.com/settings/connections/applications/${clientId}` : "https://github.com/settings/personal-access-tokens"
    }
  }
}
