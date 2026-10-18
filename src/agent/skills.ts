import {
  type DirectorySkill,
  parseSkillMarkdown,
  SKILL_NAME,
  type SkillDetail,
  type SkillFile,
  type SkillInfo,
  type SkillPreview,
  skillSlug
} from "~/shared/skills"

const SEARCH_URL = "https://skills.sh/api/search"
const MAX_FILES = 60
const MAX_FILE_BYTES = 256 * 1024
const MAX_SKILL_BYTES = 1024 * 1024
/** How much of a skill's instructions goes into a chat's prompt, and of all skills a chat invoked together. */
export const MAX_INSTRUCTIONS_CHARS = 24_000
const MAX_ACTIVE_CHARS = 60_000
const BINARY = /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|pdf|zip|gz|tgz|tar|7z|rar|woff2?|ttf|otf|eot|mp[34]|mov|webm|wav|ogg|exe|dll|so|dylib|bin|jar|class|pyc|wasm|sqlite|db)$/i

interface SkillRow {
  id: string
  data: string
  created_at: number
  updated_at: number
  [key: string]: SqlStorageValue
}

interface StoredSkill {
  readonly description: string
  readonly instructions: string
  readonly source: string | null
  readonly path: string | null
  readonly auto: boolean
  readonly files: ReadonlyArray<SkillFile>
}

interface Fetched extends SkillPreview {
  readonly fileContents: ReadonlyArray<SkillFile>
}

export interface SkillHost {
  readonly sql: SqlStorage
  readonly publish: (skills: SkillInfo[]) => void
  /** The user's GitHub token, if connected: private repos, and GitHub's higher API limit. */
  readonly githubToken: () => Promise<string | null>
}

const bytes = (value: string) => new TextEncoder().encode(value).length
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/")

/** Installed skills, which chats invoked which, and installing from skills.sh (GitHub underneath). */
export class SkillCenter {
  private readonly searches = new Map<string, { at: number; results: DirectorySkill[] }>()

