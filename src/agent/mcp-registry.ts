import { type McpCheck, type McpCheckReport, type RegistryHeader, type RegistryServer, registryPublisher, registryTitle } from "~/shared/mcp-registry"

const REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers"
const PAGES = 2
const RESULTS = 25
const TIMEOUT_MS = 8_000
/** The registry's search can take many seconds for a query it hasn't seen lately (then it's cached). */
const SEARCH_TIMEOUT_MS = 25_000
const YEAR_MS = 365 * 24 * 60 * 60_000

interface RawRemote {
  type?: string
  url?: string
  headers?: Array<{ name?: string; description?: string; isRequired?: boolean; isSecret?: boolean; value?: string }>
}

interface RawEntry {
  server?: { name?: string; description?: string; version?: string; repository?: { url?: string }; remotes?: RawRemote[] }
  _meta?: Record<string, { status?: string; updatedAt?: string; isLatest?: boolean } | undefined>
}

const searches = new Map<string, { at: number; results: RegistryServer[] }>()

const toServer = (entry: RawEntry): RegistryServer | null => {
  const server = entry.server
  const meta = entry._meta?.["io.modelcontextprotocol.registry/official"]
  const remote = server?.remotes?.find((candidate) => (candidate.type === "streamable-http" || candidate.type === "sse") && candidate.url?.startsWith("https://"))
  if (!server?.name || !remote?.url || meta?.isLatest === false || (meta?.status && meta.status !== "active")) return null
  const headers: RegistryHeader[] = (remote.headers ?? []).flatMap((header) =>
    header.name
      ? [{ name: header.name, description: header.description ?? "", required: header.isRequired ?? false, secret: header.isSecret ?? false, value: header.value ?? null }]
      : []
  )
  return {
    name: server.name,
    title: registryTitle(server.name),
    description: (server.description ?? "").replace(/…$/, "").trim(),
    version: server.version ?? "",
    repository: server.repository?.url?.startsWith("https://") ? server.repository.url : null,
    url: remote.url,
    transport: remote.type as RegistryServer["transport"],
    headers,
    templated: /\{[^}]+\}/.test(remote.url),
    updatedAt: meta?.updatedAt ?? null,
    status: meta?.status ?? "active",
    source: "registry",
    uses: null,
    verified: null
  }
}

/** How well a server's name matches: its own name first, then names that start with or contain the words. */
const rank = (server: RegistryServer, query: string) => {
  const last = (server.name.split("/").pop() ?? "").toLowerCase()
  const namespace = server.name.split("/")[0]!.toLowerCase()
  // The company's own server (com.stripe/…) before others named after it; ones needing setup after ready ones.
  const base = namespace.endsWith(`.${query}`) || namespace === query ? 0 : last === query ? 1 : last.startsWith(query) ? 2 : last.includes(query) ? 3 : 4
  return base * 2 + (server.templated ? 1 : 0)
}

