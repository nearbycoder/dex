import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { FolderGit2, KeyRound, Plus, Settings2, X } from "lucide-react"
import { useEffect, useState } from "react"
import { AgentAvatar } from "~/client/components/agent-avatar"
import { Composer } from "~/client/components/composer"
import { McpPicker } from "~/client/components/mcp-picker"
import { ModelLogo } from "~/client/components/model-logo"
import { ModelPicker } from "~/client/components/model-picker"
import { useDex } from "~/client/lib/dex"
import type { AgentProfile } from "~/shared/agents"
import type { ProjectProfile } from "~/shared/projects"
import { clampThinking, DEFAULT_MODEL_ID, DEFAULT_THINKING, findModel, type ThinkingLevel } from "~/shared/models"

export const Route = createFileRoute("/_app/chat/")({
  // `?agent=<id>` / `?project=<id>` preselect an agent or project, e.g. from their pages.
  validateSearch: (search: Record<string, unknown>): { agent?: string; project?: string } => ({
    ...(typeof search.agent === "string" && { agent: search.agent }),
    ...(typeof search.project === "string" && { project: search.project })
  }),
  component: NewChat
})

function NewChat() {
  const { state, stub, connected } = useDex()
  const navigate = useNavigate()
  const { agent: agentParam, project: projectParam } = Route.useSearch()
  const [choice, setChoice] = useState<{ model: string; thinking: ThinkingLevel }>({ model: DEFAULT_MODEL_ID, thinking: DEFAULT_THINKING })
  const [agentId, setAgentId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  // null: follow the default (servers marked for new chats); a list once the user or an agent picks.
  const [mcpChoice, setMcpChoice] = useState<string[] | null>(null)
  const [draft, setDraft] = useState<{ text: string; key: number } | undefined>()
  const [error, setError] = useState<string | null>(null)

  const agents = state?.agents ?? []
  const agent = agents.find((candidate) => candidate.id === agentId)
  const projects = state?.projects ?? []
  const project = projects.find((candidate) => candidate.id === projectId)
  const mcpServers = mcpChoice ?? (state?.mcp ?? []).filter((server) => server.defaultOn).map((server) => server.id)

  // With no agent picked, follow the defaults from Settings.
  useEffect(() => {
    if (state && !agentId) setChoice({ model: state.settings.defaultModel, thinking: state.settings.defaultThinking })
  }, [state?.settings.defaultModel, state?.settings.defaultThinking, agentId])

  const pick = (next: AgentProfile | null) => {
    if (!next || next.id === agentId) {
      setAgentId(null)
      setMcpChoice(null)
      if (state) setChoice({ model: state.settings.defaultModel, thinking: state.settings.defaultThinking })
      return
    }
    setAgentId(next.id)
    setMcpChoice([...next.mcpServers])
    setChoice({ model: next.model, thinking: clampThinking(findModel(next.model), next.thinking) })
    setDraft({ text: next.starter, key: Date.now() })
  }

  /** A project and an agent combine: the project brings the VM and repos, the agent the role. */
  const pickProject = (next: ProjectProfile | null) => {
    if (!next || next.id === projectId) {
      setProjectId(null)
      return
    }
    setProjectId(next.id)
    if (next.starter && !agent?.starter) setDraft({ text: next.starter, key: Date.now() })
  }

  useEffect(() => {
    if (!projectParam || !state) return
    const preselected = state.projects.find((candidate) => candidate.id === projectParam)
    if (preselected && preselected.id !== projectId) pickProject(preselected)
  }, [projectParam, state?.projects.length])

  useEffect(() => {
    if (!agentParam || !state) return
    const preselected = state.agents.find((candidate) => candidate.id === agentParam)
    if (preselected && preselected.id !== agentId) pick(preselected)
  }, [agentParam, state?.agents.length])

  const start = async (text: string) => {
    setError(null)
    try {
      const session = await stub.createSession({ ...choice, agentId, mcpServers, projectId })
      await stub.sendMessage(session.id, text)
      await navigate({ to: "/chat/$sessionId", params: { sessionId: session.id } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Agents and projects scroll; the composer stays at the bottom, as in a chat. Short content sits just above it. */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4">
        <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-end pt-6 pb-4 md:pt-10">
          <h1 className="mb-5 text-center text-2xl font-semibold tracking-tight md:text-3xl">
            {agent ? `What should ${agent.name} do${project ? ` in ${project.name}` : ""}?` : project ? `What should Dex do in ${project.name}?` : "What should Dex do?"}
          </h1>
          {state && !state.cline.connected && (
            <Link
              to="/settings"
              className="mb-4 flex items-center gap-3 rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 hover:bg-amber-950/50"
            >
              <KeyRound className="size-4 shrink-0" />
              Connect your ClinePass key in Settings so Dex can think.
            </Link>
          )}

          {projects.length > 0 && (
            <>
              <div className="mt-5 mb-2 flex items-center gap-2 px-1">
                <h2 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Projects</h2>
                <Link to="/projects" className="ml-auto flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200">
                  <Settings2 className="size-3.5" /> Manage
                </Link>
              </div>
              <div className="flex flex-wrap gap-2">
                {projects.map((candidate) => {
                  const selected = candidate.id === projectId
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => pickProject(candidate)}
                      aria-pressed={selected}
                      title={candidate.description || candidate.name}
                      className={`flex max-w-full items-center gap-2 rounded-lg border py-1.5 pr-3 pl-1.5 text-sm ${
                        selected ? "border-emerald-600/70 bg-emerald-950/30 text-zinc-100" : "border-zinc-800/80 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900/60"
                      }`}
                    >
                      <AgentAvatar icon={candidate.icon} color={candidate.color} size={24} />
                      <span className="truncate">{candidate.name}</span>
                      <span className="shrink-0 text-xs text-zinc-500">
                        {candidate.repos.length} repo{candidate.repos.length === 1 ? "" : "s"}
                      </span>
                    </button>
                  )
                })}
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: "new" }}
                  className="flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-800 px-3 py-1.5 text-sm text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                >
                  <FolderGit2 className="size-4" /> New project
                </Link>
              </div>
            </>
          )}

          <div className="mt-5 mb-2 flex items-center gap-2 px-1">
            <h2 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Agents</h2>
            <Link to="/agents" className="ml-auto flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200">
              <Settings2 className="size-3.5" /> Manage
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {agents.map((candidate) => {
              const selected = candidate.id === agentId
              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => pick(candidate)}
                  aria-pressed={selected}
                  className={`flex min-w-0 items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors sm:gap-3 sm:px-3.5 sm:py-3 ${
                    selected ? "border-emerald-600/70 bg-emerald-950/30" : "border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-900/60"
                  }`}
                >
                  <AgentAvatar icon={candidate.icon} color={candidate.color} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-100">{candidate.name}</span>
                    <span className="mt-0.5 line-clamp-2 hidden text-xs leading-relaxed text-zinc-500 sm:block">{candidate.description || "Custom agent"}</span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-zinc-500 sm:mt-1.5">
                      <ModelLogo modelId={candidate.model} className="size-3" />
                      <span className="truncate">{findModel(candidate.model)?.name ?? candidate.model}</span>
                    </span>
                  </span>
                </button>
              )
            })}
            <Link
              to="/agents/$agentId"
              params={{ agentId: "new" }}
              className="flex items-center gap-2.5 rounded-xl border border-dashed border-zinc-800 p-2.5 text-sm text-zinc-500 hover:border-zinc-700 hover:text-zinc-200 sm:gap-3 sm:px-3.5 sm:py-3"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-zinc-800">
                <Plus className="size-4" />
              </span>
              New agent
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-4 md:pb-[max(1rem,env(safe-area-inset-bottom))]">
        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
        <Composer
          autoFocus
          disabled={!connected}
          onSend={start}
          draft={draft}
          placeholder={agent ? `Ask ${agent.name}…` : undefined}
          header={
            (agent || project) && (
              <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
                {project && (
                  <span className="flex min-w-0 items-center gap-2 rounded-full border border-zinc-700/80 bg-zinc-800/60 py-1 pr-1 pl-1 text-xs text-zinc-200" title="This chat's VM starts now, with the project's repos cloned">
                    <AgentAvatar icon={project.icon} color={project.color} size={20} />
                    <span className="truncate">{project.name}</span>
                    <button type="button" onClick={() => pickProject(null)} title="No project" className="rounded-full p-0.5 text-zinc-500 hover:text-zinc-200">
                      <X className="size-3.5" />
                    </button>
                  </span>
                )}
                {agent && (
                  <span className="flex min-w-0 items-center gap-2 rounded-full border border-zinc-700/80 bg-zinc-800/60 py-1 pr-1 pl-1 text-xs text-zinc-200">
                    <AgentAvatar icon={agent.icon} color={agent.color} size={20} />
                    <span className="truncate">{agent.name}</span>
                    <button type="button" onClick={() => pick(null)} title="Use no agent" className="rounded-full p-0.5 text-zinc-500 hover:text-zinc-200">
                      <X className="size-3.5" />
                    </button>
                  </span>
                )}
              </div>
            )
          }
          toolbar={
            <div className="flex min-w-0 items-center gap-1">
              <ModelPicker model={choice.model} thinking={choice.thinking} onChange={setChoice} />
              <McpPicker servers={state?.mcp ?? []} selected={mcpServers} onChange={setMcpChoice} />
            </div>
          }
        />
      </div>
    </div>
  )
}
