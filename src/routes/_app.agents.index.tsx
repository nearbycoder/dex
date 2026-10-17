import { createFileRoute, Link } from "@tanstack/react-router"
import { MessageSquarePlus, Pencil, Plus } from "lucide-react"
import { AgentAvatar } from "~/client/components/agent-avatar"
import { ModelLogo } from "~/client/components/model-logo"
import { useDex } from "~/client/lib/dex"
import { findModel } from "~/shared/models"

export const Route = createFileRoute("/_app/agents/")({ component: AgentsPage })

function AgentsPage() {
  const { state } = useDex()
  const agents = state?.agents ?? []
  const chatCounts = new Map<string, number>()
  for (const session of state?.sessions ?? []) {
    if (session.agentId) chatCounts.set(session.agentId, (chatCounts.get(session.agentId) ?? 0) + 1)
  }

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pt-10">
        <div className="mb-6 flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
            <p className="mt-1 text-sm text-zinc-400">Presets for a job: instructions, a model, and a thinking level.</p>
          </div>
          <Link
            to="/agents/$agentId"
            params={{ agentId: "new" }}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            <Plus className="size-4" /> New agent
          </Link>
        </div>
        {agents.length === 0 ? (
          <p className="text-sm text-zinc-500">No agents yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {agents.map((agent) => (
              <li key={agent.id} className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex items-start gap-3">
                  <AgentAvatar icon={agent.icon} color={agent.color} size={40} />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-medium text-zinc-100">{agent.name}</h2>
                    <p className="mt-0.5 line-clamp-2 text-sm text-zinc-400">{agent.description || "Custom agent"}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                  <span className="flex items-center gap-1">
                    <ModelLogo modelId={agent.model} className="size-3.5" />
                    {findModel(agent.model)?.name ?? agent.model}
                  </span>
                  <span>thinking {agent.thinking}</span>
                  <span>
                    {chatCounts.get(agent.id) ?? 0} chat{chatCounts.get(agent.id) === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-4 flex gap-2">
                  <Link
                    to="/chat"
                    search={{ agent: agent.id }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700"
                  >
                    <MessageSquarePlus className="size-4" /> Start chat
                  </Link>
                  <Link
                    to="/agents/$agentId"
                    params={{ agentId: agent.id }}
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    <Pencil className="size-3.5" /> Edit
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