  constructor(private readonly host: SkillHost) {
    host.sql.exec(`CREATE TABLE IF NOT EXISTS dex_skills (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    host.sql.exec(`CREATE TABLE IF NOT EXISTS dex_session_skills (session_id TEXT NOT NULL, skill_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (session_id, skill_id))`)
  }

  private rows() {
    return this.host.sql.exec<SkillRow>(`SELECT * FROM dex_skills ORDER BY id`).toArray()
  }

  private stored(id: string): (StoredSkill & { createdAt: number; updatedAt: number }) | null {
    const row = this.host.sql.exec<SkillRow>(`SELECT * FROM dex_skills WHERE id = ?`, id).toArray()[0]
    return row ? { ...(JSON.parse(row.data) as StoredSkill), createdAt: row.created_at, updatedAt: row.updated_at } : null
  }

  private info(id: string, skill: StoredSkill, createdAt: number, updatedAt: number): SkillInfo {
    return {
      id,
      description: skill.description,
      source: skill.source,
      path: skill.path,
      auto: skill.auto,
      files: skill.files.length,
      size: bytes(skill.instructions) + skill.files.reduce((total, file) => total + bytes(file.content), 0),
      installedAt: createdAt,
      updatedAt
    }
  }

  list(): SkillInfo[] {
    return this.rows().map((row) => this.info(row.id, JSON.parse(row.data) as StoredSkill, row.created_at, row.updated_at))
  }

  refresh() {
    this.host.publish(this.list())
  }

  get(id: string): SkillDetail | null {
    const skill = this.stored(id)
    if (!skill) return null
    return {
      ...this.info(id, skill, skill.createdAt, skill.updatedAt),
      instructions: skill.instructions,
      fileList: skill.files.map((file) => ({ path: file.path, size: bytes(file.content) }))
    }
  }

  private write(id: string, skill: StoredSkill, createdAt?: number) {
    const now = Date.now()
    this.host.sql.exec(
      `INSERT INTO dex_skills (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      id, JSON.stringify(skill), createdAt ?? now, now
    )
    this.refresh()
    return this.get(id)!
  }

  /** Creates or edits a skill written in Dex. Installed skills keep their files; editing makes their text yours. */
  save(input: { id?: string; name: string; description: string; instructions: string; auto?: boolean }): SkillDetail {
    const name = skillSlug(input.name)
    if (!SKILL_NAME.test(name)) throw new Error("A skill needs a name: lowercase letters, digits, and dashes.")
    const description = input.description.trim().slice(0, 1_000)
    if (!description) throw new Error("Describe when to use the skill: chats decide from the description.")
    const instructions = input.instructions.trim()
    if (!instructions) throw new Error("Write the skill's instructions.")
    if (bytes(instructions) > MAX_FILE_BYTES) throw new Error("The instructions are too long (256 KB at most).")
    const previous = input.id ? this.stored(input.id) : null
    if (input.id && !previous) throw new Error(`No skill ${input.id}.`)
    if (name !== input.id && this.stored(name)) throw new Error(`There's already a skill named ${name}.`)
    const skill: StoredSkill = {
      description,
      instructions,
      source: previous?.source ?? null,
      path: previous?.path ?? null,
      auto: input.auto ?? previous?.auto ?? true,
      files: previous?.files ?? []
    }
    if (previous && input.id && name !== input.id) {
      this.host.sql.exec(`DELETE FROM dex_skills WHERE id = ?`, input.id)
      this.host.sql.exec(`UPDATE dex_session_skills SET skill_id = ? WHERE skill_id = ?`, name, input.id)
    }
    return this.write(name, skill, previous?.createdAt)
  }

  setAuto(id: string, auto: boolean) {
    const skill = this.stored(id)
    if (!skill) throw new Error(`No skill ${id}.`)
    this.write(id, { ...skill, auto }, skill.createdAt)
  }

  remove(id: string) {
    const existed = this.host.sql.exec(`DELETE FROM dex_skills WHERE id = ?`, id).rowsWritten > 0
    this.host.sql.exec(`DELETE FROM dex_session_skills WHERE skill_id = ?`, id)
    this.refresh()
    return existed
  }

  forgetSession(sessionId: string) {
    this.host.sql.exec(`DELETE FROM dex_session_skills WHERE session_id = ?`, sessionId)
  }

  // ── In chats ──────────────────────────────────────────────────────────────

  /** Marks a skill as in use by a chat (you typed `/<name>`): its instructions join that chat's prompt. */
  activate(sessionId: string, id: string) {
    if (!this.stored(id)) return false
    this.host.sql.exec(`INSERT OR IGNORE INTO dex_session_skills (session_id, skill_id, at) VALUES (?, ?, ?)`, sessionId, id, Date.now())
    return true
  }

  /** The prompt section listing skills chats may load on their own. */
  autoSection(): string | undefined {
    const skills = this.list().filter((skill) => skill.auto)
    if (!skills.length) return undefined
    return [
      "Skills are instructions for particular kinds of tasks. When a request matches one of these, call use_skill with its name before you start, then follow what it says:",
      ...skills.slice(0, 80).map((skill) => `- ${skill.id}: ${skill.description.replace(/\s+/g, " ").slice(0, 300)}`)
    ].join("\n")
  }

  /** The prompt section with the full instructions of the skills this chat invoked, newest last. */
  activeSection(sessionId: string): string | undefined {
    const ids = this.host.sql
      .exec<{ skill_id: string }>(`SELECT skill_id FROM dex_session_skills WHERE session_id = ? ORDER BY at`, sessionId)
      .toArray()
      .map((row) => row.skill_id)
    let budget = MAX_ACTIVE_CHARS
    const parts: string[] = []
    for (const id of ids.reverse()) {
      const skill = this.stored(id)
      if (!skill || budget <= 0) continue
      const text = this.render(id, skill, Math.min(budget, MAX_INSTRUCTIONS_CHARS))
      budget -= text.length
      parts.unshift(text)
    }
    if (!parts.length) return undefined
    return `The user invoked these skills in this chat (a message starting with /<name>). Follow them for the requests they cover.\n\n${parts.join("\n\n")}`
  }

  private render(id: string, skill: StoredSkill, limit: number) {
    const instructions = skill.instructions.length > limit ? `${skill.instructions.slice(0, limit)}\n… (truncated)` : skill.instructions
    const files = skill.files.length ? `\n\nFiles in this skill (read one with use_skill and its path): ${skill.files.map((file) => file.path).join(", ")}` : ""
    return `<skill name="${id}">\n${instructions}${files}\n</skill>`
  }

  /** What use_skill returns: a skill's instructions, or one of its files. */
  use(id: string, file?: string): string {
    const skill = this.stored(id)
    if (!skill) {
      const names = this.list().map((entry) => entry.id)
      throw new Error(`No skill named ${id}.${names.length ? ` Installed: ${names.join(", ")}.` : ""}`)
    }
    if (file) {
      const wanted = file.replace(/^\.?\/+/, "")
      const found = skill.files.find((entry) => entry.path === wanted)
      if (!found) throw new Error(`${id} has no file ${file}. Its files: ${skill.files.map((entry) => entry.path).join(", ") || "none"}.`)
      return found.content
    }
    return this.render(id, skill, MAX_INSTRUCTIONS_CHARS)
  }

  // ── skills.sh ─────────────────────────────────────────────────────────────

  /** Searches skills.sh (by install count, most first). */
  async search(query: string): Promise<DirectorySkill[]> {
    const q = query.trim().slice(0, 100)
    if (q.length < 2) return []
    const cached = this.searches.get(q.toLowerCase())
    if (cached && Date.now() - cached.at < 60_000) return cached.results
    const response = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(q)}`, {
      headers: { accept: "application/json", "user-agent": "Dex (skills search)" },
      signal: AbortSignal.timeout(8_000)
    })
    if (!response.ok) throw new Error(`skills.sh search failed (${response.status}).`)
    const body = (await response.json()) as { skills?: Array<Record<string, unknown>> }
    const results = (body.skills ?? [])
      .flatMap((entry): DirectorySkill[] => {
        const source = typeof entry.source === "string" ? entry.source : ""
        const skillId = typeof entry.skillId === "string" ? entry.skillId : ""
        if (!/^[\w.-]+\/[\w.-]+$/.test(source) || !skillId) return []
        return [
          {
            id: `${source}/${skillId}`,
            source,
            skillId,
            name: typeof entry.name === "string" ? entry.name : skillId,
            installs: typeof entry.installs === "number" ? entry.installs : 0
          }
        ]
      })
      .slice(0, 25)
    this.searches.set(q.toLowerCase(), { at: Date.now(), results })
    if (this.searches.size > 200) this.searches.delete(this.searches.keys().next().value!)
    return results
  }

  /** Reads a skill from its GitHub repo: finds its SKILL.md and the text files beside it. */
  async fetch(source: string, skillId: string): Promise<Fetched> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(source)) throw new Error(`Not a GitHub repo: ${source}`)
    if (!/^[\w.:@ -]{1,100}$/.test(skillId)) throw new Error(`Not a skill name: ${skillId}`)
    const token = await this.host.githubToken()
    const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "Dex (skills)", ...(token ? { authorization: `Bearer ${token}` } : {}) }
    const treeResponse = await fetch(`https://api.github.com/repos/${source}/git/trees/HEAD?recursive=1`, { headers, signal: AbortSignal.timeout(10_000) })
    if (treeResponse.status === 404) throw new Error(`Couldn't find ${source} on GitHub${token ? "" : " (connect GitHub in Settings for private repos)"}.`)
    if (treeResponse.status === 403 || treeResponse.status === 429) throw new Error(`GitHub is rate limiting Dex right now${token ? "" : "; connecting GitHub in Settings raises the limit"}.`)
    if (!treeResponse.ok) throw new Error(`GitHub returned ${treeResponse.status} for ${source}.`)
    const tree = (await treeResponse.json()) as { tree?: Array<{ path: string; type: string; size?: number }> }
    const blobs = (tree.tree ?? []).filter((entry) => entry.type === "blob")
    const raw = async (path: string) => {
      const response = await fetch(`https://raw.githubusercontent.com/${source}/HEAD/${encodePath(path)}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(10_000)
      })
      if (!response.ok) throw new Error(`Couldn't read ${path} from ${source} (${response.status}).`)
      return response.text()
    }

    const manifests = blobs.filter((entry) => /(^|\/)SKILL\.md$/i.test(entry.path))
    const folder = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "")
    const depth = (path: string) => path.split("/").length
    const wanted = skillId.toLowerCase()
    const slug = skillSlug(skillId)
    // By folder name first (how skills.sh names them), shallowest wins; else by the `name` in each SKILL.md.
    let manifest = manifests
      .filter((entry) => {
        const name = folder(entry.path).split("/").pop()?.toLowerCase() ?? ""
        return name === wanted || name === slug
      })
      .sort((a, b) => depth(a.path) - depth(b.path))[0]
    let markdown: string | undefined
    if (!manifest) {
      for (const candidate of manifests.slice(0, 40)) {
        const text = await raw(candidate.path)
        const name = parseSkillMarkdown(text).fields.name?.toLowerCase()
        if (name === wanted || (name && skillSlug(name) === slug)) {
          manifest = candidate
          markdown = text
          break
        }
      }
    }
    if (!manifest && manifests.length === 1) manifest = manifests[0]
    if (!manifest) throw new Error(`No skill named ${skillId} in ${source}.`)
    markdown ??= await raw(manifest.path)

    const { fields, body } = parseSkillMarkdown(markdown)
    const dir = folder(manifest.path)
    // A skill at the repo root takes only its SKILL.md: the rest of the repo isn't the skill.
    const extras = dir
      ? blobs.filter((entry) => entry.path.startsWith(`${dir}/`) && entry.path !== manifest.path && !BINARY.test(entry.path) && (entry.size ?? 0) <= MAX_FILE_BYTES)
      : []
    if (extras.length > MAX_FILES) throw new Error(`${skillId} has too many files (${extras.length}; ${MAX_FILES} at most).`)
    const total = bytes(markdown) + extras.reduce((sum, entry) => sum + (entry.size ?? 0), 0)
    if (total > MAX_SKILL_BYTES) throw new Error(`${skillId} is too big (${Math.round(total / 1024)} KB; 1 MB at most).`)
    const fileContents: SkillFile[] = []
    for (let index = 0; index < extras.length; index += 8) {
      const batch = extras.slice(index, index + 8)
      const texts = await Promise.all(batch.map((entry) => raw(entry.path)))
      batch.forEach((entry, at) => {
        const content = texts[at]!
        if (!content.includes("\u0000")) fileContents.push({ path: entry.path.slice(dir.length + 1), content })
      })
    }
    const name = skillSlug(fields.name ?? "") || slug
    return {
      name,
      description: (fields.description ?? "").replace(/\s+/g, " ").trim().slice(0, 1_000),
      instructions: body,
      source,
      path: dir,
      url: `https://github.com/${source}/${dir ? `tree/HEAD/${encodePath(dir)}` : ""}`,
      files: fileContents.map((file) => ({ path: file.path, size: bytes(file.content) })),
      size: bytes(markdown) + fileContents.reduce((sum, file) => sum + bytes(file.content), 0),
      fileContents
    }
  }

