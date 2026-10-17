import { createFileRoute, Link } from "@tanstack/react-router"
import { FolderGit2, GitBranch, MessageSquarePlus, Pencil, Plus } from "lucide-react"
import { AgentAvatar } from "~/client/components/agent-avatar"
import { useDex } from "~/client/lib/dex"
import { repoLabel } from "~/shared/projects"

export const Route = createFileRoute("/_app/projects/")({ component: ProjectsPage })

function ProjectsPage() {
  const { state } = useDex()
  const projects = state?.projects ?? []
  const chatCounts = new Map<string, number>()
  for (const session of state?.sessions ?? []) {
    if (session.projectId) chatCounts.set(session.projectId, (chatCounts.get(session.projectId) ?? 0) + 1)
  }

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pt-10">
        <div className="mb-6 flex items-center gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
            <p className="mt-1 text-sm text-zinc-400">Repos and a setup script. Each chat on a project gets its own VM with everything cloned.</p>
          </div>
          <Link
            to="/projects/$projectId"
            params={{ projectId: "new" }}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            <Plus className="size-4" /> New project
          </Link>
        </div>
        {state && !state.github.connected && (
          <Link
            to="/settings"
            className="mb-4 flex items-center gap-3 rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 hover:bg-amber-950/50"
          >
            <FolderGit2 className="size-4 shrink-0" />
            Connect GitHub in Settings so VMs can clone private repos and push.
          </Link>
        )}
        {projects.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
            No projects yet. Add your repos and a setup script, then start chats that are ready to work.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {projects.map((project) => (
              <li key={project.id} className="flex min-w-0 flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex items-start gap-3">
                  <AgentAvatar icon={project.icon} color={project.color} size={40} />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-medium text-zinc-100">{project.name}</h2>
                    <p className="mt-0.5 line-clamp-2 text-sm text-zinc-400">{project.description || "Project"}</p>
                  </div>
                </div>
                <ul className="mt-3 space-y-1 text-xs text-zinc-400">
                  {project.repos.slice(0, 4).map((repo) => (
                    <li key={repo.dir} className="flex min-w-0 items-center gap-1.5">
                      <GitBranch className="size-3.5 shrink-0 text-zinc-600" />
                      <span className="truncate">{repoLabel(repo.url)}</span>
                      {repo.branch && <span className="shrink-0 text-zinc-600">{repo.branch}</span>}
                    </li>
                  ))}
                  {project.repos.length > 4 && <li className="text-zinc-600">+{project.repos.length - 4} more</li>}
                  {project.repos.length === 0 && <li className="text-zinc-600">No repos</li>}
                </ul>
                <p className="mt-2 text-xs text-zinc-500">
                  {project.setupScript.trim() ? "Setup script" : "No setup script"} · {chatCounts.get(project.id) ?? 0} chat
                  {chatCounts.get(project.id) === 1 ? "" : "s"}
                </p>
                <div className="mt-4 flex gap-2">
                  <Link
                    to="/chat"
                    search={{ project: project.id }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700"
                  >
                    <MessageSquarePlus className="size-4" /> Start chat
                  </Link>
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
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