/** Remote MCP servers in the official registry whose name matches `query`, best matches first. */
export async function searchRegistry(query: string): Promise<RegistryServer[]> {
  const q = query.trim().toLowerCase().slice(0, 100)
  if (q.length < 2) return []
  const cached = searches.get(q)
  if (cached && Date.now() - cached.at < 60_000) return cached.results
  const found: RegistryServer[] = []
  let cursor: string | undefined
  // The registry lists every package (most run locally); page until there are enough remote ones.
  for (let page = 0; page < PAGES; page++) {
    const url = `${REGISTRY}?search=${encodeURIComponent(q)}&version=latest&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
    const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "Dex (MCP search)" }, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) }).catch(
      (error: unknown) => {
        if (page > 0) return null
        throw new Error(error instanceof Error && error.name === "TimeoutError" ? "The MCP Registry is slow to answer right now. Try again in a moment." : "Couldn't reach the MCP Registry.")
      }
    )
    if (!response) break
    if (!response.ok) throw new Error(`The MCP Registry returned ${response.status}.`)
    const body = (await response.json()) as { servers?: RawEntry[]; metadata?: { nextCursor?: string } }
    for (const entry of body.servers ?? []) {
      const server = toServer(entry)
      if (server && !found.some((existing) => existing.name === server.name)) found.push(server)
    }
    cursor = body.metadata?.nextCursor
    if (!cursor || found.length >= 10) break
  }
  const results = found.sort((a, b) => rank(a, q) - rank(b, q) || a.name.localeCompare(b.name)).slice(0, RESULTS)
  searches.set(q, { at: Date.now(), results })
  if (searches.size > 200) searches.delete(searches.keys().next().value!)
  return results
}

// ── Smithery ─────────────────────────────────────────────────────────────────

const SMITHERY = "https://registry.smithery.ai/servers"

interface SmitheryListing {
  qualifiedName?: string
  displayName?: string
  description?: string
  verified?: boolean
  useCount?: number
  remote?: boolean
  isDeployed?: boolean
  unlisted?: boolean
  inactive?: boolean
  homepage?: string
  createdAt?: string
}

/**
 * Remote servers on Smithery matching `query`: answers in well under a second, with how many people use each and
 * whether Smithery verified it. Its endpoints are Smithery-hosted (sign-in through Smithery), read when checked.
 */
export async function searchSmithery(query: string): Promise<RegistryServer[]> {
  const q = query.trim().slice(0, 100)
  if (q.length < 2) return []
  const key = `smithery:${q.toLowerCase()}`
  const cached = searches.get(key)
  if (cached && Date.now() - cached.at < 60_000) return cached.results
  const response = await fetch(`${SMITHERY}?q=${encodeURIComponent(q)}&pageSize=40`, {
    headers: { accept: "application/json", "user-agent": "Dex (MCP search)" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  }).catch(() => null)
  if (!response?.ok) throw new Error(response ? `Smithery returned ${response.status}.` : "Couldn't reach Smithery.")
  const body = (await response.json()) as { servers?: SmitheryListing[] }
  const lower = q.toLowerCase()
  const results = (body.servers ?? [])
    .filter((entry) => entry.qualifiedName && entry.remote && entry.isDeployed !== false && !entry.inactive && !entry.unlisted)
    .map(
      (entry): RegistryServer => ({
        source: "smithery",
        name: entry.qualifiedName!,
        title: entry.displayName || registryTitle(entry.qualifiedName!),
        description: entry.description ?? "",
        version: "",
        repository: entry.homepage && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(entry.homepage) ? entry.homepage : null,
        url: "",
        transport: "streamable-http",
        headers: [],
        templated: false,
        updatedAt: entry.createdAt ?? null,
        status: "active",
        uses: entry.useCount ?? 0,
        verified: entry.verified ?? false
      })
    )
    // Its own match first (the "linear" server for "linear"), then by how many people use it.
    .sort((a, b) => {
      // A display name alone is easy to copy ("Linear" on an unofficial proxy); it counts only when verified.
      const exact = (server: RegistryServer) => (server.name.toLowerCase() === lower || (server.verified && server.title.toLowerCase() === lower) ? 0 : 1)
      return exact(a) - exact(b) || (b.uses ?? 0) - (a.uses ?? 0)
    })
    .slice(0, RESULTS)
  searches.set(key, { at: Date.now(), results })
  return results
}

/** A Smithery server's endpoint and tools (listed without signing in). */
async function smitheryDetail(name: string): Promise<{ url: string | null; tools: string[] }> {
  const response = await fetch(`${SMITHERY}/${name.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { accept: "application/json", "user-agent": "Dex (MCP checks)" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  }).catch(() => null)
  if (!response?.ok) return { url: null, tools: [] }
  const body = (await response.json()) as { deploymentUrl?: string; connections?: Array<{ type?: string; deploymentUrl?: string }>; tools?: Array<{ name?: string }> }
  const url = body.connections?.find((connection) => connection.type === "http" && connection.deploymentUrl)?.deploymentUrl ?? body.deploymentUrl ?? null
  return { url: url?.startsWith("https://") ? url : null, tools: (body.tools ?? []).flatMap((tool) => (tool.name ? [tool.name] : [])) }
}

// ── Checks ───────────────────────────────────────────────────────────────────

const ACCEPT = "application/json, text/event-stream"

/** A JSON-RPC reply from either a JSON body or the first `data:` event of an SSE body. */
const readRpc = async (response: Response): Promise<{ result?: Record<string, unknown>; error?: { message?: string } } | null> => {
  const text = (await response.text()).slice(0, 200_000)
  const json = (response.headers.get("content-type") ?? "").includes("text/event-stream")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .find((line) => line.startsWith("{"))
    : text
  try {
    return json ? JSON.parse(json) : null
  } catch {
    return null
  }
}

const post = (url: string, body: unknown, session?: string | null) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: ACCEPT, "mcp-protocol-version": "2025-06-18", ...(session ? { "mcp-session-id": session } : {}) },
    body: JSON.stringify(body),
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })

