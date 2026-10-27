import { Type } from "@earendil-works/pi-ai"
import type { Static, TSchema } from "typebox"
import type { AccessRisk } from "~/shared/access"
import { AGENT_COLORS, AGENT_ICONS, type AgentProfile } from "~/shared/agents"
import { MODEL_PROVIDERS, MODELS, supportedThinkingLevels, THINKING_LEVELS, type ThinkingLevel } from "~/shared/models"
import type { McpAuth, McpTransport } from "~/shared/mcp"
import { NOTIFY_KINDS, type NotifyKind } from "~/shared/notifications"
import { githubFullName, normalizeRepoUrl, type ProjectProfile, type ProjectRepo } from "~/shared/projects"
import { connectedProviders, type DexState, type VmSize, VM_SIZES } from "~/shared/protocol"
import { USAGE_RANGES, type UsageRange } from "~/shared/usage"
import { VM_PEEK_VIEWS } from "./vm-peek"
import type { DexAgent } from "./dex-agent"

/**
 * Everything Dex can do, as operations that chats (through their `app_*` tools) and external agents (through the
 * MCP endpoint) can run. This is the one place app functionality is exposed programmatically: when you add a
 * `@callable()` to DexAgent, add an operation here that covers it (or list it in EXCLUDED with the reason).
 * `npm run check:ops` (part of `npm run deploy`) fails until you do.
 *
 * Every run goes through AccessCenter.execute, which validates arguments against `parameters`, enforces `risk`
 * (an MCP token's scope; a chat must get the user's confirmation for `admin`), rate-limits, and audits it.
 */

/**
 * Who is asking. A chat runs operations from its own tools; an MCP caller holds a token; `user` is you confirming
 * a chat's admin request; `ui` is you using a chat's generated UI (its live data and buttons).
 */
export type Caller =
  | { readonly kind: "chat"; readonly sessionId: string }
  | { readonly kind: "mcp"; readonly tokenId: string; readonly label: string }
  | { readonly kind: "user"; readonly sessionId: string }
  | { readonly kind: "ui"; readonly sessionId: string; readonly label: string }

/** The parts of DexAgent operations use: its callables plus a few helpers for programmatic callers. */
export type OperationHost = Pick<
  DexAgent,
  | "createSession"
  | "refreshModelList"
  | "sendMessage"
  | "abort"
  | "configureSession"
  | "renameSession"
  | "regenerateSessionTitle"
  | "deleteSession"
  | "setSessionMuted"
  | "triageSession"
  | "listFiles"
  | "readFile"
  | "writeFile"
  | "deleteFile"
  | "runCommand"
  | "saveAgent"
  | "deleteAgent"
  | "saveProject"
  | "projectImageCandidates"
  | "deleteProject"
  | "saveMcpServer"
  | "connectMcpServer"
  | "setMcpServerDefault"
  | "deleteMcpServer"
  | "updateSettings"
  | "usageReport"
  | "vmRefresh"
  | "vmStart"
  | "vmStop"
  | "vmDestroy"
  | "vmRerunSetup"
  | "vmActivity"
  | "vmRun"
  | "vmPeek"
  | "vmFiles"
  | "vmExposePort"
  | "shareMediaFromVm"
  | "pushUpdate"
  | "pushTest"
  | "pushUnsubscribe"
  | "listScheduledPrompts"
  | "cancelScheduledPrompt"
  | "schedulePrompt"
  | "readTranscript"
  | "listArtifacts"
  | "searchGitHubRepos"
  | "listGitHubBranches"
  | "githubRepoAccess"
  | "searchMcpRegistry"
  | "checkMcpServer"
  | "findRegistryServer"
  | "listQueue"
  | "editQueued"
  | "removeQueued"
  | "moveQueued"
  | "steerQueued"
  | "searchSkills"
  | "previewSkill"
  | "installSkill"
  | "getSkill"
  | "saveSkill"
  | "setSkillAuto"
  | "updateSkill"
  | "removeSkill"
  | "saveArtifact"
  | "appState"
  | "noteSessionParent"
  | "sessionDepth"
>

export interface Operation<P extends TSchema = TSchema> {
  readonly name: string
  readonly description: string
  /** Fixed, or decided by the arguments (e.g. creating an agent is `write`, changing an existing one is `admin`). */
  readonly risk: AccessRisk | ((args: Static<P>) => AccessRisk)
  readonly parameters: P
  /** The DexAgent callables this operation makes available (checked by `npm run check:ops`). */
  readonly covers: ReadonlyArray<string>
  /**
   * False when chats already have a native tool for it (workspace files, scheduling), so it only appears over MCP.
   * Chats see everything else through `app_operations` / `app_call`.
   */
  readonly inChats?: boolean
  /** One line for the audit log and the confirmation card, e.g. `Delete 3 chats`. */
  readonly summarize: (args: Static<P>, state: DexState) => string
  readonly run: (host: OperationHost, args: Static<P>, caller: Caller) => Promise<unknown>
}

/** Callables deliberately not exposed, and why. */
export const EXCLUDED: Readonly<Record<string, string>> = {
  connectCline: "Credentials are entered only in Settings, never through a chat or an external agent.",
  disconnectCline: "Credentials are managed only in Settings.",
  connectOpenCode: "Credentials are entered only in Settings, never through a chat or an external agent.",
  disconnectOpenCode: "Credentials are managed only in Settings.",
  startChatGPTSignIn: "Signing in to ChatGPT happens only in Settings, never through a chat or an external agent.",
  finishChatGPTSignIn: "Signing in to ChatGPT happens only in Settings, never through a chat or an external agent.",
  disconnectChatGPT: "Credentials are managed only in Settings.",
  connectBoat: "Credentials are entered only in Settings, never through a chat or an external agent.",
  saveSecret: "Secrets are entered only in Settings, never through a chat or an external agent.",
  removeSecret: "Secrets are managed only in Settings.",
  transcriptImage: "The chat page loading a screenshot it shows; chats and external agents read chats with app_read_session.",
  storeChatSecret: "Secrets come only from the user's password fields in the browser; no chat or external agent may set or read them.",
  disconnectBoat: "Credentials are managed only in Settings.",
  connectGitHub: "Credentials are entered only in Settings, never through a chat or an external agent.",
  disconnectGitHub: "Credentials are managed only in Settings.",
  pushSubscribe: "A browser subscribes itself to push; there is nothing for an agent to do.",
  vmTouch: "Heartbeat from the Machine page while you control the desktop.",
  vmDesktopUrl: "A desktop URL lets whoever holds it control the VM; only the signed-in app opens one.",
  createAccessToken: "Access is granted only by the signed-in user, so no token can mint more access.",
  revokeAccessToken: "Access is managed only by the signed-in user.",
  resolvePendingAction: "Confirming an admin operation must come from the user, not from an agent.",
  uiStates: "A generated UI's own form and filter state, which the browser saves and restores; nothing for an agent to read.",
  saveUiState: "A generated UI's own form and filter state, which the browser saves and restores; nothing for an agent to set.",
  runUiOperation: "The runner behind a chat's generated UI (its Query and Mutation calls); it runs these operations itself, gated like a chat's app_call.",
  signOutEverywhere: "Sessions are managed only by the signed-in user."
}

const define = <P extends TSchema>(operation: Operation<P>): Operation => operation as unknown as Operation

// ── Shared parameter pieces ────────────────────────────────────────────────

const id = (description: string) => Type.String({ minLength: 1, maxLength: 120, description })
const thinking = Type.Union(THINKING_LEVELS.map((level) => Type.Literal(level)), {
  description: "Thinking level; clamped to what the model supports."
})
const modelId = Type.String({ maxLength: 120, description: "A model id from app_list_models, e.g. cline-pass/glm-5.3 or opencode-go/kimi-k3." })
const icon = Type.Optional(Type.Union(AGENT_ICONS.map((value) => Type.Literal(value)), { description: "Icon name." }))
const color = Type.Optional(Type.Union(Object.keys(AGENT_COLORS).map((value) => Type.Literal(value)), { description: "Accent color." }))
const vmKey = Type.String({ minLength: 1, maxLength: 64, description: "The VM's key: its chat's id (from app_list_vms)." })

