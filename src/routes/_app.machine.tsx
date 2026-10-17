import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Bot,
  ChevronRight,
  Cpu,
  ExternalLink,
  Eye,
  Hand,
  LoaderCircle,
  MonitorPlay,
  Play,
  RefreshCw,
  Square,
  SquareTerminal,
  Trash2,
  User
} from "lucide-react"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import { MenuButton } from "~/client/lib/mobile-nav"
import { VM_SIZES, type VmActivity, type VmSize, type VmStatus } from "~/shared/protocol"

export const Route = createFileRoute("/_app/machine")({ component: MachinePage })

const statusStyle: Record<VmStatus, { label: string; dot: string }> = {
  none: { label: "No VM yet", dot: "bg-zinc-600" },
  starting: { label: "Starting", dot: "animate-pulse bg-amber-500" },
  running: { label: "Running", dot: "bg-emerald-500" },
  stopping: { label: "Stopping", dot: "animate-pulse bg-amber-500" },
  stopped: { label: "Stopped · disk saved", dot: "bg-zinc-500" },
  error: { label: "Error", dot: "bg-red-500" }
}

const MAX_OUTPUT = 64_000

/** The VM activity log, kept live from the agent's broadcasts. */
function useVmActivity() {
  const { stub, listen, connected } = useDex()
  const [items, setItems] = useState<VmActivity[]>([])

  useEffect(() => {
    if (!connected) return
    void stub.vmActivity(150).then(setItems)
  }, [connected, stub])

  useEffect(
    () =>
      listen((message) => {
        if (message.type === "dex.vm.activity") {
          setItems((current) => {
            const index = current.findIndex((item) => item.id === message.activity.id)
            if (index === -1) return [...current.slice(-299), message.activity]
            const next = [...current]
            next[index] = message.activity
            return next
          })
        } else if (message.type === "dex.vm.output") {
          setItems((current) =>
            current.map((item) => (item.id === message.id ? { ...item, output: (item.output + message.data).slice(-MAX_OUTPUT) } : item))
          )
        }
      }),
    [listen]
  )

  return items
}

function ActorBadge({ actor }: { actor: VmActivity["actor"] }) {
  if (actor === "agent") {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-600/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
        <Bot className="size-3" /> Dex
      </span>
    )
  }
  if (actor === "user") {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded bg-sky-600/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
        <User className="size-3" /> You
      </span>
    )
  }
  return <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">VM</span>
}

function ActivityItem({ item, defaultOpen }: { item: VmActivity; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const running = item.status === "running"
  useEffect(() => {
    if (running) setOpen(true)
  }, [running])
  const hasOutput = item.output.trim().length > 0

  return (
    <div className="border-b border-zinc-900 px-3 py-2 text-xs">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 text-left">
        <ChevronRight className={`size-3 shrink-0 text-zinc-600 transition-transform ${open ? "rotate-90" : ""} ${hasOutput ? "" : "invisible"}`} />
        <ActorBadge actor={item.actor} />
        <span className={`min-w-0 flex-1 truncate font-mono ${item.kind === "lifecycle" ? "text-zinc-400" : "text-zinc-200"}`}>{item.title}</span>
        {running ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-zinc-500" />
        ) : item.status === "error" ? (
          <span className="shrink-0 text-red-400">{item.exitCode !== null ? `exit ${item.exitCode}` : "failed"}</span>
        ) : (
          <span className="shrink-0 text-zinc-600">{timeAgo(item.at)}</span>
        )}
      </button>
      {open && hasOutput && (
        <pre
          className={`scrollbar-thin mt-1.5 ml-5 max-h-72 overflow-auto rounded bg-zinc-950 p-2 font-mono whitespace-pre-wrap ${
            item.status === "error" ? "text-red-300" : "text-zinc-300"
          }`}
        >
          {item.output}
        </pre>
      )}
    </div>
  )
}