/** Whether the server publishes OAuth metadata (RFC 9728), from its 401 or the well-known paths. */
async function oauthMetadata(url: URL, challenge: string | null): Promise<string | null> {
  const fromChallenge = challenge && /resource_metadata="([^"]+)"/.exec(challenge)?.[1]
  const candidates = [
    fromChallenge,
    `${url.origin}/.well-known/oauth-protected-resource${url.pathname.replace(/\/$/, "")}`,
    `${url.origin}/.well-known/oauth-protected-resource`,
    `${url.origin}/.well-known/oauth-authorization-server`
  ].filter((candidate): candidate is string => Boolean(candidate?.startsWith("https://")))
  for (const candidate of candidates) {
    const response = await fetch(candidate, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null)
    if (!response?.ok) continue
    const body = (await response.json().catch(() => null)) as { authorization_servers?: string[]; issuer?: string } | null
    if (body?.authorization_servers?.length) return new URL(body.authorization_servers[0]!).host
    if (body?.issuer) return new URL(body.issuer).host
  }
  return null
}

/**
 * Runs Dex's checks on a remote MCP server: the registry's own signals (status, publisher, freshness), what the
 * endpoint answers to an MCP handshake (and how it wants you to sign in), its tools when it's open, and the
 * health of its GitHub repo.
 */
