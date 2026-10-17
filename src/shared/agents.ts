import type { ThinkingLevel } from "./models"

/** Icons an agent can wear; the client maps each key to a lucide icon. */
export const AGENT_ICONS = [
  "bot",
  "git-pull-request",
  "shield-check",
  "search-code",
  "bug",
  "rocket",
  "pen-line",
  "book-open",
  "terminal",
  "database",
  "globe",
  "telescope",
  "chart",
  "brain",
  "wrench",
  "palette",
  "lightbulb",
  "mail",
  "calendar",
  "briefcase",
  "messages",
  "code",
  "file-text",
  "sparkles"
] as const
export type AgentIcon = (typeof AGENT_ICONS)[number]

/** Avatar colors, as [background, foreground] pairs that read on the dark theme. */
export const AGENT_COLORS = {
  emerald: ["#064e3b", "#34d399"],
  sky: ["#0c4a6e", "#38bdf8"],
  violet: ["#3b0764", "#c084fc"],
  amber: ["#78350f", "#fbbf24"],
  rose: ["#881337", "#fb7185"],
  orange: ["#7c2d12", "#fb923c"],
  teal: ["#134e4a", "#2dd4bf"],
  zinc: ["#27272a", "#d4d4d8"]
} as const
export type AgentColor = keyof typeof AGENT_COLORS

export interface AgentProfile {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly icon: AgentIcon
  readonly color: AgentColor
  /** Added to the system prompt of every chat with this agent; edits apply to existing chats too. */
  readonly instructions: string
  /** Prefilled in the composer when the agent is picked. */
  readonly starter: string
  readonly model: string
  readonly thinking: ThinkingLevel
  /** MCP servers attached to chats started with this agent. */
  readonly mcpServers: ReadonlyArray<string>
  readonly createdAt: number
  readonly updatedAt: number
}

export type AgentDraft = Omit<AgentProfile, "id" | "createdAt" | "updatedAt" | "mcpServers"> & {
  readonly id?: string
  readonly mcpServers?: ReadonlyArray<string>
}

/** Seeded once for every new Dex. Each is an ordinary agent: edit or delete it freely. */
export const STARTER_AGENTS: ReadonlyArray<AgentDraft & { readonly id: string }> = [
  {
    id: "pr-author",
    name: "PR Author",
    description: "Implements a change on the VM and opens a pull request.",
    icon: "git-pull-request",
    color: "violet",
    model: "cline-pass/glm-5.3",
    thinking: "high",
    starter: "In github.com/OWNER/REPO, ",
    instructions: `You turn a request into a pull request.

Workflow, all on your VM:
1. Check GitHub access with \`gh auth status\`. If it is not logged in, stop and ask the user to run \`gh auth login\` in the Machine page terminal (or give you a token).
2. Clone the repository (\`gh repo clone\`), read its README and contributing guide, and find how to install, build, and test.
3. Create a branch named for the change, make the smallest change that does the job, and match the surrounding code style.
4. Run the project's tests and linters; fix what you broke.
5. Commit with a clear message, push, and open the PR with \`gh pr create\`. The description covers what changed, why, and how it was tested.
6. Reply with the PR URL and a short summary. Never push to the default branch.`
  },
  {
    id: "pr-reviewer",
    name: "PR Reviewer",
    description: "Reviews a pull request for bugs, risk, and missing tests.",
    icon: "shield-check",
    color: "sky",
    model: "cline-pass/deepseek-v4-pro",
    thinking: "high",
    starter: "Review https://github.com/OWNER/REPO/pull/",
    instructions: `You review pull requests like a careful senior engineer.

Workflow, on your VM:
1. Check GitHub access with \`gh auth status\`; if it is not logged in, ask the user to run \`gh auth login\` in the Machine page terminal.
2. Read the PR: \`gh pr view <url>\` and \`gh pr diff <url>\`. Check out the branch when you need to run tests or read surrounding code.
3. Look for correctness bugs, security issues, data loss, broken error handling, missing tests, and confusing code. Verify claims by reading the code; do not guess.
4. Report findings ranked by severity (blocking, should fix, nit), each with file and line, what is wrong, and a concrete fix. Use render_ui for a findings table when there are several.
5. Only post a review to GitHub (\`gh pr review\`) when the user asks you to.`
  },
  {
    id: "researcher",
    name: "Researcher",
    description: "Digs into a topic on the web and reports back with sources.",
    icon: "telescope",
    color: "amber",
    model: "cline-pass/qwen3.8-max",
    thinking: "medium",
    starter: "Research ",
    instructions: `You research questions thoroughly and report what you find.

Search and read primary sources (web_search, web_fetch, or curl on the VM). Cross-check claims across sources, note disagreements, and say what you could not verify. Lead with the answer, then the evidence, and cite every claim with a link. Use render_ui for comparisons and tables.`
  },
  {
    id: "data-analyst",
    name: "Data Analyst",
    description: "Crunches data on the VM and answers with charts.",
    icon: "chart",
    color: "teal",
    model: "cline-pass/kimi-k3",
    thinking: "high",
    starter: "Analyze ",
    instructions: `You analyze data and explain it visually.

Load data on your VM (Python 3, sqlite3, or jq), clean it, and compute with code rather than by hand. Report the headline finding first, show the numbers that support it, and render charts and tables with render_ui. State assumptions and data-quality problems plainly.`
  }
]
