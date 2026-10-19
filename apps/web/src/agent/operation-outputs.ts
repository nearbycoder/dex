import { Type } from "@earendil-works/pi-ai"
import type { TSchema } from "typebox"

/**
 * What the read operations return, for generated UIs: the OpenUI guide shows each as the result of its tool, so a
 * model can write a live view without first running the operation to see the shape. Field descriptions are what
 * the model reads. Keep these in step with what the operations return. Operations without one here still work: the
 * model looks at a result first.
 */

const T = Type
const nullable = <S extends TSchema>(schema: S) => T.Union([schema, T.Null()])
const ms = (description: string) => T.Number({ description: `${description} (ms since 1970)` })
const iso = (description: string) => T.String({ description: `${description} (ISO 8601)` })

const vmStatus = T.Union(["none", "starting", "running", "stopping", "stopped", "error"].map((value) => T.Literal(value)))

const session = T.Object({
  id: T.String(),
  title: T.String(),
  model: T.String({ description: "Model id" }),
  thinking: T.String(),
  busy: T.Boolean({ description: "A run is going" }),
  muted: T.Boolean(),
  agent: nullable(T.String({ description: "Agent name" })),
  project: nullable(T.String({ description: "Project name" })),
  mcpServers: T.Array(T.String()),
  vm: vmStatus,
  inbox: T.Union([T.Literal("inbox"), T.Literal("snoozed"), T.Literal("settled")]),
  snoozedUntil: nullable(iso("Snoozed until")),
  createdAt: iso("Created"),
  updatedAt: iso("Last activity")
})

const vmSetup = T.Object({
  status: T.Union([T.Literal("none"), T.Literal("running"), T.Literal("done"), T.Literal("error")]),
  step: nullable(T.String()),
  error: nullable(T.String())
})

const vm = T.Object({
  key: T.String({ description: "The VM's key: its chat's id" }),
  id: nullable(T.String()),
  status: vmStatus,
  size: nullable(T.String()),
  archiveAfter: nullable(T.String()),
  error: nullable(T.String()),
  lastActiveAt: nullable(ms("Last used")),
  busy: T.Boolean({ description: "Something is running on it" }),
  setup: vmSetup,
  chat: nullable(T.String({ description: "Its chat's title" }))
})

const vmActivity = T.Object({
  id: T.Number(),
  at: ms("When"),
  actor: T.Union([T.Literal("agent"), T.Literal("user"), T.Literal("system")]),
  kind: T.Union(["exec", "spawn", "file", "port", "screenshot", "lifecycle"].map((value) => T.Literal(value))),
  title: T.String({ description: "The command or action" }),
  status: T.Union([T.Literal("running"), T.Literal("done"), T.Literal("error")]),
  exitCode: nullable(T.Number()),
  output: T.String({ description: "Its last 2,000 characters of output" })
})

const tokenUsage = {
  responses: T.Number(),
  inputTokens: T.Number(),
  outputTokens: T.Number(),
  cacheReadTokens: T.Number(),
  totalTokens: T.Number(),
  listCost: T.Number({ description: "USD at the models' list rates" }),
  byModel: T.Array(T.Object({ model: T.String(), responses: T.Number(), totalTokens: T.Number(), listCost: T.Number() })),
  byChat: T.Array(T.Object({ sessionId: T.String(), title: T.String(), totalTokens: T.Number(), listCost: T.Number() }))
}

const window = T.Object({ percent: T.Number({ description: "0–100 used" }), resetsAt: T.String(), limited: T.Boolean() })

const peek = (fields: Record<string, TSchema>) =>
  T.Object({
    running: T.Boolean({ description: "False when the VM isn't running (nothing else is returned then)" }),
    status: vmStatus,
    view: T.String(),
    ...Object.fromEntries(Object.entries(fields).map(([key, schema]) => [key, T.Optional(schema)]))
  })