  async preview(source: string, skillId: string): Promise<SkillPreview> {
    const { fileContents: _files, ...preview } = await this.fetch(source, skillId)
    return preview
  }

  /** Installs (or updates) a skill from GitHub. A different skill already using the name is left alone. */
  async install(source: string, skillId: string, auto = true): Promise<SkillDetail> {
    const fetched = await this.fetch(source, skillId)
    if (!SKILL_NAME.test(fetched.name)) throw new Error(`${skillId} has no usable name.`)
    if (!fetched.instructions) throw new Error(`${skillId}'s SKILL.md has no instructions.`)
    const existing = this.stored(fetched.name)
    if (existing && (existing.source !== source || existing.path !== fetched.path)) {
      throw new Error(`A skill named ${fetched.name} is already installed${existing.source ? ` from ${existing.source}` : ""}. Remove or rename it first.`)
    }
    return this.write(
      fetched.name,
      {
        description: fetched.description || `${fetched.name} (from ${source})`,
        instructions: fetched.instructions,
        source,
        path: fetched.path,
        auto: existing?.auto ?? auto,
        files: fetched.fileContents
      },
      existing?.createdAt
    )
  }

  /** Re-reads an installed skill from its repo. */
  async update(id: string) {
    const skill = this.stored(id)
    if (!skill?.source) throw new Error(`${id} wasn't installed from GitHub.`)
    return this.install(skill.source, skill.path?.split("/").pop() || id)
  }
}
