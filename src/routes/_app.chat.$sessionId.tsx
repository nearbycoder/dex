import { createFileRoute, Link } from "@tanstack/react-router"
import { Bell, BellOff, Check, CheckCheck, KeyRound, Monitor, Pencil } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { Composer } from "~/client/components/composer"
import { ChatArtifactsContext, type ChatArtifacts } from "~/client/components/media"
import { MessageList } from "~/client/components/message-list"
import { McpPicker } from "~/client/components/mcp-picker"
import { ModelPicker } from "~/client/components/model-picker"
import { AgentAvatar } from "~/client/components/agent-avatar"
import { SessionMenu } from "~/client/components/session-menu"
import { Bone, ChatSkeleton } from "~/client/components/skeleton"
import { useDex, useTranscript } from "~/client/lib/dex"
import { MenuButton } from "~/client/lib/mobile-nav"

export const Route = createFileRoute("/_app/chat/$sessionId")({ component: Chat })

function Chat() {
  const { sessionId } = Route.useParams()
  const { state, stub, connected } = useDex()
  const transcript = useTranscript(sessionId)
  const session = state?.sessions.find((candidate) => candidate.id === sessionId)
  const [editing, setEditing] = useState<string | null>(null)
  const agent = session?.agentId ? state?.agents.find((candidate) => candidate.id === session.agentId) : undefined
  const project = session?.projectId ? state?.projects.find((candidate) => candidate.id === session.projectId) : undefined

  // Stable, so finished replies (memoized in MessageList) don't re-render when the page does.
  const send = useCallback((text: string) => void stub.sendMessage(sessionId, text), [stub, sessionId])
  // Files saved into this chat replace the VM links they came from.
  const artifacts = useMemo<ChatArtifacts>(
    () => ({
      bySource: new Map(transcript.artifacts.flatMap((artifact) => (artifact.source ? [[artifact.source, artifact] as const] : []))),
      saving: new Set(transcript.savingArtifacts),
      save: (url) => stub.saveArtifact(sessionId, url)
    }),
    [transcript.artifacts, transcript.savingArtifacts, stub, sessionId]
  )

  if (state && !session) {
    return <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">This chat no longer exists.</div>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="dex-chrome dex-topbar flex h-12 shrink-0 items-center gap-3 border-b border-zinc-900 px-4">
        <MenuButton />
        {project && (
          <Link to="/projects/$projectId" params={{ projectId: project.id }} title={`${project.name} project`} className="shrink-0">
            <AgentAvatar icon={project.icon} color={project.color} size={24} />
          </Link>
        )}
        {agent && (
          <Link to="/agents/$agentId" params={{ agentId: agent.id }} title={`${agent.name} agent`} className="shrink-0">
            <AgentAvatar icon={agent.icon} color={agent.color} size={24} />
          </Link>
        )}
        {editing === null ? (
          <button type="button" onClick={() => setEditing(session?.title ?? "")} className="group flex min-w-0 items-center gap-2">
            {session ? <span className="truncate text-sm font-medium">{session.title}</span> : <Bone className="h-4 w-44" />}
            <Pencil className="size-3 shrink-0 text-zinc-600 opacity-0 group-hover:opacity-100" />
          </button>
        ) : (
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              void stub.renameSession(sessionId, editing)
              setEditing(null)
            }}
          >
            <input
              autoFocus
              value={editing}
              onChange={(event) => setEditing(event.target.value)}
              onBlur={() => setEditing(null)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-sm focus:outline-none"
            />
            <button type="submit" onMouseDown={(event) => event.preventDefault()} className="p-1 text-emerald-400">
              <Check className="size-4" />
            </button>
          </form>
        )}
        {transcript.queued > 0 && <span className="text-xs text-zinc-500">{transcript.queued} queued</span>}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {(() => {
            const vm = state?.vms.find((candidate) => candidate.key === sessionId)
            if (!state?.vmConfigured || !vm) return null
            return (
              <Link
                to="/machine/$vmKey"
                params={{ vmKey: sessionId }}
                title="Watch or take over this chat's VM"
                className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              >
                <span
                  className={`size-1.5 rounded-full ${
                    vm.setup.status === "running" || vm.status === "starting"
                      ? "animate-pulse bg-amber-500"
                      : vm.status === "running"
                        ? "bg-emerald-500"
                        : "bg-zinc-600"
                  }`}
                />
                <Monitor className="size-3.5" />
                <span className="hidden sm:inline">{vm.setup.status === "running" ? "Setting up" : "Machine"}</span>
              </Link>
            )
          })()}
          {/* Only once some device has notifications on: mute this chat's. */}
          {session && (state?.push.devices.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => void stub.setSessionMuted(sessionId, !session.muted)}
              title={session.muted ? "Notifications muted for this chat. Tap to unmute." : "Mute notifications for this chat"}
              aria-pressed={session.muted}
              className={`shrink-0 rounded-md p-1.5 hover:bg-zinc-900 ${session.muted ? "text-amber-400" : "text-zinc-500 hover:text-zinc-200"}`}
            >
              {session.muted ? <BellOff className="size-4" /> : <Bell className="size-4" />}
            </button>
          )}
          {session && (
            <>
              {/* Settle: done with this chat for now; it moves under Settled until something new happens in it. */}
              <button
                type="button"
                onClick={() => void stub.triageSession(sessionId, { settled: !session.settledAt })}
                title={session.settledAt ? "Settled. Tap to move it back to the inbox." : "Settle: done for now"}
                aria-pressed={Boolean(session.settledAt)}
                className={`shrink-0 rounded-md p-1.5 hover:bg-zinc-900 ${session.settledAt ? "text-emerald-400" : "text-zinc-500 hover:text-zinc-200"}`}
              >
                <CheckCheck className="size-4" />
              </button>
              <SessionMenu session={session} className="p-1.5" />
            </>
          )}
        </div>
      </header>

      <ChatArtifactsContext.Provider value={artifacts}>
        {transcript.loaded ? <MessageList transcript={transcript} onSend={send} /> : <ChatSkeleton />}
      </ChatArtifactsContext.Provider>

      <div className="mx-auto w-full max-w-3xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-4 md:pb-[max(1rem,env(safe-area-inset-bottom))]">
        {state && !state.cline.connected && (
          <Link to="/settings" className="mb-2 flex items-center gap-2 text-xs text-amber-300 hover:underline">
            <KeyRound className="size-3.5" /> Connect ClinePass to get answers
          </Link>
        )}
        <Composer
          autoFocus
          disabled={!connected}
          running={transcript.running}
          onSend={send}
          onStop={() => void stub.abort(sessionId)}
          placeholder={transcript.running ? "Queue a follow-up…" : "Message Dex…"}
          toolbar={
            session && (
              <div className="flex min-w-0 items-center gap-1">
                <ModelPicker model={session.model} thinking={session.thinking} onChange={(value) => void stub.configureSession(sessionId, value)} />
                {/* Takes effect from the next model request, also mid-run. */}
                <McpPicker
                  servers={state?.mcp ?? []}
                  selected={session.mcpServers}
                  onChange={(mcpServers) => void stub.configureSession(sessionId, { mcpServers })}
                />
              </div>
            )
          }
        />
      </div>
    </div>
  )
}