export const OUTPUTS: Readonly<Record<string, TSchema>> = {
  app_overview: T.Object({
    chats: T.Object({ total: T.Number(), busy: T.Number() }),
    agents: T.Number(),
    projects: T.Number(),
    mcpServers: T.Array(T.Object({ id: T.String(), name: T.String(), status: T.String() })),
    vms: T.Object({ configured: T.Boolean(), running: T.Number(), total: T.Number() }),
    connected: T.Object({ clinePass: T.Boolean(), openCodeGo: T.Boolean(), github: nullable(T.String({ description: "GitHub login" })) }),
    pushDevices: T.Number(),
    settings: T.Object({ defaultModel: T.String(), defaultThinking: T.String(), instructions: T.String(), vmSize: T.String(), vmMinutes: T.Number() })
  }),
  app_list_sessions: T.Array(session),
  app_read_session: T.Intersect([
    session,
    T.Object({
      messages: T.Array(
        T.Object({
          role: T.Union([T.Literal("user"), T.Literal("assistant")]),
          at: iso("Sent"),
          text: T.String(),
          tools: T.Optional(T.Array(T.String({ description: "Tools it called" })))
        })
      )
    })
  ]),
  app_list_chat_files: T.Array(
    T.Object({ name: T.String(), kind: T.String({ description: "video, audio, or image" }), size: T.Number({ description: "Bytes" }), url: T.String(), created_at: iso("Saved") })
  ),
  app_list_secrets: T.Array(T.Object({ name: T.String({ description: "Environment variable name" }), note: T.String(), updatedAt: ms("Changed") })),
  app_list_skills: T.Array(
    T.Object({
      id: T.String({ description: "Its name; /<id> uses it" }),
      description: T.String(),
      source: nullable(T.String({ description: "GitHub owner/repo" })),
      path: nullable(T.String()),
      auto: T.Boolean({ description: "Chats load it on their own" }),
      files: T.Number(),
      size: T.Number(),
      installedAt: ms("Installed"),
      updatedAt: ms("Updated")
    })
  ),
  app_list_queue: T.Object({
    items: T.Array(T.Object({ id: T.String(), text: T.String(), createdAt: ms("Queued") })),
    held: T.Boolean({ description: "Waiting because the chat was stopped" })
  }),
  app_list_agents: T.Array(
    T.Object({
      id: T.String(),
      name: T.String(),
      description: T.String(),
      icon: T.String(),
      color: T.String(),
      instructions: T.String(),
      starter: T.String(),
      model: T.String(),
      thinking: T.String(),
      mcpServers: T.Array(T.String()),
      createdAt: ms("Created"),
      updatedAt: ms("Updated")
    })
  ),
  app_list_projects: T.Array(
    T.Object({
      id: T.String(),
      name: T.String(),
      description: T.String(),
      icon: T.String(),
      color: T.String(),
      repos: T.Array(T.Object({ url: T.String(), branch: T.String(), dir: T.String() })),
      setupScript: T.String(),
      instructions: T.String(),
      starter: T.String(),
      vmSize: nullable(T.String()),
      hasImage: T.Boolean(),
      createdAt: ms("Created"),
      updatedAt: ms("Updated")
    })
  ),
  app_list_mcp_servers: T.Array(
    T.Object({
      id: T.String(),
      name: T.String(),
      url: T.String(),
      transport: T.String(),
      auth: T.String(),
      headerNames: T.Array(T.String()),
      local: nullable(T.Object({ command: T.String(), envNames: T.Array(T.String()) })),
      defaultOn: T.Boolean(),
      prefix: T.String(),
      status: T.String({ description: "connecting, authenticating, connected, discovering, ready, failed, or disconnected" }),
      error: nullable(T.String()),
      tools: T.Array(T.String({ description: "Tool name" })),
      createdAt: ms("Added"),
      updatedAt: ms("Updated")
    })
  ),
  app_list_models: T.Array(
    T.Object({
      id: T.String(),
      name: T.String(),
      provider: T.String({ description: "ClinePass or OpenCode Go" }),
      available: T.Boolean({ description: "Its subscription is connected" }),
      input: T.Array(T.String()),
      contextWindow: T.Number(),
      thinkingLevels: T.Array(T.String()),
      cost: T.Object({ input: T.Number(), output: T.Number(), cacheRead: T.Number() }, { description: "USD per million tokens" }),
      trainsOnData: T.Optional(T.Boolean())
    })
  ),
  app_list_vms: T.Array(vm),
  app_vm_activity: T.Array(vmActivity),
  app_vm_peek: peek({
    path: T.String(),
    entries: T.Array(T.Object({ name: T.String(), type: T.String({ description: "dir, file, link, or other" }), size: T.Number(), modifiedAt: ms("Modified") }), {
      description: "view files"
    }),
    content: T.String({ description: "view file: its last lines" }),
    ports: T.Array(T.Object({ port: T.Number(), address: T.String(), process: nullable(T.String()) }), { description: "view ports" }),
    processes: T.Array(
      T.Object({ pid: T.Number(), cpu: T.Number({ description: "%" }), memory: T.Number({ description: "%" }), seconds: T.Number({ description: "Running for" }), command: T.String() }),
      { description: "view processes, busiest first" }
    ),
    repo: T.Boolean({ description: "view git: whether path is a git repo" }),
    error: T.String(),
    branch: T.String(),
    tracking: nullable(T.String()),
    changes: T.Array(T.Object({ status: T.String({ description: "git's two-letter code, e.g. M, ??" }), path: T.String() })),
    commits: T.Array(T.Object({ hash: T.String(), author: T.String(), at: ms("Committed"), subject: T.String() }))
  }),
  app_usage_report: T.Object({
    range: T.String(),
    since: ms("From"),
    until: ms("To"),
    cline: T.Object(tokenUsage, { description: "ClinePass" }),
    opencode: T.Object(
      {
        ...tokenUsage,
        connected: T.Boolean(),
        limits: nullable(T.Object({ rolling: window, weekly: window, monthly: window }, { description: "Allowance used: 5-hour, weekly, monthly" })),
        limitsError: nullable(T.String())
      },
      { description: "OpenCode Go" }
    ),
    boat: T.Object(
      {
        hours: T.Number(),
        cost: T.Number({ description: "USD" }),
        running: T.Boolean(),
        bySize: T.Array(T.Object({ size: T.String(), hours: T.Number(), cost: T.Number() })),
        runs: T.Array(T.Object({ startedAt: ms("Started"), endedAt: nullable(ms("Ended")), size: T.String(), hours: T.Number(), cost: T.Number() }))
      },
      { description: "VM time on boat.dev" }
    ),
    cloudflare: T.Object({
      configured: T.Boolean(),
      error: nullable(T.String()),
      since: ms("From"),
      lines: T.Array(
        T.Object({
          label: T.String(),
          quantity: T.Number(),
          unit: T.String(),
          cost: T.Number(),
          allowanceUsed: nullable(T.Number({ description: "0–1 of the monthly allowance" })),
          accountWide: T.Optional(T.Boolean())
        })
      ),
      meteredCost: T.Number()
    }),
    daily: T.Array(T.Object({ date: T.String({ description: "YYYY-MM-DD" }), cline: T.Number(), opencode: T.Number(), boat: T.Number(), cloudflare: T.Number() }), {
      description: "USD per day by service"
    })
  }),
  app_list_push_devices: T.Array(
    T.Object({
      id: T.String(),
      label: T.String(),
      kinds: T.Array(T.String()),
      onlyWhenAway: T.Boolean(),
      createdAt: ms("Added"),
      lastSentAt: nullable(ms("Last notified")),
      error: nullable(T.String())
    })
  ),
  app_list_schedules: T.Array(
    T.Object({ id: T.String(), prompt: T.String(), sessionId: nullable(T.String()), when: T.String(), cron: nullable(T.String()) })
  ),
  app_list_files: T.Array(T.Object({ path: T.String(), size: T.Number(), mtime: ms("Modified") })),
  app_read_file: T.Object({ path: T.String(), content: nullable(T.String({ description: "null for a binary file" })), size: T.Number() })
}
