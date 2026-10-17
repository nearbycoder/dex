import { createFileRoute, Link } from "@tanstack/react-router"
import { Check, KeyRound, Monitor, Pencil } from "lucide-react"
import { useState } from "react"
import { Composer } from "~/client/components/composer"
import { MessageList } from "~/client/components/message-list"
import { ModelPicker } from "~/client/components/model-picker"
import { useDex, useTranscript } from "~/client/lib/dex"
import { MenuButton } from "~/client/lib/mobile-nav"

export const Route = createFileRoute("/_app/chat/$sessionId")({ component: Chat })

function Chat() {
  const { sessionId } = Route.useParams()
  const { state, stub, connected } = useDex()
  const transcript = useTranscript(sessionId)
  const session = state?.sessions.find((candidate) => candidate.id === sessionId)
  const [editing, setEditing] = useState<string | null>(null)

  const send = (text: string) => void stub.sendMessage(sessionId, text)

  if (state && !session) {
    return <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">This chat no longer exists.</div>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="dex-chrome flex h-12 shrink-0 items-center gap-3 border-b border-zinc-900 px-4">
        <MenuButton />
        {editing === null ? (
          <button type="button" onClick={() => setEditing(session?.title ?? "")} className="group flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{session?.title ?? "…"}</span>
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
        {state?.vm.configured && state.vm.status !== "none" && (
          <Link
            to="/machine"
            title="Watch or take over the VM"
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            <span className={`size-1.5 rounded-full ${state.vm.status === "running" ? "bg-emerald-500" : "bg-zinc-600"}`} />
            <Monitor className="size-3.5" />
            <span className="hidden sm:inline">Machine</span>
          </Link>
        )}
      </header>

      <MessageList transcript={transcript} onSend={send} />

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
              <ModelPicker
                model={session.model}
                thinking={session.thinking}
                onChange={(value) => void stub.configureSession(sessionId, value)}
              />
            )
          }
        />
      </div>
    </div>
  )
}
