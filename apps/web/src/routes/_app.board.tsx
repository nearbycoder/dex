import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowDown, ArrowUp, Check, LayoutDashboard, MessageSquare, PencilLine, PinOff, X } from "lucide-react"
import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { BoardSkeleton } from "~/client/components/skeleton"
import { Page } from "~/client/components/ui"
import { ChatSecretsContext } from "~/client/lib/chat-secrets"
import { useDex } from "~/client/lib/dex"
import { type OpenUIHost, OpenUIHostContext } from "~/client/lib/openui-host"
import { type Pin, pinScope } from "~/shared/board"

const OpenUIBlock = lazy(() => import("~/client/components/openui-block"))

export const Route = createFileRoute("/_app/board")({ component: BoardPage })

/** Generated UIs pinned from chats, as live panels: their data refreshes on its own and their buttons work here. */
function BoardPage() {
  const { state, stub, connected } = useDex()
  const [pins, setPins] = useState<Pin[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The synced state lists the panels; their programs load when that list changes.
  const version = state?.pins?.map((pin) => `${pin.id}:${pin.position}:${pin.updatedAt}`).join(",")
  useEffect(() => {
    if (!connected || version === undefined) return
    let current = true
    stub
      .boardPins()
      .then((list) => {
        if (current) setPins(list)
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      current = false
    }
  }, [stub, connected, version])

  if (error && !pins) return <Page title="Board"><p className="text-sm text-red-400">{error}</p></Page>
  if (!state || !pins) return <BoardSkeleton />

  return (
    <Page
      title="Board"
      width="max-w-5xl"
      info="Generated UIs you pinned from chats, as live panels: their data stays current and their buttons work here. Pin one with “Pin to board” under any card in a chat."
    >
      {pins.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-800 px-6 py-12 text-center">
          <LayoutDashboard className="size-6 text-zinc-600" />
          <p className="text-sm text-zinc-300">Nothing pinned yet</p>
          <p className="max-w-sm text-xs text-zinc-500">
            Ask a chat for a live view (your VMs, usage, a repo's status…), then press “Pin to board” under it to keep it here.
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {pins.map((pin, index) => (
            <BoardPanel key={pin.id} pin={pin} index={index} last={index === pins.length - 1} />
          ))}
        </div>
      )}
    </Page>
  )
}

function BoardPanel({ pin, index, last }: { pin: Pin; index: number; last: boolean }) {
  const { state, stub } = useDex()
  const chat = pin.sessionId ? state?.sessions.find((session) => session.id === pin.sessionId) : undefined
  const scope = pinScope(pin.id)
  const [states, setStates] = useState<Record<string, unknown> | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [unpinning, setUnpinning] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    stub
      .uiStates(scope)
      .catch(() => ({}))
      .then((saved) => {
        if (current) setStates(saved)
      })
    return () => {
      current = false
    }
  }, [stub, scope])

  const host = useMemo<OpenUIHost>(
    () => ({
      scope,
      run: (name, args, options) => stub.runUiOperation(scope, name, args, options),
      states,
      saveState: (card, value) => void stub.saveUiState(scope, card, value).catch(() => undefined)
    }),
    [stub, scope, states]
  )
  // Password fields and @ToAssistant buttons need the chat it came from.
  const storeSecret = useMemo(
    () => (chat ? (field: string, value: string) => stub.storeChatSecret(chat.id, field, value) : null),
    [stub, chat?.id]
  )
  const send = useMemo(
    () =>
      chat
        ? (text: string) => {
            setSent(true)
            void stub.sendMessage(chat.id, text).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
          }
        : undefined,
    [stub, chat?.id]
  )

  const act = async (work: () => Promise<unknown>) => {
    setError(null)
    try {
      await work()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const rename = async () => {
    const title = renaming?.trim()
    setRenaming(null)
    if (title && title !== pin.title) await act(() => stub.updatePin(pin.id, { title }))
  }

  return (
    <section className="min-w-0 rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3">
      <div className="flex min-h-8 items-center gap-1.5">
        {renaming !== null ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              void rename()
            }}
          >
            <input
              autoFocus
              value={renaming}
              maxLength={80}
              onChange={(event) => setRenaming(event.target.value)}
              onKeyDown={(event) => event.key === "Escape" && setRenaming(null)}
              className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            />
            <button type="submit" title="Save" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
              <Check className="size-4" />
            </button>
          </form>
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200" title={pin.title}>
            {pin.title}
          </h2>
        )}
        {renaming === null && (
          <div className="flex shrink-0 items-center text-zinc-500">
            {chat && (
              <Link
                to="/chat/$sessionId"
                params={{ sessionId: chat.id }}
                title={`From “${chat.title}”`}
                className="rounded-md p-1.5 hover:bg-zinc-900 hover:text-zinc-200"
              >
                <MessageSquare className="size-3.5" />
              </Link>
            )}
            <button type="button" title="Rename" onClick={() => setRenaming(pin.title)} className="rounded-md p-1.5 hover:bg-zinc-900 hover:text-zinc-200">
              <PencilLine className="size-3.5" />
            </button>
            <button
              type="button"
              title="Move earlier"
              disabled={index === 0}
              onClick={() => void act(() => stub.updatePin(pin.id, { position: index - 1 }))}
              className="rounded-md p-1.5 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-30"
            >
              <ArrowUp className="size-3.5" />
            </button>
            <button
              type="button"
              title="Move later"
              disabled={last}
              onClick={() => void act(() => stub.updatePin(pin.id, { position: index + 1 }))}
              className="rounded-md p-1.5 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-30"
            >
              <ArrowDown className="size-3.5" />
            </button>
            {unpinning ? (
              <span className="flex items-center gap-0.5 pl-1 text-xs">
                <button type="button" onClick={() => void act(() => stub.unpin(pin.id))} className="rounded-md px-1.5 py-1 text-red-300 hover:bg-red-950/50">
                  Unpin
                </button>
                <button type="button" title="Keep it" onClick={() => setUnpinning(false)} className="rounded-md p-1 hover:bg-zinc-900 hover:text-zinc-200">
                  <X className="size-3.5" />
                </button>
              </span>
            ) : (
              <button type="button" title="Unpin" onClick={() => setUnpinning(true)} className="rounded-md p-1.5 hover:bg-zinc-900 hover:text-zinc-200">
                <PinOff className="size-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      <ChatSecretsContext.Provider value={storeSecret}>
        <OpenUIHostContext.Provider value={host}>
          <Suspense fallback={<div className="my-3 h-24 animate-pulse rounded-xl bg-zinc-900" />}>
            {/* A changed program (app_update_pin) starts fresh. */}
            <OpenUIBlock key={pin.code} code={pin.code} streaming={false} card="main" onSend={send} />
          </Suspense>
        </OpenUIHostContext.Provider>
      </ChatSecretsContext.Provider>
      {sent && chat && (
        <p className="px-1 text-xs text-zinc-500">
          Sent to{" "}
          <Link to="/chat/$sessionId" params={{ sessionId: chat.id }} className="text-zinc-300 underline-offset-2 hover:underline">
            {chat.title}
          </Link>
          .
        </p>
      )}
      {error && <p className="px-1 text-xs text-red-400">{error}</p>}
    </section>
  )
}
