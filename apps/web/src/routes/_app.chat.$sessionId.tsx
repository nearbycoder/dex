import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Bell, BellOff, Check, CheckCheck, FolderOpen, History, KeyRound, LayoutGrid, ListTree, Monitor, Pencil, RotateCcw, X } from "lucide-react"
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Composer } from "~/client/components/composer"
import { ChatArtifactsContext, type ChatArtifacts } from "~/client/components/media"
import { MessageList, type Speaker } from "~/client/components/message-list"
import { McpPicker } from "~/client/components/mcp-picker"
import { QueuePanel } from "~/client/components/queue-panel"
import { ModelPicker } from "~/client/components/model-picker"
import { AgentAvatar, CharacterAvatar } from "~/client/components/agent-avatar"
import { SessionMenu, useNaming } from "~/client/components/session-menu"
import { SpaceGlyph, SpaceIntro, SpacePanel, SpaceSelectContext, useSpaceOf } from "~/client/components/space-panel"
import { VmPreview } from "~/client/components/vm-preview"
import { Bone, ChatSkeleton, VmFilesSkeleton } from "~/client/components/skeleton"
import { type OpenUIHost, OpenUIHostContext } from "~/client/lib/openui-host"
import { ChatSecretsContext } from "~/client/lib/chat-secrets"
import { useDex, useTranscript } from "~/client/lib/dex"
import { MenuButton } from "~/client/lib/mobile-nav"
import { MODEL_PROVIDERS, providerOf } from "~/shared/models"
import { chatOfVm, connectedProviders } from "~/shared/protocol"
import { attachmentSummary, type ChatAttachment } from "~/shared/attachments"
import { ask } from "~/client/components/confirm-dialog"

export const Route = createFileRoute("/_app/chat/$sessionId")({ component: Chat })

// Trees, Diffs, syntax grammars and themes only load when Files is opened.
const VmFilesPanel = lazy<typeof import("~/client/components/vm-files")["default"]>(() =>
  import.meta.env.SSR ? Promise.resolve({ default: () => <></> }) : import("~/client/components/vm-files")
)