const agentFields = {
  name: Type.String({ minLength: 1, maxLength: 60 }),
  description: Type.Optional(Type.String({ maxLength: 200 })),
  instructions: Type.Optional(Type.String({ maxLength: 20_000, description: "Added to the system prompt of this agent's chats." })),
  starter: Type.Optional(Type.String({ maxLength: 2_000, description: "Prefilled in the message box when picked." })),
  model: Type.Optional(modelId),
  thinking: Type.Optional(thinking),
  mcp_servers: Type.Optional(Type.Array(id("MCP server id"), { maxItems: 20 })),
  icon,
  color
}

const repo = Type.Object({
  url: Type.String({ minLength: 1, maxLength: 300, description: "GitHub owner/repo or an https git URL." }),
  branch: Type.Optional(Type.String({ maxLength: 120 })),
  dir: Type.Optional(Type.String({ maxLength: 120, description: "Folder under ~/work; defaults to the repo name." }))
})

const projectFields = {
  name: Type.String({ minLength: 1, maxLength: 60 }),
  description: Type.Optional(Type.String({ maxLength: 300 })),
  repos: Type.Optional(Type.Array(repo, { maxItems: 10 })),
  setup_script: Type.Optional(Type.String({ maxLength: 20_000, description: "Bash run in ~/work after cloning." })),
  instructions: Type.Optional(Type.String({ maxLength: 20_000, description: "Context for the model in this project's chats." })),
  starter: Type.Optional(Type.String({ maxLength: 2_000 })),
  vm_size: Type.Optional(Type.Union([...VM_SIZES.map((size) => Type.Literal(size.id)), Type.Null()])),
  icon,
  color,
  image: Type.Optional(
    Type.Union([Type.String({ maxLength: 300 }), Type.Null()], {
      description: "A picture shown instead of the icon: a path from app_find_project_images (or \"avatar\" for the repo owner's), found in `image_repo` or the project's first GitHub repo. null removes it."
    })
  ),
  image_repo: Type.Optional(Type.String({ maxLength: 200, description: "owner/repo to take `image` from, if not the project's first GitHub repo." }))
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Where a chat sits in the sidebar: the inbox, snoozed until a time, or settled. */
const inboxState = (session: DexState["sessions"][number]) =>
  session.snoozedUntil && session.snoozedUntil > Date.now() ? "snoozed" : session.settledAt ? "settled" : "inbox"

const chatTitle = (state: DexState, sessionId: string) => state.sessions.find((session) => session.id === sessionId)?.title ?? `chat ${sessionId}`
const quote = (text: string, max = 60) => `“${text.length > max ? `${text.slice(0, max)}…` : text}”`

const sessionSummary = (state: DexState) => (session: DexState["sessions"][number]) => ({
  id: session.id,
  title: session.title,
  model: session.model,
  thinking: session.thinking,
  busy: session.busy,
  muted: session.muted,
  agent: session.agentId ? (state.agents.find((agent) => agent.id === session.agentId)?.name ?? session.agentId) : null,
  project: session.projectId ? (state.projects.find((project) => project.id === session.projectId)?.name ?? session.projectId) : null,
  mcpServers: session.mcpServers,
  vm: state.vms.find((vm) => vm.key === session.id)?.status ?? "none",
  inbox: inboxState(session),
  snoozedUntil: session.snoozedUntil ? new Date(session.snoozedUntil).toISOString() : null,
  createdAt: new Date(session.createdAt).toISOString(),
  updatedAt: new Date(session.updatedAt).toISOString()
})

const agentDraft = (args: Static<typeof createAgentParams>, existing?: AgentProfile) => ({
  id: existing?.id,
  name: args.name ?? existing?.name ?? "",
  description: args.description ?? existing?.description ?? "",
  instructions: args.instructions ?? existing?.instructions ?? "",
  starter: args.starter ?? existing?.starter ?? "",
  model: args.model ?? existing?.model ?? "",
  thinking: (args.thinking ?? existing?.thinking ?? "medium") as ThinkingLevel,
  mcpServers: args.mcp_servers ?? existing?.mcpServers ?? [],
  icon: (args.icon ?? existing?.icon ?? "bot") as AgentProfile["icon"],
  color: (args.color ?? existing?.color ?? "emerald") as AgentProfile["color"]
})

/** Projects as operations return them: a picture is a data: URL, too big to be worth a model's context. */
const projectSummary = (project: ProjectProfile) => {
  const { image, ...rest } = project
  return { ...rest, hasImage: Boolean(image) }
}

/** The picture an operation asked for (a path from app_find_project_images), as a data: URL; undefined leaves it. */
const projectImage = async (host: OperationHost, args: { image?: string | null; image_repo?: string }, repos: ReadonlyArray<ProjectRepo>) => {
  if (args.image === undefined) return undefined
  if (args.image === null) return null
  const repo = args.image_repo ?? repos.map((entry) => githubFullName(normalizeRepoUrl(entry.url) ?? "")).find(Boolean)
  if (!repo) throw new Error("The project has no GitHub repo to take a picture from. Set image_repo.")
  const found = (await host.projectImageCandidates(repo)).find((candidate) => candidate.path === args.image)
  if (!found) throw new Error(`No picture "${args.image}" in ${repo}. Use a path from app_find_project_images.`)
  return found.dataUrl
}

const projectDraft = (args: Static<typeof createProjectParams>, existing?: ProjectProfile) => ({
  id: existing?.id,
  name: args.name ?? existing?.name ?? "",
  description: args.description ?? existing?.description ?? "",
  repos: args.repos
    ? args.repos.map((entry): ProjectRepo => ({ url: entry.url, branch: entry.branch ?? "", dir: entry.dir ?? "" }))
    : (existing?.repos ?? []),
  setupScript: args.setup_script ?? existing?.setupScript ?? "",
  instructions: args.instructions ?? existing?.instructions ?? "",
  starter: args.starter ?? existing?.starter ?? "",
  vmSize: (args.vm_size !== undefined ? args.vm_size : (existing?.vmSize ?? null)) as VmSize | null,
  icon: (args.icon ?? existing?.icon ?? "briefcase") as ProjectProfile["icon"],
  color: (args.color ?? existing?.color ?? "sky") as ProjectProfile["color"]
})

const createAgentParams = Type.Object(agentFields)
const createProjectParams = Type.Object(projectFields)

/** A chat may start chats, and those may start chats, but no deeper: no runaway trees of agents. */
const MAX_CHAT_DEPTH = 2

// ── The operations ─────────────────────────────────────────────────────────

export const OPERATIONS: ReadonlyArray<Operation> = [
  // Overview and reading
  define({
    name: "app_overview",
    description: "A summary of this Dex: counts of chats, agents, projects, MCP servers, and VMs; what's connected; and the settings.",
    risk: "read",
    parameters: Type.Object({}),
    covers: [],
    summarize: () => "Overview",
    run: async (host) => {
      const state = host.appState()
      return {
        chats: { total: state.sessions.length, busy: state.sessions.filter((session) => session.busy).length },
        agents: state.agents.length,
        projects: state.projects.length,
        mcpServers: state.mcp.map((server) => ({ id: server.id, name: server.name, status: server.status })),
        vms: { configured: state.vmConfigured, running: state.vms.filter((vm) => vm.status === "running").length, total: state.vms.length },
        connected: { clinePass: state.cline.connected, openCodeGo: state.opencode.connected, chatGPT: state.chatgpt.connected, github: state.github.connected ? state.github.login : null },
        pushDevices: state.push.devices.length,
        settings: state.settings
      }
    }
  }),
  define({
    name: "app_list_sessions",
    description: "List chats, most recently active first. Filter by text in the title, agent, project, or whether a run is going.",
    risk: "read",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ maxLength: 200, description: "Case-insensitive text to find in titles." })),
      agent_id: Type.Optional(id("Only chats with this agent.")),
      project_id: Type.Optional(id("Only chats on this project.")),
      busy: Type.Optional(Type.Boolean({ description: "Only chats with (true) or without (false) a run going." })),
      inbox: Type.Optional(
        Type.Union([Type.Literal("inbox"), Type.Literal("snoozed"), Type.Literal("settled")], { description: "Only chats in the inbox, snoozed, or settled." })
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: "Default 50." }))
    }),
    covers: [],
    summarize: (args) => (args.query ? `List chats matching ${quote(args.query)}` : "List chats"),
    run: async (host, args) => {
      const state = host.appState()
      const query = args.query?.toLowerCase()
      return state.sessions
        .filter((session) => !query || session.title.toLowerCase().includes(query))
        .filter((session) => !args.agent_id || session.agentId === args.agent_id)
        .filter((session) => !args.project_id || session.projectId === args.project_id)
        .filter((session) => args.busy === undefined || session.busy === args.busy)
        .filter((session) => !args.inbox || inboxState(session) === args.inbox)
        .slice(0, args.limit ?? 50)
        .map(sessionSummary(state))
    }
  }),
  define({
    name: "app_read_session",
    description: "One chat's details and its latest messages (text only; tool calls are listed by name).",
    risk: "read",
    parameters: Type.Object({
      session_id: id("The chat's id."),
      last_messages: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "How many recent messages (default 10)." }))
    }),
    covers: [],
    summarize: (args, state) => `Read ${quote(chatTitle(state, args.session_id))}`,
    run: async (host, args) => {
      const state = host.appState()
      const session = state.sessions.find((candidate) => candidate.id === args.session_id)
      if (!session) throw new Error(`No chat ${args.session_id}.`)
      return { ...sessionSummary(state)(session), messages: await host.readTranscript(args.session_id, args.last_messages ?? 10) }
    }
  }),
  define({
    name: "app_list_chat_files",
    description:
      "The videos, audio, and images stored in a chat (shared with share_media, or saved from links to its VM). URLs are /api/media/… on Dex, viewable only by its owner.",
    risk: "read",
    parameters: Type.Object({ session_id: id("The chat's id.") }),
    covers: ["listArtifacts"],
    summarize: (args, state) => `List files in ${quote(chatTitle(state, args.session_id))}`,
    run: async (host, args) =>
      host.listArtifacts(args.session_id).map(({ name, kind, size, url, createdAt }) => ({ name, kind, size, url, created_at: new Date(createdAt).toISOString() }))
  }),
  define({
    name: "app_save_chat_file",
    description:
      "Save a video, audio file, or image a chat linked from its VM (an https://…on.boat.dev/… URL) into the chat, so it keeps playing after the VM sleeps. Starts the VM if needed.",
    risk: "write",
    parameters: Type.Object({
      session_id: id("The chat's id."),
      url: Type.String({ maxLength: 2_000, description: "The VM link from the chat." })
    }),
    covers: ["saveArtifact"],
    inChats: false,
    summarize: (args, state) => `Save a file into ${quote(chatTitle(state, args.session_id))}`,
    run: async (host, args) => host.saveArtifact(args.session_id, args.url)
  }),
  define({
    name: "app_search_github_repos",
    description:
      "Find GitHub repos for a project: the ones the user's GitHub connection can reach (theirs, collaborations, and org repos the org allowed Dex; private included) matching the words, then public repos by name. Empty query: their most recently pushed. Also says which orgs Dex can see.",
    risk: "read",
    parameters: Type.Object({
      query: Type.String({ maxLength: 100, description: "Words in the repo's name or description; empty for recent." }),
      owner: Type.Optional(Type.String({ maxLength: 100, description: "Only this user's or org's repos." }))
    }),
    covers: ["searchGitHubRepos", "githubRepoAccess"],
    summarize: (args) => (args.query ? `Search GitHub repos for ${quote(args.query)}` : "List recent GitHub repos"),
    run: async (host, args) => {
      const [repos, access] = await Promise.all([host.searchGitHubRepos(args.query, args.owner), host.githubRepoAccess()])
      return { repos, access: { connected: access.connected, login: access.login, orgs: access.orgs.map((org) => org.login) } }
    }
  }),
  define({
    name: "app_list_github_branches",
    description: "A GitHub repo's branches (owner/repo), its default branch first.",
    risk: "read",
    parameters: Type.Object({ repo: Type.String({ maxLength: 200, description: "owner/repo" }) }),
    covers: ["listGitHubBranches"],
    summarize: (args) => `List branches of ${args.repo}`,
    run: async (host, args) => host.listGitHubBranches(args.repo)
  }),
  define({
    name: "app_search_mcp_registry",
    description:
      "Search for MCP servers to add (by name, e.g. \"linear\"). Registry results include packages (transport stdio) that Dex runs on its MCP VM. source \"smithery\" (default) is fast and has use counts and verification; its endpoints are Smithery-hosted and sign in through Smithery. source \"registry\" is the official MCP Registry, with publishers' own endpoints (slow for new searches). Check one with app_check_mcp_server (it finds Smithery endpoints), then add it with app_save_mcp_server.",
    risk: "read",
    parameters: Type.Object({
      query: Type.String({ minLength: 2, maxLength: 100 }),
      source: Type.Optional(Type.Union([Type.Literal("smithery"), Type.Literal("registry")]))
    }),
    covers: ["searchMcpRegistry"],
    summarize: (args) => `Search ${args.source === "registry" ? "the MCP Registry" : "Smithery"} for ${quote(args.query)}`,
    run: async (host, args) => host.searchMcpRegistry(args.query, args.source ?? "smithery")
  }),
  define({
    name: "app_check_mcp_server",
    description:
      "Run Dex's checks on a server from app_search_mcp_registry: HTTPS, the verified publisher and whether the endpoint is on their domain, an MCP handshake (open, OAuth, or a header), its tools, and its GitHub repo (stars, license, archived, last push). For a package (transport stdio) it reports the command Dex would run on its MCP VM and the environment variables it needs.",
    risk: "read",
    parameters: Type.Object({
      name: Type.String({ maxLength: 200, description: "The name from app_search_mcp_registry." }),
      source: Type.Optional(Type.Union([Type.Literal("smithery"), Type.Literal("registry")]))
    }),
    covers: ["checkMcpServer"],
    summarize: (args) => `Check MCP server ${args.name}`,
    run: async (host, args) => {
      const server = await host.findRegistryServer(args.name, args.source ?? "smithery")
      if (!server) throw new Error(`No server named ${args.name} found there.`)
      return { server, report: await host.checkMcpServer(server) }
    }
  }),
  define({
    name: "app_list_secrets",
    description:
      "The user's saved secrets: environment variable names (and notes) every chat's VM gets. Values are never available; they're added and changed only in Settings → Secrets.",
    risk: "read",
    parameters: Type.Object({}),
    covers: [],
    summarize: () => "List saved secret names",
    run: async (host) => host.appState().secrets
  }),
  define({
    name: "app_list_skills",
    description:
      "List installed skills: name (what follows / in a message), description, where it came from, and whether chats load it on their own (auto).",
    risk: "read",
    parameters: Type.Object({}),
    covers: [],
    summarize: () => "List skills",
    run: async (host) => host.appState().skills
  }),
  define({
    name: "app_get_skill",
    description: "One installed skill's full instructions and its list of files.",
    risk: "read",
    parameters: Type.Object({ name: Type.String({ maxLength: 64, description: "The skill's name." }) }),
    covers: ["getSkill"],
    summarize: (args) => `Read skill ${args.name}`,
    run: async (host, args) => host.getSkill(args.name) ?? { error: `No skill ${args.name}.` }
  }),
  define({
    name: "app_search_skills",
    description: "Search the skills.sh directory for skills to install. Results have a GitHub source (owner/repo), a skill id, and install counts.",
    risk: "read",
    parameters: Type.Object({ query: Type.String({ minLength: 2, maxLength: 100 }) }),
    covers: ["searchSkills"],
    summarize: (args) => `Search skills.sh for ${quote(args.query)}`,
    run: async (host, args) => host.searchSkills(args.query)
  }),
  define({
    name: "app_preview_skill",
    description: "Read a skill from its GitHub repo before installing it: its name, description, instructions, and files.",
    risk: "read",
    parameters: Type.Object({
      source: Type.String({ maxLength: 200, description: "GitHub owner/repo, from app_search_skills." }),
      skill_id: Type.String({ maxLength: 100, description: "The skill id, from app_search_skills." })
    }),
    covers: ["previewSkill"],
    summarize: (args) => `Preview skill ${args.skill_id} from ${args.source}`,
    run: async (host, args) => host.previewSkill(args.source, args.skill_id)
  }),
  define({
    name: "app_install_skill",
    description:
      "Install (or update) a skill from GitHub, usually found with app_search_skills. Its instructions then go to every chat that uses it, so check it with app_preview_skill first.",
    risk: "admin",
    parameters: Type.Object({
      source: Type.String({ maxLength: 200, description: "GitHub owner/repo." }),
      skill_id: Type.String({ maxLength: 100 }),
      auto: Type.Optional(Type.Boolean({ description: "Let chats load it on their own when a request matches (default true)." }))
    }),
    covers: ["installSkill", "updateSkill"],
    summarize: (args) => `Install skill ${args.skill_id} from ${args.source}`,
    run: async (host, args) => {
      const skill = await host.installSkill(args.source, args.skill_id, args.auto ?? true)
      return { name: skill.id, description: skill.description, files: skill.files, auto: skill.auto }
    }
  }),
  define({
    name: "app_save_skill",
    description: "Create a skill, or edit one (give `id`): a name, a description saying when to use it, and instructions in Markdown.",
    risk: "admin",
    parameters: Type.Object({
      id: Type.Optional(Type.String({ maxLength: 64, description: "The skill to edit; omit to create one." })),
      name: Type.String({ maxLength: 64, description: "Lowercase letters, digits, and dashes." }),
      description: Type.String({ maxLength: 1_000 }),
      instructions: Type.String({ maxLength: 200_000 }),
      auto: Type.Optional(Type.Boolean())
    }),
    covers: ["saveSkill"],
    summarize: (args) => (args.id ? `Edit skill ${args.id}` : `Create skill ${args.name}`),
    run: async (host, args) => {
      const skill = host.saveSkill(args)
      return { name: skill.id, description: skill.description, auto: skill.auto }
    }
  }),
  define({
    name: "app_set_skill_auto",
    description: "Choose whether chats load a skill on their own when a request matches (auto), or only when a message starts with /<name>.",
    risk: "admin",
    parameters: Type.Object({ name: Type.String({ maxLength: 64 }), auto: Type.Boolean() }),
    covers: ["setSkillAuto"],
    summarize: (args) => `${args.auto ? "Let chats use" : "Only use on request"} skill ${args.name}`,
    run: async (host, args) => {
      host.setSkillAuto(args.name, args.auto)
      return { ok: true }
    }
  }),
  define({
    name: "app_remove_skill",
    description: "Uninstall a skill.",
    risk: "admin",
    parameters: Type.Object({ name: Type.String({ maxLength: 64 }) }),
    covers: ["removeSkill"],
    summarize: (args) => `Remove skill ${args.name}`,
    run: async (host, args) => ({ removed: host.removeSkill(args.name) })
  }),
  define({
    name: "app_list_queue",
    description: "A chat's queued messages (sent while it was busy), next first, and whether the queue is held because the chat was stopped.",
    risk: "read",
    parameters: Type.Object({ session_id: id("The chat's id.") }),
    covers: ["listQueue"],
    summarize: (args, state) => `List queued messages in ${quote(chatTitle(state, args.session_id))}`,
    run: async (host, args) => host.listQueue(args.session_id)
  }),
  define({
    name: "app_manage_queue",
    description:
      "Change a chat's queued messages before they're sent: edit one's text, remove it, move it to a position (0 is next), or steer (send it now, into the run that's going).",
    risk: "write",
    parameters: Type.Object({
      session_id: id("The chat's id."),
      message_id: Type.String({ maxLength: 64, description: "From app_list_queue." }),
      action: Type.Union([Type.Literal("edit"), Type.Literal("remove"), Type.Literal("move"), Type.Literal("steer")]),
      text: Type.Optional(Type.String({ minLength: 1, maxLength: 100_000, description: "New text, for edit." })),
      position: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000, description: "New position, for move." }))
    }),
    covers: ["editQueued", "removeQueued", "moveQueued", "steerQueued"],
    summarize: (args, state) => `${args.action[0]!.toUpperCase()}${args.action.slice(1)} a queued message in ${quote(chatTitle(state, args.session_id))}`,
    run: async (host, args) => {
      if (args.action === "edit") {
        if (!args.text) throw new Error("edit needs text.")
        host.editQueued(args.session_id, args.message_id, args.text)
      } else if (args.action === "remove") host.removeQueued(args.session_id, args.message_id)
      else if (args.action === "move") host.moveQueued(args.session_id, args.message_id, args.position ?? 0)
      else await host.steerQueued(args.session_id, args.message_id)
      return host.listQueue(args.session_id)
    }
  }),
  define({
    name: "app_list_agents",
    description: "List custom agents: presets with instructions, model, thinking level, and MCP servers.",
    risk: "read",
    parameters: Type.Object({}),
    covers: [],
    summarize: () => "List agents",
    run: async (host) => host.appState().agents
  }),
  define({
    name: "app_list_projects",
    description: "List projects: repos, setup script, notes for the model, and VM size.",
    risk: "read",
    parameters: Type.Object({}),
    covers: [],
    summarize: () => "List projects",
    run: async (host) => host.appState().projects.map(projectSummary)
  }),
  define({
    name: "app_list_mcp_servers",
    description: "List connected MCP servers with their status and tools (header values are never shown).",
    risk: "read",
    parameters: Type.Object({}),
    covers: [],
    summarize: () => "List MCP servers",
    run: async (host) =>
      host.appState().mcp.map((server) => ({ ...server, tools: server.tools.map((tool) => tool.name) }))
  }),
  define({
    name: "app_list_models",
    description:
      "Models chats and agents can use: each runs on a subscription (ClinePass, OpenCode Go, or a ChatGPT plan), usable only while that one is connected. With image input, context window, thinking levels, and cost per million tokens. The list refreshes from the providers hourly; `refresh` looks it up now (when a model seems missing or renamed).",
    risk: "read",
    parameters: Type.Object({ refresh: Type.Optional(Type.Boolean()) }),
    covers: ["modelCatalog", "refreshModelList"],
    summarize: (args) => (args.refresh ? "Refresh and list models" : "List models"),
    run: async (host, args) => {
      if (args.refresh) await host.refreshModelList()
      const state = host.appState()
      const connected = connectedProviders(state)
      return MODELS.map((model) => ({
        id: model.id,
        name: model.name,
        provider: MODEL_PROVIDERS[model.provider].name,
        available: connected[model.provider],
        input: model.input,
        contextWindow: model.contextWindow,
        thinkingLevels: supportedThinkingLevels(model),
        cost: { input: model.cost.input, output: model.cost.output, cacheRead: model.cost.cacheRead },
        ...(model.trainsOnData && { trainsOnData: true })
      }))
    }
  }),
  define({
    name: "app_list_vms",
    description: "List every chat's VM with its status, size, last use, and setup state. `refresh` re-checks each with boat.dev first.",
    risk: "read",
    parameters: Type.Object({ refresh: Type.Optional(Type.Boolean()) }),
    covers: ["vmRefresh"],
    summarize: () => "List VMs",
    run: async (host, args) => {
      if (args.refresh) await Promise.all(host.appState().vms.map((vm) => host.vmRefresh(vm.key).catch(() => undefined)))
      const state = host.appState()
      return state.vms.map((vm) => ({ ...vm, chat: state.sessions.find((session) => session.id === vm.key)?.title ?? null }))
    }
  }),
  define({
    name: "app_vm_activity",
    description: "Recent commands, file actions, and lifecycle events on a VM, with their output.",
    risk: "read",
    parameters: Type.Object({ vm_key: vmKey, limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
    covers: ["vmActivity"],
    summarize: (args, state) => `Read VM activity of ${quote(chatTitle(state, args.vm_key))}`,
    run: async (host, args) =>
      (await host.vmActivity(args.vm_key, args.limit ?? 30)).map((item) => ({ ...item, output: item.output.slice(-2_000) }))
  }),
  define({
    name: "app_vm_peek",
    description:
      "A read-only look at a chat's running VM: a folder's entries (files), the last lines of a file (file), listening ports, the busiest processes, or a repo's git status and recent commits (git). Never starts or wakes the VM: when it isn't running, returns running: false. path defaults to ~/work.",
    risk: "read",
    parameters: Type.Object({
      vm_key: vmKey,
      view: Type.Union(VM_PEEK_VIEWS.map((view) => Type.Literal(view))),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 500, description: "A folder (files, git) or file (file); ~/ is the home folder." })),
      lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_000, description: "How many lines from the end of the file (default 200)." }))
    }),
    covers: ["vmPeek"],
    summarize: (args, state) => `Look at ${args.view}${args.path ? ` ${args.path}` : ""} on the VM of ${quote(chatTitle(state, args.vm_key))}`,
    run: async (host, args) => host.vmPeek(args.vm_key, args.view, args.path, args.lines)
  }),
  define({
    name: "app_vm_files",
    description: "Browse a running VM's filesystem (directory), inspect UTF-8 source and its version in Git HEAD (file), or list staged, unstaged and untracked Git changes (changes). Defaults to ~/work, including its immediate project repositories. Directory pages contain at most 500 entries; pass next as offset to continue. File previews are limited to 64 KB per side; credential files are hidden and known secrets are masked. Does not start or keep the VM awake.",
    risk: "read",
    parameters: Type.Object({
      vm_key: vmKey,
      view: Type.Union([Type.Literal("directory"), Type.Literal("file"), Type.Literal("changes")]),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 }))
    }),
    covers: ["vmFiles"],
    summarize: (args, state) => `Inspect ${args.path ?? "~/work"} on the VM of ${quote(chatTitle(state, args.vm_key))}`,
    run: async (host, args) => host.vmFiles(args.vm_key, args.view, args.path, args.offset)
  }),
  define({
    name: "app_usage_report",
    description:
      "What Dex costs: ClinePass, OpenCode Go, and ChatGPT tokens per model and chat (with OpenCode Go's 5-hour, weekly, and monthly allowance used), boat.dev VM time, and Cloudflare usage, with daily totals.",
    risk: "read",
    parameters: Type.Object({ range: Type.Optional(Type.Union(USAGE_RANGES.map((range) => Type.Literal(range.id)))) }),
    covers: ["usageReport"],
    summarize: (args) => `Usage report (${args.range ?? "month"})`,
    run: async (host, args) => host.usageReport((args.range ?? "month") as UsageRange)
  }),
  define({
    name: "app_list_schedules",
    description: "List scheduled prompts.",
    risk: "read",
    inChats: false,
    parameters: Type.Object({}),
    covers: ["listScheduledPrompts"],
    summarize: () => "List scheduled prompts",
    run: async (host) => host.listScheduledPrompts()
  }),
  define({
    name: "app_list_files",
    description: "List files in the agent's /workspace.",
    risk: "read",
    inChats: false,
    parameters: Type.Object({}),
    covers: ["listFiles"],
    summarize: () => "List workspace files",
    run: async (host) => host.listFiles()
  }),
  define({
    name: "app_read_file",
    description: "Read a file from the agent's /workspace.",
    risk: "read",
    inChats: false,
    parameters: Type.Object({ path: Type.String({ minLength: 1, maxLength: 500 }) }),
    covers: ["readFile"],
    summarize: (args) => `Read ${args.path}`,
    run: async (host, args) => host.readFile(args.path)
  }),
  define({
    name: "app_list_push_devices",
    description: "Devices that get push notifications, and what each wants to hear about.",
    risk: "read",
    parameters: Type.Object({}),
    covers: [],
    summarize: () => "List notification devices",
    run: async (host) => host.appState().push.devices
  }),

  // Chats
  define({
    name: "app_create_session",
    description:
      "Start a new chat, optionally with an agent, a project (its VM boots with the repos cloned), a model, and MCP servers. " +
      "Give `message` to send its first message right away; the chat then works on it independently.",
    risk: "write",
    parameters: Type.Object({
      title: Type.Optional(Type.String({ maxLength: 120 })),
      message: Type.Optional(Type.String({ maxLength: 50_000, description: "First message; the chat starts working on it." })),
      agent_id: Type.Optional(id("Start with this agent's instructions, model, and MCP servers.")),
      project_id: Type.Optional(id("Work on this project.")),
      model: Type.Optional(modelId),
      thinking: Type.Optional(thinking),
      mcp_servers: Type.Optional(Type.Array(id("MCP server id"), { maxItems: 20 }))
    }),
    covers: ["createSession"],
    summarize: (args) => `Start a chat${args.title ? ` ${quote(args.title)}` : args.message ? ` about ${quote(args.message)}` : ""}`,
    run: async (host, args, caller) => {
      const parent = caller.kind === "chat" ? caller.sessionId : null
      if (parent && host.sessionDepth(parent) >= MAX_CHAT_DEPTH) {
        throw new Error(`Chats started by chats can't start more chats (at most ${MAX_CHAT_DEPTH} levels).`)
      }
      const state = host.appState()
      if (args.agent_id && !state.agents.some((agent) => agent.id === args.agent_id)) throw new Error(`No agent ${args.agent_id}.`)
      if (args.project_id && !state.projects.some((project) => project.id === args.project_id)) throw new Error(`No project ${args.project_id}.`)
      const session = await host.createSession({
        title: args.title,
        agentId: args.agent_id ?? null,
        projectId: args.project_id ?? null,
        model: args.model,
        thinking: args.thinking as ThinkingLevel | undefined,
        mcpServers: args.mcp_servers
      })
      if (parent) host.noteSessionParent(session.id, parent)
      if (args.message?.trim()) await host.sendMessage(session.id, args.message)
      return { id: session.id, title: args.message?.trim() && !args.title ? args.message.slice(0, 60) : session.title, url: `/chat/${session.id}` }
    }
  }),
  define({
    name: "app_send_message",
    description: "Send a message to another chat. If it is busy, the message is queued and runs after the current one.",
    risk: "write",
    parameters: Type.Object({ session_id: id("The chat's id."), text: Type.String({ minLength: 1, maxLength: 50_000 }) }),
    covers: ["sendMessage"],
    summarize: (args, state) => `Message ${quote(chatTitle(state, args.session_id))}: ${quote(args.text, 80)}`,
    run: async (host, args, caller) => {
      if (caller.kind === "chat" && caller.sessionId === args.session_id) throw new Error("A chat can't message itself; just keep working.")
      if (!host.appState().sessions.some((session) => session.id === args.session_id)) throw new Error(`No chat ${args.session_id}.`)
      await host.sendMessage(args.session_id, args.text)
      return { sent: true }
    }
  }),
  define({
    name: "app_stop_session",
    description: "Stop a chat's current run.",
    risk: "write",
    parameters: Type.Object({ session_id: id("The chat's id.") }),
    covers: ["abort"],
    summarize: (args, state) => `Stop ${quote(chatTitle(state, args.session_id))}`,
    run: async (host, args) => {
      await host.abort(args.session_id)
      return { stopped: true }
    }
  }),
  define({
    name: "app_update_session",
    description:
      "Rename a chat, change its model, thinking level, or MCP servers, mute its notifications, settle it (done for now; " +
      "it leaves the inbox until something new happens), or snooze it until a time (it comes back then).",
    risk: "write",
    parameters: Type.Object({
      session_id: id("The chat's id."),
      title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
      model: Type.Optional(modelId),
      thinking: Type.Optional(thinking),
      mcp_servers: Type.Optional(Type.Array(id("MCP server id"), { maxItems: 20 })),
      muted: Type.Optional(Type.Boolean()),
      settled: Type.Optional(Type.Boolean({ description: "Settle (true) or bring back to the inbox (false)." })),
      snoozed_until: Type.Optional(Type.Union([Type.String({ maxLength: 40, description: "ISO 8601 time to come back." }), Type.Null()]))
    }),
    covers: ["renameSession", "configureSession", "setSessionMuted", "triageSession"],
    summarize: (args, state) => {
      const changes = [
        args.title !== undefined && `rename it ${quote(args.title)}`,
        args.model !== undefined && `model ${args.model}`,
        args.thinking !== undefined && `thinking ${args.thinking}`,
        args.mcp_servers !== undefined && "MCP servers",
        args.muted !== undefined && (args.muted ? "mute" : "unmute"),
        args.settled !== undefined && (args.settled ? "settle" : "back to the inbox"),
        args.snoozed_until !== undefined && (args.snoozed_until === null ? "unsnooze" : `snooze until ${args.snoozed_until}`)
      ].filter(Boolean)
      return `Update ${quote(chatTitle(state, args.session_id))}${changes.length ? `: ${changes.join(", ")}` : ""}`
    },
    run: async (host, args) => {
      if (!host.appState().sessions.some((session) => session.id === args.session_id)) throw new Error(`No chat ${args.session_id}.`)
      if (args.title !== undefined) await host.renameSession(args.session_id, args.title)
      if (args.model !== undefined || args.thinking !== undefined || args.mcp_servers !== undefined) {
        await host.configureSession(args.session_id, { model: args.model, thinking: args.thinking as ThinkingLevel | undefined, mcpServers: args.mcp_servers })
      }
      if (args.muted !== undefined) await host.setSessionMuted(args.session_id, args.muted)
      if (args.settled !== undefined) await host.triageSession(args.session_id, { settled: args.settled })
      if (args.snoozed_until !== undefined) {
        const until = args.snoozed_until === null ? null : Date.parse(args.snoozed_until)
        if (until !== null && Number.isNaN(until)) throw new Error(`Not a valid time: ${args.snoozed_until}`)
        await host.triageSession(args.session_id, { snoozedUntil: until })
      }
      return sessionSummary(host.appState())(host.appState().sessions.find((session) => session.id === args.session_id)!)
    }
  }),
  define({
    name: "app_regenerate_session_title",
    description:
      "Rewrite a chat's title from what it's about (its first and latest messages, summarized by a fast model on the user's subscription). Returns the new title.",
    risk: "write",
    parameters: Type.Object({ session_id: id("The chat's id.") }),
    covers: ["regenerateSessionTitle"],
    summarize: (args, state) => `Regenerate the title of ${quote(chatTitle(state, args.session_id))}`,
    run: async (host, args) => ({ title: await host.regenerateSessionTitle(args.session_id) })
  }),
  define({
    name: "app_delete_sessions",
    description: "Delete chats (they're hidden; their VMs and disks are deleted).",
    risk: "admin",
    parameters: Type.Object({ session_ids: Type.Array(id("A chat's id."), { minItems: 1, maxItems: 50 }) }),
    covers: ["deleteSession"],
    summarize: (args, state) =>
      args.session_ids.length === 1 ? `Delete ${quote(chatTitle(state, args.session_ids[0]!))}` : `Delete ${args.session_ids.length} chats`,
    run: async (host, args, caller) => {
      const ids = args.session_ids.filter((sessionId) => !(caller.kind !== "mcp" && caller.sessionId === sessionId))
      for (const sessionId of ids) await host.deleteSession(sessionId)
      return { deleted: ids }
    }
  }),

  // Agents
  define({
    name: "app_create_agent",
    description: "Create a custom agent: a preset with instructions, model, thinking level, and MCP servers that new chats can start with.",
    risk: "write",
    parameters: createAgentParams,
    covers: ["saveAgent"],
    summarize: (args) => `Create agent ${quote(args.name)}`,
    run: async (host, args) => host.saveAgent(agentDraft(args))
  }),
  define({
    name: "app_update_agent",
    description: "Change an existing agent. Only the fields you give change; edits apply to its existing chats too.",
    risk: "admin",
    parameters: Type.Object({ agent_id: id("The agent's id."), ...agentFields, name: Type.Optional(agentFields.name) }),
    covers: ["saveAgent"],
    summarize: (args, state) => `Update agent ${quote(state.agents.find((agent) => agent.id === args.agent_id)?.name ?? args.agent_id)}`,
    run: async (host, args) => {
      const existing = host.appState().agents.find((agent) => agent.id === args.agent_id)
      if (!existing) throw new Error(`No agent ${args.agent_id}.`)
      return host.saveAgent(agentDraft({ ...args, name: args.name ?? existing.name }, existing))
    }
  }),
  define({
    name: "app_delete_agent",
    description: "Delete an agent. Its chats keep working as plain chats.",
    risk: "admin",
    parameters: Type.Object({ agent_id: id("The agent's id.") }),
    covers: ["deleteAgent"],
    summarize: (args, state) => `Delete agent ${quote(state.agents.find((agent) => agent.id === args.agent_id)?.name ?? args.agent_id)}`,
    run: async (host, args) => {
      await host.deleteAgent(args.agent_id)
      return { deleted: args.agent_id }
    }
  }),

  // Projects
  define({
    name: "app_create_project",
    description: "Create a project: repos to clone into ~/work on a chat's VM, a setup script, and notes for the model.",
    risk: "write",
    parameters: createProjectParams,
    covers: ["saveProject"],
    summarize: (args) => `Create project ${quote(args.name)}`,
    run: async (host, args) => {
      const draft = projectDraft(args)
      return projectSummary(await host.saveProject({ ...draft, image: await projectImage(host, args, draft.repos) }))
    }
  }),
  define({
    name: "app_update_project",
    description: "Change an existing project. Only the fields you give change; `repos` replaces the whole list.",
    risk: "admin",
    parameters: Type.Object({ project_id: id("The project's id."), ...projectFields, name: Type.Optional(projectFields.name) }),
    covers: ["saveProject"],
    summarize: (args, state) => `Update project ${quote(state.projects.find((project) => project.id === args.project_id)?.name ?? args.project_id)}`,
    run: async (host, args) => {
      const existing = host.appState().projects.find((project) => project.id === args.project_id)
      if (!existing) throw new Error(`No project ${args.project_id}.`)
      const draft = projectDraft({ ...args, name: args.name ?? existing.name }, existing)
      return projectSummary(await host.saveProject({ ...draft, image: await projectImage(host, args, draft.repos) }))
    }
  }),
  define({
    name: "app_find_project_images",
    description:
      "Pictures a project could show instead of its icon, found in a GitHub repo: favicon, app icon, and logo files (likeliest first), then \"avatar\" (the owner's GitHub avatar). Pass a path as `image` to app_create_project or app_update_project.",
    risk: "read",
    parameters: Type.Object({ repo: Type.String({ maxLength: 200, description: "owner/repo" }) }),
    covers: ["projectImageCandidates"],
    summarize: (args) => `Find pictures in ${args.repo}`,
    run: async (host, args) =>
      (await host.projectImageCandidates(args.repo)).map((candidate) => ({ path: candidate.path, kind: candidate.dataUrl.slice(5, candidate.dataUrl.indexOf(";")) }))
  }),
  define({
    name: "app_delete_project",
    description: "Delete a project. Its chats keep their VMs and files.",
    risk: "admin",
    parameters: Type.Object({ project_id: id("The project's id.") }),
    covers: ["deleteProject"],
    summarize: (args, state) => `Delete project ${quote(state.projects.find((project) => project.id === args.project_id)?.name ?? args.project_id)}`,
    run: async (host, args) => {
      await host.deleteProject(args.project_id)
      return { deleted: args.project_id }
    }
  }),

  // MCP servers
  define({
    name: "app_save_mcp_server",
    description:
      "Add or change an MCP server. Its tools become available to chats that attach it. Either a remote one (`url`; `headers` values " +
      "are encrypted at rest, an empty value keeps the saved one; OAuth servers need the user to sign in on the MCP servers page), or " +
      "a local stdio one Dex runs on its MCP VM (`command`, e.g. from a registry package, and `env`; a variable left empty uses the saved secret of the same name, and only listed variables reach it).",
    risk: "admin",
    parameters: Type.Object({
      server_id: Type.Optional(id("Give to change an existing server.")),
      name: Type.String({ minLength: 1, maxLength: 60 }),
      url: Type.Optional(Type.String({ minLength: 1, maxLength: 500, description: "https URL of a remote server." })),
      command: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000, description: "The command that starts a local stdio server, e.g. npx -y <package>." })),
      env: Type.Optional(
        Type.Array(Type.Object({ name: Type.String({ minLength: 1, maxLength: 100 }), value: Type.String({ maxLength: 4_000 }) }), {
          maxItems: 30,
          description: "Environment variables for a local server (encrypted at rest)."
        })
      ),
      transport: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("streamable-http"), Type.Literal("sse")])),
      auth: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("headers"), Type.Literal("oauth")])),
      headers: Type.Optional(Type.Array(Type.Object({ name: Type.String({ minLength: 1, maxLength: 100 }), value: Type.String({ maxLength: 4_000 }) }), { maxItems: 10 })),
      default_on: Type.Optional(Type.Boolean({ description: "Attach to new chats that don't use an agent." }))
    }),
    covers: ["saveMcpServer"],
    summarize: (args) =>
      args.command
        ? `${args.server_id ? "Change" : "Add"} local MCP server ${quote(args.name)}, run on the MCP VM with: ${args.command}${args.env?.length ? ` (env ${args.env.map((variable) => variable.name).join(", ")})` : ""}`
        : `${args.server_id ? "Change" : "Add"} MCP server ${quote(args.name)} at ${args.url ?? "?"}${args.headers?.length ? ` with headers ${args.headers.map((header) => header.name).join(", ")}` : ""}`,
    run: async (host, args) =>
      host.saveMcpServer({
        id: args.server_id,
        name: args.name,
        url: args.url ?? "",
        ...(args.command && { local: { command: args.command, env: args.env } }),
        transport: (args.transport ?? "auto") as McpTransport,
        auth: (args.auth ?? (args.headers?.length ? "headers" : "none")) as McpAuth,
        headers: args.headers,
        defaultOn: args.default_on ?? false
      })
  }),
  define({
    name: "app_reconnect_mcp_server",
    description: "Reconnect an MCP server (e.g. after it was down) and refresh its tool list.",
    risk: "write",
    parameters: Type.Object({ server_id: id("The server's id.") }),
    covers: ["connectMcpServer"],
    summarize: (args, state) => `Reconnect MCP server ${quote(state.mcp.find((server) => server.id === args.server_id)?.name ?? args.server_id)}`,
    run: async (host, args) => host.connectMcpServer(args.server_id)
  }),
  define({
    name: "app_set_mcp_default",
    description: "Choose whether an MCP server is attached to new chats that don't use an agent.",
    risk: "admin",
    parameters: Type.Object({ server_id: id("The server's id."), default_on: Type.Boolean() }),
    covers: ["setMcpServerDefault"],
    summarize: (args, state) =>
      `${args.default_on ? "Attach" : "Stop attaching"} MCP server ${quote(state.mcp.find((server) => server.id === args.server_id)?.name ?? args.server_id)} ${args.default_on ? "to" : "on"} new chats`,
    run: async (host, args) => {
      await host.setMcpServerDefault(args.server_id, args.default_on)
      return { serverId: args.server_id, defaultOn: args.default_on }
    }
  }),
  define({
    name: "app_delete_mcp_server",
    description: "Remove an MCP server and its saved credentials.",
    risk: "admin",
    parameters: Type.Object({ server_id: id("The server's id.") }),
    covers: ["deleteMcpServer"],
    summarize: (args, state) => `Remove MCP server ${quote(state.mcp.find((server) => server.id === args.server_id)?.name ?? args.server_id)}`,
    run: async (host, args) => {
      await host.deleteMcpServer(args.server_id)
      return { deleted: args.server_id }
    }
  }),

  // Settings
  define({
    name: "app_update_settings",
    description: "Change settings: default model and thinking level for new chats, instructions added to every chat, and VM defaults.",
    risk: "admin",
    parameters: Type.Object({
      default_model: Type.Optional(modelId),
      default_thinking: Type.Optional(thinking),
      instructions: Type.Optional(Type.String({ maxLength: 20_000, description: "Added to the system prompt of every chat." })),
      vm_size: Type.Optional(Type.Union(VM_SIZES.map((size) => Type.Literal(size.id)))),
      vm_idle_minutes: Type.Optional(Type.Union([5, 10, 15, 30, 60].map((minutes) => Type.Literal(minutes))))
    }),
    covers: ["updateSettings"],
    summarize: (args) =>
      `Change settings: ${Object.keys(args).map((key) => key.replace(/_/g, " ")).join(", ") || "nothing"}`,
    run: async (host, args) => {
      await host.updateSettings({
        ...(args.default_model !== undefined && { defaultModel: args.default_model }),
        ...(args.default_thinking !== undefined && { defaultThinking: args.default_thinking as ThinkingLevel }),
        ...(args.instructions !== undefined && { instructions: args.instructions }),
        ...(args.vm_size !== undefined && { vmSize: args.vm_size as VmSize }),
        ...(args.vm_idle_minutes !== undefined && { vmMinutes: args.vm_idle_minutes })
      })
      return host.appState().settings
    }
  }),

  // VMs
  define({
    name: "app_vm_start",
    description: "Start (or resume) a chat's VM. A project chat's VM is set up with its repos first.",
    risk: "write",
    parameters: Type.Object({ vm_key: vmKey }),
    covers: ["vmStart"],
    summarize: (args, state) => `Start the VM of ${quote(chatTitle(state, args.vm_key))}`,
    run: async (host, args) => host.vmStart(args.vm_key)
  }),
  define({
    name: "app_vm_stop",
    description: "Stop a chat's VM. Its disk is kept; it resumes when needed.",
    risk: "write",
    parameters: Type.Object({ vm_key: vmKey }),
    covers: ["vmStop"],
    summarize: (args, state) => `Stop the VM of ${quote(chatTitle(state, args.vm_key))}`,
    run: async (host, args) => host.vmStop(args.vm_key)
  }),
  define({
    name: "app_vm_run",
    description: "Run a shell command on a chat's VM (starting it if needed), up to 10 minutes. Returns its output and exit code.",
    risk: "write",
    parameters: Type.Object({ vm_key: vmKey, command: Type.String({ minLength: 1, maxLength: 20_000 }) }),
    covers: ["vmRun"],
    summarize: (args, state) => `Run on the VM of ${quote(chatTitle(state, args.vm_key))}: ${quote(args.command, 80)}`,
    run: async (host, args) => host.vmRun(args.vm_key, args.command)
  }),
  define({
    name: "app_vm_rerun_setup",
    description: "Run a project VM's setup again: GitHub sign-in, cloning the repos, and the setup script.",
    risk: "write",
    parameters: Type.Object({ vm_key: vmKey }),
    covers: ["vmRerunSetup"],
    summarize: (args, state) => `Re-run setup on the VM of ${quote(chatTitle(state, args.vm_key))}`,
    run: async (host, args) => {
      await host.vmRerunSetup(args.vm_key)
      return { started: true }
    }
  }),
  define({
    name: "app_vm_expose_port",
    description: "Get a private, token-protected URL for a port on a chat's VM (e.g. a dev server). Only the user can make a port public.",
    risk: "write",
    parameters: Type.Object({ vm_key: vmKey, port: Type.Integer({ minimum: 1, maximum: 65_535 }) }),
    covers: ["vmExposePort"],
    summarize: (args, state) => `Open port ${args.port} on the VM of ${quote(chatTitle(state, args.vm_key))}`,
    run: async (host, args) => ({ url: await host.vmExposePort(args.vm_key, args.port, false) })
  }),
  define({
    name: "app_share_vm_media",
    description:
      "Share a video, audio file, or image from a chat's VM (mp4/mov/webm, mp3/m4a/wav/ogg, png/jpg/gif/webp, up to 95 MB). " +
      "It's stored privately in Dex; returns a URL the user can play in Dex while signed in.",
    risk: "write",
    inChats: false,
    parameters: Type.Object({
      vm_key: vmKey,
      path: Type.String({ minLength: 1, maxLength: 500, description: "Path of the file on the VM." }),
      title: Type.Optional(Type.String({ maxLength: 120 }))
    }),
    covers: [],
    summarize: (args, state) => `Share ${args.path} from the VM of ${quote(chatTitle(state, args.vm_key))}`,
    run: async (host, args) => host.shareMediaFromVm(args.vm_key, args.path, args.title)
  }),
  define({
    name: "app_vm_destroy",
    description: "Delete a chat's VM and everything on its disk. The chat gets a fresh VM if it needs one later.",
    risk: "admin",
    parameters: Type.Object({ vm_key: vmKey }),
    covers: ["vmDestroy"],
    summarize: (args, state) => `Delete the VM of ${quote(chatTitle(state, args.vm_key))} and its disk`,
    run: async (host, args) => host.vmDestroy(args.vm_key)
  }),

  // Scheduling (chats schedule one-off prompts with their native tool; recurring ones come here)
  define({
    name: "app_schedule_prompt",
    description:
      "Schedule a prompt: once at a time (ISO 8601), after a delay, or on a cron schedule (UTC). Runs in the given chat, or a new chat each time. " +
      "Recurring (cron) schedules need the user's confirmation: they keep running on their own.",
    // A recurring schedule outlives the chat that made it, so it's confirmed like other lasting changes.
    risk: (args) => (args.cron ? "admin" : "write"),
    parameters: Type.Object({
      prompt: Type.String({ minLength: 1, maxLength: 20_000 }),
      at: Type.Optional(Type.String({ maxLength: 40 })),
      delay_seconds: Type.Optional(Type.Integer({ minimum: 1 })),
      cron: Type.Optional(Type.String({ maxLength: 100 })),
      session_id: Type.Optional(id("Run in this chat; omit for a new chat each time."))
    }),
    covers: [],
    summarize: (args) => (args.cron ? `Run ${quote(args.prompt)} on schedule ${args.cron} (UTC), until cancelled` : `Schedule ${quote(args.prompt)}`),
    run: async (host, args) => {
      const choices = [args.at, args.delay_seconds, args.cron].filter((value) => value !== undefined)
      if (choices.length !== 1) throw new Error("Give exactly one of at, delay_seconds, or cron.")
      const when = args.at !== undefined ? new Date(args.at) : (args.delay_seconds ?? args.cron!)
      if (when instanceof Date && Number.isNaN(when.getTime())) throw new Error(`Not a valid date: ${args.at}`)
      return host.schedulePrompt({ prompt: args.prompt, when, sessionId: args.session_id ?? null })
    }
  }),
  define({
    name: "app_cancel_schedule",
    description: "Cancel a scheduled prompt.",
    risk: "write",
    inChats: false,
    parameters: Type.Object({ schedule_id: id("The scheduled prompt's id.") }),
    covers: ["cancelScheduledPrompt"],
    summarize: (args) => `Cancel scheduled prompt ${args.schedule_id}`,
    run: async (host, args) => ({ cancelled: await host.cancelScheduledPrompt(args.schedule_id) })
  }),

  // Workspace (chats have native file and shell tools)
  define({
    name: "app_write_file",
    description: "Write a file in the agent's /workspace (memory lives in /workspace/MEMORY.md).",
    risk: "write",
    inChats: false,
    parameters: Type.Object({ path: Type.String({ minLength: 1, maxLength: 500 }), content: Type.String({ maxLength: 1_000_000 }) }),
    covers: ["writeFile"],
    summarize: (args) => `Write ${args.path}`,
    run: async (host, args) => {
      await host.writeFile(args.path, args.content)
      return { written: args.path }
    }
  }),
  define({
    name: "app_delete_file",
    description: "Delete a file from the agent's /workspace.",
    risk: "admin",
    inChats: false,
    parameters: Type.Object({ path: Type.String({ minLength: 1, maxLength: 500 }) }),
    covers: ["deleteFile"],
    summarize: (args) => `Delete ${args.path}`,
    run: async (host, args) => {
      await host.deleteFile(args.path)
      return { deleted: args.path }
    }
  }),
  define({
    name: "app_run_workspace_command",
    description: "Run a command in the agent's simulated /workspace shell (grep, sed, jq, sqlite3, curl, …).",
    risk: "write",
    inChats: false,
    parameters: Type.Object({ command: Type.String({ minLength: 1, maxLength: 20_000 }) }),
    covers: ["runCommand"],
    summarize: (args) => `Run in /workspace: ${quote(args.command, 80)}`,
    run: async (host, args) => host.runCommand(args.command)
  }),

  // Notifications
  define({
    name: "app_update_push_device",
    description: `Change what a device is notified about (kinds: ${NOTIFY_KINDS.map((kind) => kind.id).join(", ")}) or whether it skips what's on screen.`,
    risk: "write",
    parameters: Type.Object({
      device_id: id("The device's id."),
      kinds: Type.Optional(Type.Array(Type.Union(NOTIFY_KINDS.map((kind) => Type.Literal(kind.id))), { maxItems: NOTIFY_KINDS.length })),
      only_when_away: Type.Optional(Type.Boolean())
    }),
    covers: ["pushUpdate"],
    summarize: (args) => `Change notifications for device ${args.device_id}`,
    run: async (host, args) => {
      await host.pushUpdate(args.device_id, { kinds: args.kinds as NotifyKind[] | undefined, onlyWhenAway: args.only_when_away })
      return host.appState().push.devices.find((device) => device.id === args.device_id) ?? null
    }
  }),
  define({
    name: "app_test_push",
    description: "Send a test notification to a device.",
    risk: "write",
    parameters: Type.Object({ device_id: id("The device's id.") }),
    covers: ["pushTest"],
    summarize: (args) => `Send a test notification to ${args.device_id}`,
    run: async (host, args) => {
      const error = await host.pushTest(args.device_id)
      if (error) throw new Error(error)
      return { sent: true }
    }
  }),
  define({
    name: "app_remove_push_device",
    description: "Stop notifications on a device.",
    risk: "admin",
    parameters: Type.Object({ device_id: id("The device's id.") }),
    covers: ["pushUnsubscribe"],
    summarize: (args) => `Stop notifications on device ${args.device_id}`,
    run: async (host, args) => {
      await host.pushUnsubscribe(args.device_id)
      return { removed: args.device_id }
    }
  })
]

export const operationByName = new Map(OPERATIONS.map((operation) => [operation.name, operation]))

/**
 * Operations a chat's generated UI may call: what the chat itself can, plus reads it has a native tool for instead
 * (workspace files, schedules), which a live view still needs.
 */
export const inUi = (operation: Operation) => operation.inChats !== false || operation.risk === "read"

export const riskOf = (operation: Operation, args: unknown): AccessRisk =>
  typeof operation.risk === "function" ? operation.risk(args as never) : operation.risk