export async function checkServer(listed: RegistryServer, githubToken: string | null): Promise<McpCheckReport> {
  const checks: McpCheck[] = []
  const add = (id: string, label: string, status: McpCheck["status"], detail: string) => checks.push({ id, label, status, detail })
  // Smithery lists endpoints and tools only in a server's details.
  let server = listed
  let listedTools: string[] = []
  if (listed.source === "smithery") {
    const detail = await smitheryDetail(listed.name)
    if (detail.url) server = { ...listed, url: detail.url }
    listedTools = detail.tools
  }
  let auth: McpCheckReport["auth"] = server.headers.some((header) => header.required) ? "headers" : "none"
  const header = server.headers.find((candidate) => candidate.required)?.name ?? null
  let tools: string[] = []

  let url: URL
  try {
    url = new URL(server.url)
  } catch {
    if (server.source === "smithery") {
      add("reachable", "Endpoint", "fail", "Smithery lists no endpoint for it right now.")
      return { url: "", checks, auth, header, tools: listedTools.slice(0, 50), checkedAt: Date.now() }
    }
    add("https", "Secure endpoint", "fail", "The URL isn't valid.")
    return { url: server.url, checks, auth, header, tools, checkedAt: Date.now() }
  }
  add("https", "Secure endpoint", url.protocol === "https:" ? "pass" : "fail", url.protocol === "https:" ? `Served over HTTPS from ${url.host}` : "Not HTTPS: credentials could be read in transit.")

  // The publisher: the registry checked they own the namespace (GitHub account or domain) when they published.
  const publisher = registryPublisher(server.name)
  if (server.source === "smithery") {
    add(
      "publisher",
      "Listing",
      server.verified ? "pass" : "warn",
      `${server.verified ? "Verified by Smithery" : "Not verified by Smithery"} · ${(server.uses ?? 0).toLocaleString()} ${server.uses === 1 ? "user" : "users"}`
    )
    if (url.hostname.endsWith(".run.tools")) {
      add("hosting", "Hosting", "info", "Runs on Smithery: you sign in through Smithery, and your requests pass through it.")
    }
  } else if (server.name.startsWith("ai.smithery/")) {
    add("publisher", "Publisher", "warn", "Hosted by Smithery for someone else; it needs a Smithery API key, and Smithery sees your traffic.")
  } else if (publisher.kind === "github") {
    add("publisher", "Publisher", "info", `GitHub account ${publisher.id} (ownership verified by the MCP Registry).`)
  } else if (publisher.kind === "domain") {
    const onDomain = url.hostname === publisher.id || url.hostname.endsWith(`.${publisher.id}`)
    add(
      "publisher",
      "Publisher",
      onDomain ? "pass" : "warn",
      onDomain
        ? `${publisher.id}, and the endpoint is on that domain (ownership verified by the MCP Registry).`
        : `${publisher.id} (verified by the MCP Registry), but the endpoint is on ${url.hostname}.`
    )
  }

  const updated = server.source === "registry" && server.updatedAt ? Date.parse(server.updatedAt) : NaN
  if (!Number.isNaN(updated)) {
    const stale = Date.now() - updated > YEAR_MS
    add("fresh", "Registry entry", stale ? "warn" : "pass", `${server.status === "active" ? "Active" : server.status}, updated ${new Date(updated).toISOString().slice(0, 10)}${stale ? " (over a year ago)" : ""}.`)
  }

  // The handshake: what a client actually gets from the endpoint.
  if (server.templated) {
    add("reachable", "Responds", "info", "Its URL has placeholders to fill in first, so it wasn't contacted.")
  } else if (server.transport === "sse") {
    const response = await fetch(server.url, { headers: { accept: "text/event-stream" }, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((error: unknown) => error as Error)
    if (response instanceof Error) add("reachable", "Responds", "fail", `Couldn't connect: ${response.message}`)
    else {
      const stream = (response.headers.get("content-type") ?? "").includes("text/event-stream")
      if (response.status === 401 || response.status === 403) {
        const issuer = await oauthMetadata(url, response.headers.get("www-authenticate"))
        if (issuer) auth = "oauth"
        add("reachable", "Responds", "pass", `Asks for sign-in (${response.status})${issuer ? `: OAuth via ${issuer}` : auth === "headers" ? `: send ${header}` : ""}.`)
      } else add("reachable", "Responds", stream ? "pass" : "warn", stream ? "Opens an SSE stream (older transport)." : `Answered ${response.status} without an event stream.`)
      await response.body?.cancel().catch(() => undefined)
    }
  } else {
    const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dex-check", version: "1" } } }
    const response = await post(server.url, initialize).catch((error: unknown) => error as Error)
    if (response instanceof Error) {
      add("reachable", "Responds", "fail", `Couldn't connect: ${response.name === "TimeoutError" ? "no answer in 8 seconds" : response.message}`)
    } else if (response.status === 401 || response.status === 403) {
      const issuer = await oauthMetadata(url, response.headers.get("www-authenticate"))
      if (issuer) auth = "oauth"
      add(
        "reachable",
        "Responds",
        "pass",
        issuer ? `Asks for sign-in with OAuth (${issuer}); Dex handles that.` : `Asks for credentials (${response.status})${header ? `: send ${header}` : ""}.`
      )
      if (!issuer && auth === "none") auth = "headers"
    } else if (!response.ok) {
      add("reachable", "Responds", "fail", `Answered ${response.status} to an MCP handshake.`)
    } else {
      const reply = await readRpc(response)
      const info = reply?.result?.serverInfo as { name?: string; version?: string } | undefined
      if (!reply?.result) add("reachable", "Responds", "fail", reply?.error?.message ? `Handshake error: ${reply.error.message}` : "Didn't answer the MCP handshake.")
      else {
        add("reachable", "Responds", "pass", `MCP ${String(reply.result.protocolVersion ?? "?")}${info?.name ? ` · ${info.name}${info.version ? ` ${info.version}` : ""}` : ""}, no sign-in needed.`)
        // Open server: list its tools, as a client would.
        const session = response.headers.get("mcp-session-id")
        await post(server.url, { jsonrpc: "2.0", method: "notifications/initialized" }, session).then((sent) => sent.body?.cancel()).catch(() => undefined)
        const listed = await post(server.url, { jsonrpc: "2.0", id: 2, method: "tools/list" }, session).then(readRpc).catch(() => null)
        const listedTools = (listed?.result?.tools as Array<{ name?: string }> | undefined) ?? []
        tools = listedTools.flatMap((tool) => (tool.name ? [tool.name] : [])).slice(0, 50)
        add("tools", "Tools", tools.length ? "pass" : "warn", tools.length ? `${listedTools.length} tools` : "Listed no tools.")
      }
    }
  }
  if (auth === "headers") add("auth", "Credentials", "info", `Needs ${header ?? "a header"}${server.headers.find((each) => each.required)?.description ? `: ${server.headers.find((each) => each.required)!.description}` : ""}.`)

  // The source: is it maintained, licensed, used?
  const repo = server.repository && /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(server.repository)?.[1]
  if (repo) {
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "Dex (MCP checks)", ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    }).catch(() => null)
    if (response?.ok) {
      const info = (await response.json()) as { stargazers_count?: number; archived?: boolean; pushed_at?: string; license?: { spdx_id?: string } | null }
      const pushed = info.pushed_at ? Date.parse(info.pushed_at) : NaN
      const stale = !Number.isNaN(pushed) && Date.now() - pushed > YEAR_MS
      add(
        "repo",
        "Source",
        info.archived ? "fail" : stale ? "warn" : "pass",
        `${repo} · ★ ${info.stargazers_count ?? 0}${info.archived ? " · archived" : ""}${!Number.isNaN(pushed) ? ` · last push ${new Date(pushed).toISOString().slice(0, 10)}` : ""}`
      )
      const license = info.license?.spdx_id
      add("license", "License", license && license !== "NOASSERTION" ? "pass" : "warn", license && license !== "NOASSERTION" ? license : "No recognised license.")
    } else {
      add("repo", "Source", "warn", response?.status === 404 ? `${repo} isn't public on GitHub.` : `Couldn't read ${repo} on GitHub right now.`)
    }
  } else {
    add("repo", "Source", "warn", "No public source repository listed.")
  }

  if (!tools.length && listedTools.length) {
    tools = listedTools.slice(0, 50)
    add("tools", "Tools", "pass", `${listedTools.length} tools (as listed on Smithery)`)
  }
  return { url: server.url, checks, auth, header, tools, checkedAt: Date.now() }
}