function Chat() {
  const { sessionId } = Route.useParams()
  const { state, stub, connected } = useDex()
  const transcript = useTranscript(sessionId)
  const session = state?.sessions.find((candidate) => candidate.id === sessionId)
  const [editing, setEditing] = useState<string | null>(null)
  const [filesSession, setFilesSession] = useState<string | null>(null)
  const filesOpen = filesSession === sessionId
  const closeFiles = useCallback(() => setFilesSession(null), [])
  const naming = useNaming(sessionId)
  const agent = session?.agentId ? state?.agents.find((candidate) => candidate.id === session.agentId) : undefined
  const project = session?.projectId ? state?.projects.find((candidate) => candidate.id === session.projectId) : undefined
  const character = session?.characterId ? state?.characters.find((candidate) => candidate.id === session.characterId) : undefined
  // A character's conversation from before they started over: still theirs, no longer the one in the sidebar.
  const earlier = Boolean(character && character.sessionId !== sessionId)
  const navigate = useNavigate()
  // A space's coordinator (this page then has its threads beside it) or one of its threads.
  const spaceOf = useSpaceOf(session)
  const coordinating = spaceOf?.coordinator ? spaceOf.space : undefined
  const inSpace = spaceOf && !spaceOf.coordinator ? spaceOf.space : undefined
  const [panel, setPanel] = useState<{ sessionId: string; thread: string | null } | null>(null)
  const panelOpen = Boolean(coordinating) && panel?.sessionId === sessionId
  // Wide screens open a space with its threads showing.
  useEffect(() => {
    if (coordinating && window.matchMedia("(min-width: 1280px)").matches) setPanel({ sessionId, thread: null })
  }, [sessionId, Boolean(coordinating)])
  const selectThread = useCallback(
    (threadId: string) => {
      if (window.matchMedia("(min-width: 1024px)").matches) setPanel({ sessionId, thread: threadId })
      else void navigate({ to: "/chat/$sessionId", params: { sessionId: threadId } })
    },
    [sessionId, navigate]
  )
  // Kept stable across state updates, so finished replies don't re-render.
  const speaker = useMemo<Speaker | undefined>(
    () =>
      character
        ? {
            name: character.name,
            avatar: <CharacterAvatar character={character} size={24} mood="still" />,
            working: <CharacterAvatar character={character} size={24} mood="working" />,
            greeter: <CharacterAvatar character={character} size={24} />,
            greeting: character.greeting || undefined
          }
        : coordinating && { name: coordinating.name, avatar: <SpaceGlyph size={24} /> },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [character?.name, character?.avatar, character?.image, character?.color, character?.greeting, JSON.stringify(character?.look ?? null), coordinating?.name, coordinating?.goal]
  )

  // What you just sent shows at once while the agent records it (a round trip, longer when it's waking up). Each
  // pending message is matched to the next message the agent records, not by text: skills and secrets change it.
  const [pending, setPending] = useState<{ text: string; after: number; at: number }[]>([])
  const userCount = transcript.entries.filter((entry) => entry.kind === "pi.user").length
  const live = useRef({ running: transcript.running, queued: transcript.queue.length, userCount })
  live.current = { running: transcript.running, queued: transcript.queue.length, userCount }
  useEffect(() => setPending([]), [sessionId])
  useEffect(() => {
    // Recorded (or queued instead, where the queue panel shows it), or never confirmed: let go.
    setPending((list) => {
      const recorded = Math.max(0, userCount - (list[0]?.after ?? userCount))
      const next = list.slice(recorded).filter((item) => Date.now() - item.at < 20_000)
      return transcript.queue.length > 0 && next.length ? [] : next.length === list.length ? list : next
    })
  }, [userCount, transcript.queue.length])
  useEffect(() => {
    if (!pending.length) return
    const timer = setTimeout(() => setPending((list) => list.filter((item) => Date.now() - item.at < 20_000)), 20_500)
    return () => clearTimeout(timer)
  }, [pending])

  // Stable, so finished replies (memoized in MessageList) don't re-render when the page does.
  const send = useCallback(
    (text: string, attachments: ChatAttachment[] = []) => {
      const trimmed = text.trim()
      if (!trimmed && attachments.length === 0) return
      // Shown until the agent records it; a message of only files shows their names.
      const label = trimmed || `Attached: ${attachmentSummary(attachments)}`
      // A busy chat queues it instead, and the queue panel shows it.
      const willQueue = live.current.running || live.current.queued > 0
      if (!willQueue) setPending((list) => [...list, { text: label, after: live.current.userCount + list.length, at: Date.now() }])
      void stub
        .sendMessage(sessionId, trimmed, attachments.length ? attachments : undefined)
        .catch(() => setPending((list) => list.filter((item) => item.text !== label)))
    },
    [stub, sessionId]
  )
  const pendingTexts = useMemo(() => pending.map((item) => item.text), [pending])
  // A suggestion picked from a new space's intro, put in the message box to edit before sending.
  const [draft, setDraft] = useState<{ text: string; key: number } | undefined>()
  const storeSecret = useCallback((field: string, value: string) => stub.storeChatSecret(sessionId, field, value), [stub, sessionId])
  // Generated UIs in this chat: their operations, and their saved filters and choices.
  const [uiStates, setUiStates] = useState<{ readonly sessionId: string; readonly states: Record<string, unknown> } | null>(null)
  useEffect(() => {
    let current = true
    stub
      .uiStates(sessionId)
      .catch(() => ({}))
      .then((states) => {
        if (current) setUiStates({ sessionId, states })
      })
    return () => {
      current = false
    }
  }, [stub, sessionId])
  const uiHost = useMemo<OpenUIHost>(
    () => ({
      scope: sessionId,
      run: (name, args, options) => stub.runUiOperation(sessionId, name, args, options),
      states: uiStates?.sessionId === sessionId ? uiStates.states : null,
      saveState: (card, state) => void stub.saveUiState(sessionId, card, state).catch(() => undefined)
    }),
    [stub, sessionId, uiStates]
  )
  // Files saved into this chat replace the VM links they came from.
  const artifacts = useMemo<ChatArtifacts>(
    () => ({
      bySource: new Map(transcript.artifacts.flatMap((artifact) => (artifact.source ? [[artifact.source, artifact] as const] : []))),
      saving: new Set(transcript.savingArtifacts),
      save: (url) => stub.saveArtifact(sessionId, url)
    }),
    [transcript.artifacts, transcript.savingArtifacts, stub, sessionId]
  )

  const vm = state?.vmConfigured ? state.vms.find((candidate) => candidate.key === sessionId) : undefined
  // A chat can run several VMs at once; with more than one, its machine button opens the control panel of all of them.
  const chatVms = state?.vmConfigured ? state.vms.filter((candidate) => chatOfVm(candidate.key) === sessionId) : []

  if (state && !session) {
    return <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">This chat no longer exists.</div>
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div className={`${filesOpen ? "hidden xl:flex" : panelOpen ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-1 flex-col`}>
      <header className="dex-chrome dex-topbar flex h-12 shrink-0 items-center gap-3 border-b border-zinc-900 px-4">
        <MenuButton />
        {character && (
          <Link
            to="/sidekicks/$characterId"
            params={{ characterId: character.id }}
            title={`About ${character.name}`}
            className="-my-1 flex min-w-0 items-center gap-2.5 rounded-lg py-1 pr-2 hover:bg-zinc-900"
          >
            <CharacterAvatar character={character} size={30} mood={transcript.running ? "working" : "idle"} failed={Boolean(transcript.error)} />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-medium text-zinc-100">{character.name}</span>
              <span className={`block truncate text-[11px] ${transcript.running ? "text-emerald-400" : "text-zinc-500"}`}>
                {transcript.running ? "typing…" : earlier ? `Earlier conversation · ${new Date(session!.createdAt).toLocaleDateString()}` : character.tagline}
              </span>
            </span>
          </Link>
        )}
        {coordinating && (
          <Link
            to="/spaces/$spaceId"
            params={{ spaceId: coordinating.id }}
            title={`Edit ${coordinating.name}`}
            className="-my-1 flex min-w-0 items-center gap-2.5 rounded-lg py-1 pr-2 hover:bg-zinc-900"
          >
            <SpaceGlyph size={28} />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-medium text-zinc-100">{coordinating.name}</span>
              <span className="block truncate text-[11px] text-zinc-500">{coordinating.goal || "Space"}</span>
            </span>
          </Link>
        )}
        {inSpace && (
          <Link
            to="/chat/$sessionId"
            params={{ sessionId: inSpace.sessionId }}
            title={`Back to ${inSpace.name}`}
            className="flex max-w-40 shrink-0 items-center gap-1.5 rounded-md border border-zinc-800 py-0.5 pr-2 pl-1 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
          >
            <ArrowLeft className="size-3 shrink-0" />
            <SpaceGlyph size={16} />
            <span className="truncate">{inSpace.name}</span>
          </Link>
        )}
        {project && !coordinating && (
          <Link to="/projects/$projectId" params={{ projectId: project.id }} title={`${project.name} project`} className="shrink-0">
            <AgentAvatar icon={project.icon} color={project.color} image={project.image} size={24} />
          </Link>
        )}
        {agent && (
          <Link to="/agents/$agentId" params={{ agentId: agent.id }} title={`${agent.name} agent`} className="shrink-0">
            <AgentAvatar icon={agent.icon} color={agent.color} size={24} />
          </Link>
        )}
        {character || coordinating ? null : editing === null ? (
          <button type="button" onClick={() => setEditing(session?.title ?? "")} className="group flex min-w-0 items-center gap-2">
            {session ? (
              <span className={`truncate text-sm font-medium ${naming ? "animate-pulse text-zinc-400" : ""}`} title={naming ? "Writing a new title…" : undefined}>
                {session.title}
              </span>
            ) : (
              <Bone className="h-4 w-44" />
            )}
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
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-base focus:outline-none md:text-sm"
            />
            <button type="submit" onMouseDown={(event) => event.preventDefault()} className="p-1 text-emerald-400">
              <Check className="size-4" />
            </button>
          </form>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {coordinating && spaceOf && (
            <button
              type="button"
              title="This space's threads and notes"
              aria-expanded={panelOpen}
              onClick={() => setPanel(panelOpen ? null : { sessionId, thread: null })}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-zinc-900 ${panelOpen ? "text-violet-300" : "text-zinc-400 hover:text-zinc-100"}`}
            >
              <ListTree className="size-4" />
              <span className="hidden sm:inline">Threads</span>
              {spaceOf.threads.some((entry) => entry.status === "working" || entry.status === "needs_you") && (
                <span
                  className={`rounded-full px-1.5 text-[10px] font-medium tabular-nums ${
                    spaceOf.threads.some((entry) => entry.status === "needs_you") ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/15 text-emerald-300"
                  }`}
                >
                  {spaceOf.threads.filter((entry) => entry.status === "working" || entry.status === "needs_you").length}
                </span>
              )}
            </button>
          )}
          {session && state?.vmConfigured && !coordinating && (
            <button type="button" title="Browse this session’s VM files" aria-label="Open VM files" aria-expanded={filesOpen} onClick={() => setFilesSession(filesOpen ? null : sessionId)} className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-zinc-900 ${filesOpen ? "text-emerald-400" : "text-zinc-400 hover:text-zinc-100"}`}>
              <FolderOpen className="size-4" /><span className="hidden sm:inline">Files</span>
            </button>
          )}
          {chatVms.length > 1 && (
            <Link
              to="/control/$sessionId"
              params={{ sessionId }}
              title="Watch all of this chat's VMs at once"
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <span
                className={`size-1.5 rounded-full ${
                  chatVms.some((candidate) => candidate.status === "starting" || candidate.setup.status === "running")
                    ? "animate-pulse bg-amber-500"
                    : chatVms.some((candidate) => candidate.status === "running")
                      ? "bg-emerald-500"
                      : "bg-zinc-600"
                }`}
              />
              <LayoutGrid className="size-3.5" />
              <span className="hidden sm:inline">{chatVms.length} VMs</span>
            </Link>
          )}
          {(() => {
            if (!vm || chatVms.length > 1) return null
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
          {/* A sidekick's notifications: every message, or off (their page has "when they reach out" too). */}
          {character && (
            <button
              type="button"
              onClick={() => void stub.saveCharacter({ ...character, notify: (character.notify ?? "all") === "off" ? "all" : "off" })}
              title={
                (character.notify ?? "all") === "off"
                  ? `Notifications from ${character.name} are off. Tap to turn them on.`
                  : `Notifying you ${(character.notify ?? "all") === "all" ? "of every message" : "when they reach out"}. Tap to turn off.`
              }
              aria-pressed={(character.notify ?? "all") !== "off"}
              className={`shrink-0 rounded-md p-1.5 hover:bg-zinc-900 ${(character.notify ?? "all") === "off" ? "text-amber-400" : "text-zinc-500 hover:text-zinc-200"}`}
            >
              {(character.notify ?? "all") === "off" ? <BellOff className="size-4" /> : <Bell className="size-4" />}
            </button>
          )}
          {/* Only once some device has notifications on: mute this chat's. */}
          {session && !character && (state?.push.devices.length ?? 0) > 0 && (
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
          {character && (
            <button
              type="button"
              onClick={async () => {
                if (!(await ask({ title: `Start a new conversation with ${character.name}?`, body: "They keep their memory, and this one stays on their page.", confirm: "Start new", tone: "default" }))) return
                const next = await stub.restartCharacter(character.id)
                await navigate({ to: "/chat/$sessionId", params: { sessionId: next.sessionId } })
              }}
              title={`Start a new conversation with ${character.name}`}
              aria-label="Start over"
              className="shrink-0 rounded-md p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            >
              <RotateCcw className="size-4" />
            </button>
          )}
          {session && !character && !session.spaceId && (
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

      <ChatSecretsContext.Provider value={storeSecret}>
        <OpenUIHostContext.Provider value={uiHost}>
          <ChatArtifactsContext.Provider value={artifacts}>
            <SpaceSelectContext.Provider value={coordinating ? selectThread : null}>
              {!transcript.loaded ? (
                <ChatSkeleton />
              ) : coordinating && transcript.entries.length === 0 && pendingTexts.length === 0 && !transcript.running ? (
                <SpaceIntro
                  space={coordinating}
                  projectName={coordinating.projectId ? (state?.projects.find((candidate) => candidate.id === coordinating.projectId)?.name ?? null) : null}
                  onPick={(text) => setDraft({ text, key: Date.now() })}
                />
              ) : (
                <MessageList key={sessionId} transcript={transcript} onSend={send} pending={pendingTexts} speaker={speaker} />
              )}
            </SpaceSelectContext.Provider>
          </ChatArtifactsContext.Provider>
        </OpenUIHostContext.Provider>
      </ChatSecretsContext.Provider>

      <div className="mx-auto w-full max-w-3xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-4 md:pb-[max(1rem,env(safe-area-inset-bottom))]">
        {state && session && !connectedProviders(state)[providerOf(session.model)] && (
          <Link to="/settings" className="mb-2 flex items-center gap-2 text-xs text-amber-300 hover:underline">
            <KeyRound className="size-3.5" /> Connect {MODEL_PROVIDERS[providerOf(session.model)].name} to get answers, or pick another model
          </Link>
        )}
        {character && earlier && (
          <Link
            to="/chat/$sessionId"
            params={{ sessionId: character.sessionId }}
            className="mb-2 flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 hover:underline"
          >
            <History className="size-3.5" /> An earlier conversation with {character.name}. Go to the current one
          </Link>
        )}
        <QueuePanel sessionId={sessionId} items={transcript.queue} held={transcript.queueHeld} running={transcript.running} />
        <Composer
          autoFocus
          disabled={!connected}
          running={transcript.running}
          onSend={send}
          onStop={() => void stub.abort(sessionId)}
          draft={draft}
          placeholder={
            transcript.running ? "Queue a follow-up…" : coordinating ? `Tell ${coordinating.name} what to work on…` : `Message ${character?.name ?? "Dex"}, or / for skills…`
          }
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
      {/* Watch the VM while reading the chat: a floating button that opens a movable live preview. */}
      {vm && (vm.status === "running" || vm.status === "starting") && <VmPreview key={sessionId} vm={vm} />}
      </div>
      {panelOpen && coordinating && spaceOf && !filesOpen && (
        <SpacePanel
          key={sessionId}
          space={coordinating}
          threads={spaceOf.threads}
          selected={panel?.thread ?? null}
          onSelect={(thread) => setPanel({ sessionId, thread })}
          onClose={() => setPanel(null)}
          coordinatorRunning={transcript.running}
        />
      )}
      {filesOpen && (
        <Suspense fallback={<aside aria-label="Loading VM files" className="absolute inset-0 z-20 flex min-h-0 flex-col border-l border-zinc-800 bg-zinc-950 xl:relative xl:inset-auto xl:w-[55%] xl:shrink-0"><div className="flex h-12 shrink-0 items-center border-b border-zinc-800 px-3 text-sm">Files<button type="button" onClick={closeFiles} aria-label="Close files" className="ml-auto rounded p-2 text-zinc-400"><X className="size-4" /></button></div><VmFilesSkeleton /></aside>}>
          <VmFilesPanel key={sessionId} sessionId={sessionId} running={transcript.running} onClose={closeFiles} />
        </Suspense>
      )}
    </div>
  )
}
