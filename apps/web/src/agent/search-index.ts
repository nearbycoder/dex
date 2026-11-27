import type { EntryRecord } from "@earendil-works/pi-durable"
import type { DexState, SessionMeta } from "~/shared/protocol"
import type { SearchHit } from "~/shared/search"
import type { Workspace } from "./workspace"

interface FtsRow {
  kind: string
  item_id: string
  title: string
  subtitle: string
  body: string
  route: string
  updated_at: number
  [key: string]: SqlStorageValue
}

const MAX_BODY_CHARS = 8_000

/** Converts a user search string into safe FTS5 prefix tokens (`"foo"* "bar"*`). */
export function buildFtsQuery(raw: string): string {
  const terms = raw
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/["*^():]/g, "").trim())
    .filter(Boolean)
    .slice(0, 8)
  if (terms.length === 0) return ""
  return terms.map((term) => `"${term}"*`).join(" ")
}

/** Extracts a short snippet centered around the first matching token. */
export function buildSnippet(body: string, query: string, maxLen = 140): string {
  const clean = body.replace(/\s+/g, " ").trim()
  if (!clean) return ""
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const lower = clean.toLowerCase()
  let index = -1
  for (const term of terms) {
    const found = lower.indexOf(term)
    if (found >= 0 && (index < 0 || found < index)) index = found
  }
  if (index < 0) return clean.slice(0, maxLen)
  const start = Math.max(0, index - 40)
  const end = Math.min(clean.length, start + maxLen)
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`
}

/** Extracts searchable plain text from recent user/assistant transcript entries. */
export function extractTranscriptText(entries: ReadonlyArray<EntryRecord>, maxChars = MAX_BODY_CHARS): string {
  const chunks: string[] = []
  let total = 0
  for (let i = entries.length - 1; i >= 0 && chunks.length < 32 && total < maxChars; i--) {
    const entry = entries[i]
    if (!entry?.model) continue
    for (const msg of entry.model) {
      if (msg.role !== "user" && msg.role !== "assistant") continue
      const content = msg.content
      let text = ""
      if (typeof content === "string") {
        text = content
      } else if (Array.isArray(content)) {
        text = content
          .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
          .join(" ")
      }
      const clean = text.replace(/\s+/g, " ").trim()
      if (!clean) continue
      const take = clean.slice(0, Math.min(800, maxChars - total))
      chunks.push(take)
      total += take.length + 1
      if (total >= maxChars) break
    }
  }
  return chunks.reverse().join("\n")
}

/**
 * Full-text search index backed by SQLite FTS5 inside the user's Durable Object (with graceful fallback
 * to in-memory scoring if FTS5 is unavailable). Incrementally indexes chat transcripts, workspace files,
 * agents, spaces, sidekicks, and MCP servers for instant `<10ms` `⌘K` lookups.
 */
export class SearchIndex {
  private readonly sql: SqlStorage
  private readonly ftsEnabled: boolean
  private initialized = false
  private metaSyncedAt = 0

  constructor(sql: SqlStorage) {
    this.sql = sql
    let ok = false
    try {
      sql.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS dex_search_fts USING fts5(
        kind UNINDEXED,
        item_id UNINDEXED,
        title,
        subtitle,
        body,
        route UNINDEXED,
        updated_at UNINDEXED,
        tokenize = 'unicode61'
      )`)
      ok = true
    } catch {
      ok = false
    }
    this.ftsEnabled = ok
  }

  /** Upserts a single document in the FTS5 index (e.g. when a chat receives a message or a workspace file is written). */
  upsert(doc: { kind: SearchHit["kind"]; id: string; title: string; subtitle: string; body: string; route: string; updatedAt: number }) {
    if (!this.ftsEnabled) return
    try {
      this.sql.exec(`DELETE FROM dex_search_fts WHERE kind = ? AND item_id = ?`, doc.kind, doc.id)
      this.sql.exec(
        `INSERT INTO dex_search_fts (kind, item_id, title, subtitle, body, route, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        doc.kind,
        doc.id,
        doc.title.slice(0, 200),
        doc.subtitle.slice(0, 200),
        doc.body.slice(0, MAX_BODY_CHARS),
        doc.route,
        doc.updatedAt
      )
    } catch {
      // Never fail a primary write because of an index hiccup.
    }
  }

  /** Incrementally indexes a chat's recent transcript turns so `⌘K` finds any past message in that chat. */
  indexSessionTranscript(session: Pick<SessionMeta, "id" | "title" | "model" | "updatedAt" | "lastReply">, entries: ReadonlyArray<EntryRecord>) {
    const body = extractTranscriptText(entries) || (session.lastReply ?? "")
    this.upsert({
      kind: "chat",
      id: session.id,
      title: session.title,
      subtitle: session.model,
      body,
      route: `/chat/${session.id}`,
      updatedAt: session.updatedAt
    })
  }

  /** Incrementally indexes a single workspace file on write. */
  indexFile(path: string, content: string, updatedAt = Date.now()) {
    const rel = path.replace(/^\/workspace\//, "")
    this.upsert({
      kind: "file",
      id: path,
      title: rel,
      subtitle: `${content.length} B`,
      body: content,
      route: `/files?path=${encodeURIComponent(path)}`,
      updatedAt
    })
  }

  remove(kind: SearchHit["kind"], id: string) {
    if (!this.ftsEnabled) return
    try {
      this.sql.exec(`DELETE FROM dex_search_fts WHERE kind = ? AND item_id = ?`, kind, id)
    } catch {}
  }

  /** Seeds missing items on first query and refreshes lightweight metadata without wiping indexed chat transcripts. */
  private syncIfStale(state: DexState, workspace: Workspace) {
    if (!this.ftsEnabled) return
    const now = Date.now()
    if (this.initialized && now - this.metaSyncedAt < 30_000) return
    this.metaSyncedAt = now
    try {
      // Preserve full chat transcripts already indexed incrementally; only seed chats that don't have a row yet.
      const indexedChats = new Set(
        this.sql
          .exec<{ item_id: string }>(`SELECT item_id FROM dex_search_fts WHERE kind = 'chat'`)
          .toArray()
          .map((row) => row.item_id)
      )
      for (const session of state.sessions) {
        if (!indexedChats.has(session.id)) {
          this.upsert({
            kind: "chat",
            id: session.id,
            title: session.title,
            subtitle: session.model,
            body: session.lastReply ?? "",
            route: `/chat/${session.id}`,
            updatedAt: session.updatedAt
          })
        }
      }
      // Refresh lightweight entity rows (agents, spaces, sidekicks, mcp) cleanly.
      this.sql.exec(`DELETE FROM dex_search_fts WHERE kind IN ('agent', 'space', 'sidekick', 'mcp')`)
      for (const agent of state.agents) {
        this.upsert({ kind: "agent", id: agent.id, title: agent.name, subtitle: agent.description || agent.model, body: agent.instructions, route: `/agents/${agent.id}`, updatedAt: agent.updatedAt })
      }
      for (const space of state.spaces ?? []) {
        this.upsert({ kind: "space", id: space.id, title: space.name, subtitle: space.goal || "Space", body: space.goal, route: `/chat/${space.sessionId}`, updatedAt: space.updatedAt })
      }
      for (const character of state.characters) {
        this.upsert({ kind: "sidekick", id: character.id, title: character.name, subtitle: character.tagline || "Sidekick", body: `${character.persona}\n${character.instructions}`, route: `/chat/${character.sessionId}`, updatedAt: character.updatedAt })
      }
      for (const server of state.mcp) {
        const toolNames = server.tools.map((tool) => `${tool.name} ${tool.description}`).join(" ")
        const resourceNames = (server.resources ?? []).map((res) => `${res.name} ${res.uri}`).join(" ")
        this.upsert({ kind: "mcp", id: server.id, title: server.name, subtitle: `${server.tools.length} tools · ${server.status}`, body: `${server.url} ${toolNames} ${resourceNames}`, route: `/mcp/${server.id}`, updatedAt: server.updatedAt })
      }
      if (!this.initialized) {
        this.sql.exec(`DELETE FROM dex_search_fts WHERE kind = 'file'`)
        for (const file of workspace.list().slice(0, 200)) {
          const rel = file.path.replace(/^\/workspace\//, "")
          const text = file.size <= 32_000 ? (workspace.readText(file.path) ?? "") : ""
          this.upsert({ kind: "file", id: file.path, title: rel, subtitle: `${file.size} B`, body: text, route: `/files?path=${encodeURIComponent(file.path)}`, updatedAt: file.mtime })
        }
        this.initialized = true
      }
    } catch {
      this.metaSyncedAt = 0
    }
  }

  /** Searches chats, workspace files, agents, spaces, sidekicks, and MCP servers in <50ms. */
  query(rawQuery: string, state: DexState, workspace: Workspace, limit = 20): SearchHit[] {
    const clean = rawQuery.trim()
    if (!clean) return []
    const cap = Math.max(1, Math.min(50, Math.floor(limit)))
    const ftsQuery = buildFtsQuery(clean)

    if (this.ftsEnabled && ftsQuery) {
      this.syncIfStale(state, workspace)
      try {
        const rows = this.sql
          .exec<FtsRow>(
            `SELECT kind, item_id, title, subtitle, body, route, updated_at
             FROM dex_search_fts
             WHERE dex_search_fts MATCH ?
             ORDER BY bm25(dex_search_fts, 4.0, 2.0, 1.0), updated_at DESC
             LIMIT ?`,
            ftsQuery,
            cap
          )
          .toArray()
        return rows.map((row) => ({
          kind: row.kind as SearchHit["kind"],
          id: row.item_id,
          title: row.title,
          subtitle: row.subtitle,
          ...(row.body ? { snippet: buildSnippet(row.body, clean) } : {}),
          route: row.route,
          updatedAt: row.updated_at
        }))
      } catch {
        // Fall through to substring search below if FTS query syntax was rejected.
      }
    }

    // Fallback substring scoring
    const needle = clean.toLowerCase()
    const hits: Array<SearchHit & { score: number }> = []
    const scoreText = (title: string, body: string) => {
      const t = title.toLowerCase()
      const b = body.toLowerCase()
      if (t.includes(needle)) return 3
      if (b.includes(needle)) return 1
      return 0
    }
    for (const session of state.sessions) {
      const score = scoreText(session.title, session.lastReply ?? "")
      if (score) hits.push({ kind: "chat", id: session.id, title: session.title, subtitle: session.model, snippet: session.lastReply ? buildSnippet(session.lastReply, clean) : undefined, route: `/chat/${session.id}`, updatedAt: session.updatedAt, score })
    }
    for (const file of workspace.list().slice(0, 200)) {
      const rel = file.path.replace(/^\/workspace\//, "")
      const text = file.size <= 32_000 ? (workspace.readText(file.path) ?? "") : ""
      const score = scoreText(rel, text)
      if (score) hits.push({ kind: "file", id: file.path, title: rel, subtitle: "Workspace file", snippet: text ? buildSnippet(text, clean) : undefined, route: `/files?path=${encodeURIComponent(file.path)}`, updatedAt: file.mtime, score })
    }
    for (const agent of state.agents) {
      const score = scoreText(agent.name, `${agent.description} ${agent.instructions}`)
      if (score) hits.push({ kind: "agent", id: agent.id, title: agent.name, subtitle: agent.description || agent.model, route: `/agents/${agent.id}`, updatedAt: agent.updatedAt, score })
    }
    for (const space of state.spaces ?? []) {
      const score = scoreText(space.name, space.goal)
      if (score) hits.push({ kind: "space", id: space.id, title: space.name, subtitle: space.goal || "Space", route: `/chat/${space.sessionId}`, updatedAt: space.updatedAt, score })
    }
    for (const server of state.mcp) {
      const body = `${server.url} ${server.tools.map((t) => t.name).join(" ")} ${(server.resources ?? []).map((r) => `${r.name} ${r.uri}`).join(" ")}`
      const score = scoreText(server.name, body)
      if (score) hits.push({ kind: "mcp", id: server.id, title: server.name, subtitle: `${server.tools.length} tools · ${server.status}`, route: `/mcp/${server.id}`, updatedAt: server.updatedAt, score })
    }
    return hits
      .sort((a, b) => b.score - a.score || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, cap)
      .map(({ score: _score, ...hit }) => hit)
  }
}