function Panel({ title, actions, children, className = "" }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 ${className}`}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-800 px-3 text-xs">
        {title}
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </div>
      {children}
    </section>
  )
}

const iconButton = "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"

function Desktop({ running }: { running: boolean }) {
  const { stub } = useDex()
  const [mode, setMode] = useState<"stream" | "vnc">("stream")
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [control, setControl] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await stub.vmDesktopUrl(mode)
      setUrl(next)
      if (!next) setError("The desktop is still starting. Try again in a few seconds.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [mode, stub])

  useEffect(() => {
    if (running) void load()
    else setUrl(null)
  }, [running, load])

  return (
    <Panel
      className="lg:col-span-3"
      title={
        <>
          <MonitorPlay className="size-3.5 text-zinc-500" />
          <span className="font-medium text-zinc-300">Desktop</span>
        </>
      }
      actions={
        running && (
          <>
            <button
              type="button"
              onClick={() => setControl((value) => !value)}
              title={control ? "Your clicks and keys go to the VM" : "View only, so you don't disturb the agent"}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
                control ? "bg-sky-600 text-white hover:bg-sky-500" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              }`}
            >
              {control ? <Hand className="size-3.5" /> : <Eye className="size-3.5" />}
              {control ? "You have control" : "Take control"}
            </button>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as "stream" | "vnc")}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-300"
              title="Streaming mode"
            >
              <option value="stream">Stream</option>
              <option value="vnc">noVNC</option>
            </select>
            <button type="button" onClick={() => void load()} title="Reconnect" className={iconButton}>
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            {url && (
              <a href={url} target="_blank" rel="noreferrer" title="Open in a new tab" className={iconButton}>
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </>
        )
      }
    >
      <div className="relative aspect-video w-full bg-black">
        {running && url ? (
          <>
            <iframe
              key={url}
              src={url}
              title="VM desktop"
              allow="autoplay; clipboard-read; clipboard-write; fullscreen; keyboard-map"
              className="absolute inset-0 size-full border-0"
            />
            {!control && (
              <button
                type="button"
                onClick={() => setControl(true)}
                className="group absolute inset-0 flex items-end justify-center bg-transparent pb-4"
                title="Take control"
              >
                <span className="rounded-full bg-black/70 px-3 py-1.5 text-xs text-zinc-200 opacity-0 transition group-hover:opacity-100">
                  Watching · click to take control
                </span>
              </button>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-zinc-500">
            {loading ? <LoaderCircle className="size-5 animate-spin" /> : <MonitorPlay className="size-6" />}
            {running ? (error ?? "Connecting to the desktop…") : "The desktop appears here while the VM is running."}
            {mode === "vnc" && running && (
              <span className="text-xs text-zinc-600">If noVNC stays blank in your browser, use “Open in a new tab”.</span>
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}

function MachinePage() {
  const { state, stub, connected } = useDex()
  const activity = useVmActivity()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [command, setCommand] = useState("")
  const [port, setPort] = useState("")
  const [portUrl, setPortUrl] = useState<string | null>(null)
  const feedEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (connected) void stub.vmRefresh()
  }, [connected, stub])

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: "end" })
  }, [activity.length])

  if (!state) return <div className="p-8 text-sm text-zinc-500">Connecting to your agent…</div>
  const { vm, settings } = state
  const workingSessions = state.sessions.filter((session) => session.busy)
  const running = vm.status === "running"

  const act = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  if (!vm.configured) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader />
        <div className="mx-auto max-w-lg p-8 text-sm text-zinc-400">
          No VM provider is configured. Set the <code className="text-zinc-200">BOAT_API_KEY</code> secret to give Dex a boat.dev cloud VM.
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader>
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          <span className={`size-2 rounded-full ${statusStyle[vm.status].dot}`} />
          {statusStyle[vm.status].label}
          {vm.size && <span className="hidden text-zinc-600 sm:inline">· {vm.size}</span>}
          {running && vm.archiveAfter && <span className="hidden text-zinc-600 sm:inline">· idles out {timeAgo(Date.parse(vm.archiveAfter))}</span>}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {(vm.status === "none" || vm.status === "stopped" || vm.status === "error") && (
            <button type="button" disabled={busy !== null} onClick={() => act("start", () => stub.vmStart())} className={iconButton}>
              {busy === "start" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {vm.status === "stopped" ? "Resume" : "Start"}
            </button>
          )}
          {running && (
            <button type="button" disabled={busy !== null} onClick={() => act("stop", () => stub.vmStop())} className={iconButton}>
              {busy === "stop" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
              Stop
            </button>
          )}
          {vm.id && (
            <button
              type="button"
              disabled={busy !== null}
              title="Delete the VM and its disk"
              onClick={() => {
                if (confirm("Delete the VM and everything on its disk? This cannot be undone.")) void act("delete", () => stub.vmDestroy())
              }}
              className={`${iconButton} hover:text-red-400`}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
          <button type="button" onClick={() => act("refresh", () => stub.vmRefresh())} title="Refresh" className={iconButton}>
            <RefreshCw className={`size-3.5 ${busy === "refresh" ? "animate-spin" : ""}`} />
          </button>
        </div>
      </PageHeader>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
        {workingSessions.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-sm">
            <Bot className="size-4 text-emerald-400" />
            <span className="text-emerald-200">Dex is working</span>
            {workingSessions.map((session) => (
              <span key={session.id} className="flex items-center gap-1">
                <Link to="/chat/$sessionId" params={{ sessionId: session.id }} className="max-w-56 truncate text-emerald-300 underline-offset-2 hover:underline">
                  “{session.title}”
                </Link>
                <button
                  type="button"
                  onClick={() => void stub.abort(session.id)}
                  className="flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-0.5 text-xs text-zinc-200 hover:bg-red-950 hover:text-red-300"
                  title="Stop the agent so you can take over"
                >
                  <Square className="size-3 fill-current" /> Stop
                </button>
              </span>
            ))}
          </div>
        )}
        {(error || vm.error) && <p className="mb-3 rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-300">{error ?? vm.error}</p>}

        <div className="grid gap-3 lg:grid-cols-5 lg:items-start">
          <Desktop running={running} />

          <Panel
            className="h-[28rem] lg:col-span-2 lg:h-[34rem]"
            title={
              <>
                <SquareTerminal className="size-3.5 text-zinc-500" />
                <span className="font-medium text-zinc-300">Activity</span>
                <span className="text-zinc-600">commands by Dex and you</span>
              </>
            }
          >
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
              {activity.length === 0 && <p className="p-4 text-xs text-zinc-600">Nothing yet. Ask Dex to use its VM, or run a command below.</p>}
              {activity.map((item, index) => (
                <ActivityItem key={item.id} item={item} defaultOpen={index === activity.length - 1} />
              ))}
              <div ref={feedEnd} />
            </div>
            <form
              className="flex items-center gap-2 border-t border-zinc-800 px-3 py-2"
              onSubmit={(event) => {
                event.preventDefault()
                const value = command.trim()
                if (!value) return
                setCommand("")
                void act("run", () => stub.vmRun(value))
              }}
            >
              <span className="font-mono text-xs text-sky-400">$</span>
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                disabled={!connected}
                placeholder={running ? "Run a command on the VM" : "Run a command (starts the VM)"}
                className="min-w-0 flex-1 bg-transparent font-mono text-base text-zinc-200 placeholder:text-zinc-600 focus:outline-none md:text-xs"
              />
              {busy === "run" && <LoaderCircle className="size-3.5 animate-spin text-zinc-500" />}
            </form>
          </Panel>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Panel
            title={
              <>
                <ExternalLink className="size-3.5 text-zinc-500" />
                <span className="font-medium text-zinc-300">Open a port</span>
              </>
            }
          >
            <form
              className="flex flex-wrap items-center gap-2 p-3"
              onSubmit={(event) => {
                event.preventDefault()
                const value = Number(port)
                if (!Number.isInteger(value) || value < 1 || value > 65535) return
                void act("port", async () => setPortUrl(await stub.vmExposePort(value, false)))
              }}
            >
              <input
                value={port}
                onChange={(event) => setPort(event.target.value)}
                inputMode="numeric"
                placeholder="3000"
                className="w-24 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-base md:text-sm"
              />
              <button type="submit" disabled={!port} className="rounded-md bg-zinc-800 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-40">
                Get URL
              </button>
              {portUrl && (
                <a href={portUrl} target="_blank" rel="noreferrer" className="w-full truncate text-xs text-emerald-400 hover:underline">
                  {portUrl.replace(/\?_token=.*/, "")} ↗
                </a>
              )}
            </form>
          </Panel>

          <Panel
            title={
              <>
                <Cpu className="size-3.5 text-zinc-500" />
                <span className="font-medium text-zinc-300">VM settings</span>
                <span className="text-zinc-600">apply on next start</span>
              </>
            }
          >
            <div className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <select
                value={settings.vmSize}
                onChange={(event) => void stub.updateSettings({ vmSize: event.target.value as VmSize })}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm"
              >
                {VM_SIZES.map((size) => (
                  <option key={size.id} value={size.id}>
                    {size.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-zinc-400">
                Idle stop after
                <select
                  value={settings.vmMinutes}
                  onChange={(event) => void stub.updateSettings({ vmMinutes: Number(event.target.value) })}
                  className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-zinc-200"
                >
                  {[15, 30, 60, 120].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} min
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function PageHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-900 px-4">
      <MenuButton />
      <span className="text-sm font-medium">Machine</span>
      {children}
    </header>
  )
}
