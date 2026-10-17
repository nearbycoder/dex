import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  Hand,
  MessageSquare,
  Wrench,
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
import { AgentAvatar } from "~/client/components/agent-avatar"
import { Collapse } from "~/client/components/collapse"
import { Lines, PageSkeleton } from "~/client/components/skeleton"
import { idleText, useNow, useVmLabel, VM_STATUS } from "~/client/components/vm-status"
import { useCachedFetch } from "~/client/lib/cache"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import { MenuButton } from "~/client/lib/mobile-nav"
import { noVm, type VmActivity } from "~/shared/protocol"

/** One VM: its live desktop, activity, terminal, and ports. `vmKey` is the chat id, or `shared`. */
export const Route = createFileRoute("/_app/machine/$vmKey")({ component: MachinePage })

const MAX_OUTPUT = 64_000

/** One VM's activity log, kept live from the agent's broadcasts. */
function useVmActivity(vmKey: string | null) {
  const { stub, listen, connected } = useDex()
  const load = useCallback(() => (vmKey ? stub.vmActivity(vmKey, 150) : Promise.resolve([])) as Promise<VmActivity[]>, [stub, vmKey])
  const { data: items, setData } = useCachedFetch(vmKey && `vm-activity:${vmKey}`, load, connected && vmKey !== null)
  const setItems = (update: (current: VmActivity[]) => VmActivity[]) => setData((current) => update(current ?? []))

  useEffect(
    () =>
      listen((message) => {
        if ((message.type === "dex.vm.activity" || message.type === "dex.vm.output") && message.vmKey !== vmKey) return
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
    [listen, vmKey, setData]
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
        <span className={`min-w-0 flex-1 truncate ${item.kind === "lifecycle" || item.kind === "screenshot" ? "text-zinc-400" : "font-mono text-zinc-200"}`}>{item.title}</span>
        {running ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-zinc-500" />
        ) : item.status === "error" ? (
          <span className="shrink-0 text-red-400">{item.exitCode !== null ? `exit ${item.exitCode}` : "failed"}</span>
        ) : (
          <span className="shrink-0 text-zinc-600">{timeAgo(item.at)}</span>
        )}
      </button>
      <Collapse open={open && hasOutput}>
        <pre
          className={`scrollbar-thin mt-1.5 ml-5 max-h-72 overflow-auto rounded bg-zinc-950 p-2 font-mono whitespace-pre-wrap ${
            item.status === "error" ? "text-red-300" : "text-zinc-300"
          }`}
        >
          {item.output}
        </pre>
      </Collapse>
    </div>
  )
}

function Panel({ title, actions, children, className = "" }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 ${className}`}>
      <div className="flex h-10 shrink-0 items-center gap-2 overflow-hidden border-b border-zinc-800 px-3 text-xs whitespace-nowrap">
        {title}
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </div>
      {children}
    </section>
  )
}

const iconButton = "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"

/**
 * boat's Stream player needs MediaStreamTrackGenerator (Chromium only) and hangs elsewhere, notably on
 * iPhone/iPad where every browser is WebKit. Those get noVNC, which runs anywhere.
 */
const streamSupported = () => typeof window !== "undefined" && "MediaStreamTrackGenerator" in window

function Desktop({ vmKey, running }: { vmKey: string; running: boolean }) {
  const { stub } = useDex()
  const [mode, setMode] = useState<"stream" | "vnc">(() => (streamSupported() ? "stream" : "vnc"))
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [control, setControl] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await stub.vmDesktopUrl(vmKey, mode)
      setUrl(next)
      if (!next) setError("The desktop is still starting. Try again in a few seconds.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [mode, stub, vmKey])

  useEffect(() => {
    if (running) void load()
    else setUrl(null)
  }, [running, load])

  // Using the desktop counts as activity, so the VM does not idle-stop under you.
  useEffect(() => {
    if (!running || !control) return
    void stub.vmTouch(vmKey)
    const heartbeat = setInterval(() => void stub.vmTouch(vmKey), 30_000)
    return () => clearInterval(heartbeat)
  }, [running, control, stub, vmKey])

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
              <option value="stream" disabled={!streamSupported()}>
                Stream{streamSupported() ? "" : " (Chrome only)"}
              </option>
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
                data-no-press
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
            {mode === "stream" && running && (
              <span className="text-xs text-zinc-600">If the stream stays on “Connecting”, switch to noVNC.</span>
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}

function MachinePage() {
  const { state, stub, connected } = useDex()
  const { vmKey } = Route.useParams()
  const label = useVmLabel()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [command, setCommand] = useState("")
  const [port, setPort] = useState("")
  const [portUrl, setPortUrl] = useState<string | null>(null)
  const feedEnd = useRef<HTMLDivElement>(null)
  const now = useNow(15_000)

  const vms = state?.vms ?? []
  // A chat that hasn't needed a VM yet shows as "No VM yet", with Start.
  const known = vms.some((candidate) => candidate.key === vmKey) || state?.sessions.some((session) => session.id === vmKey)
  const selectedKey = known ? vmKey : null
  const vm = selectedKey ? (vms.find((candidate) => candidate.key === selectedKey) ?? noVm(selectedKey)) : null
  const activity = useVmActivity(selectedKey)

  useEffect(() => {
    setPortUrl(null)
    setError(null)
    if (connected && selectedKey && vms.some((candidate) => candidate.key === selectedKey)) void stub.vmRefresh(selectedKey).catch(() => undefined)
  }, [connected, stub, selectedKey])

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: "end" })
  }, [activity?.length])

  if (!state) return <PageSkeleton variant="sections" />
  const { settings } = state
  const running = vm?.status === "running"

  const act = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  if (!state.vmConfigured) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader />
        <div className="mx-auto max-w-lg p-8 text-sm text-zinc-400">
          No VM provider is configured. Set the <code className="text-zinc-200">BOAT_API_KEY</code> secret to give Dex boat.dev cloud VMs.
        </div>
      </div>
    )
  }

  if (!vm || !selectedKey) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader />
        <div className="mx-auto max-w-md p-8 text-center text-sm leading-relaxed text-zinc-400">
          <MonitorPlay className="mx-auto mb-3 size-8 text-zinc-600" />
          This VM no longer exists.{" "}
          <Link to="/machine" className="text-emerald-400 hover:underline">
            See all machines
          </Link>
        </div>
      </div>
    )
  }

  const info = label(vm.key)
  const session = state.sessions.find((candidate) => candidate.id === vm.key)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader>
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-zinc-400">
          <span className={`size-2 shrink-0 rounded-full ${VM_STATUS[vm.status].dot}`} />
          <span className="hidden truncate sm:inline">{VM_STATUS[vm.status].label}</span>
          {vm.size && <span className="hidden text-zinc-600 sm:inline">· {vm.size}</span>}
          {running && <span className="hidden text-zinc-600 sm:inline">· {idleText(vm, settings.vmMinutes, now)}</span>}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
          {(vm.status === "none" || vm.status === "stopped" || vm.status === "error") && (
            <button type="button" disabled={busy !== null} onClick={() => act("start", () => stub.vmStart(vm.key))} className={iconButton}>
              {busy === "start" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {vm.status === "stopped" ? "Resume" : "Start"}
            </button>
          )}
          {running && (
            <button type="button" disabled={busy !== null} onClick={() => act("stop", () => stub.vmStop(vm.key))} className={iconButton}>
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
                if (confirm(`Delete the VM of “${info.title}” and everything on its disk? This cannot be undone.`)) void act("delete", () => stub.vmDestroy(vm.key))
              }}
              className={`${iconButton} hover:text-red-400`}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => act("refresh", () => stub.vmRefresh(vm.key))}
            title="Refresh"
            className={iconButton}
          >
            <RefreshCw className={`size-3.5 ${busy === "refresh" ? "animate-spin" : ""}`} />
          </button>
        </div>
      </PageHeader>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:p-4 md:pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="min-w-0 truncate font-medium text-zinc-200">{info.title}</span>
          <span className="flex items-center gap-1.5 text-xs text-zinc-400 sm:hidden">
            <span className={`size-2 rounded-full ${VM_STATUS[vm.status].dot}`} />
            {VM_STATUS[vm.status].label}
          </span>
          {info.subtitle && <span className="text-xs text-zinc-500">{info.subtitle}</span>}
          {info.project && (
            <Link to="/projects/$projectId" params={{ projectId: info.project.id }} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200">
              <AgentAvatar icon={info.project.icon} color={info.project.color} size={16} /> {info.project.name}
            </Link>
          )}
          {session && (
            <Link to="/chat/$sessionId" params={{ sessionId: session.id }} className="flex items-center gap-1 text-xs text-emerald-400 hover:underline">
              <MessageSquare className="size-3.5" /> Open chat
            </Link>
          )}
          {session?.busy && (
            <button
              type="button"
              onClick={() => void stub.abort(session.id)}
              className="flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-0.5 text-xs text-zinc-200 hover:bg-red-950 hover:text-red-300"
              title="Stop the agent so you can take over"
            >
              <Square className="size-3 fill-current" /> Stop Dex
            </button>
          )}
        </div>

        {vm.setup.status === "running" && (
          <div className="mb-3 flex animate-rise items-center gap-2 rounded-xl border border-sky-900/60 bg-sky-950/30 px-3 py-2 text-sm text-sky-200">
            <LoaderCircle className="size-4 shrink-0 animate-spin" />
            <span className="min-w-0">Setting up: {vm.setup.step ?? "preparing"}…</span>
          </div>
        )}
        {vm.setup.status === "error" && (
          <div className="mb-3 flex animate-rise flex-wrap items-center gap-2 rounded-xl border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
            <Wrench className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 break-words">
              Setup failed{vm.setup.step ? ` at “${vm.setup.step}”` : ""}: {vm.setup.error}
            </span>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act("setup", () => stub.vmRerunSetup(vm.key))}
              className="flex items-center gap-1.5 rounded-md bg-amber-900/50 px-2 py-1 text-xs text-amber-100 hover:bg-amber-900"
            >
              {busy === "setup" ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Re-run setup
            </button>
          </div>
        )}
        {(error || vm.error) && <p className="mb-3 rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-300">{error ?? vm.error}</p>}

        <div key={vm.key} className="dex-machine-grid grid animate-fade gap-3 lg:grid-cols-5 lg:items-start">
          <Desktop key={vm.key} vmKey={vm.key} running={running} />

          <Panel
            className="h-[28rem] lg:col-span-2 lg:h-[34rem]"
            title={
              <>
                <SquareTerminal className="size-3.5 text-zinc-500" />
                <span className="font-medium text-zinc-300">Activity</span>
              </>
            }
          >
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
              {!activity && (
                <div className="space-y-3 p-4">
                  <Lines count={4} />
                </div>
              )}
              {activity?.length === 0 && <p className="p-4 text-xs text-zinc-600">No activity yet.</p>}
              {activity?.map((item, index) => (
                <ActivityItem key={item.id} item={item} defaultOpen={index === activity!.length - 1} />
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
                void act("run", () => stub.vmRun(vm.key, value))
              }}
            >
              <span className="font-mono text-xs text-sky-400">$</span>
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                disabled={!connected}
                placeholder={running ? "Run a command" : "Run a command (starts the VM)"}
                className="min-w-0 flex-1 bg-transparent font-mono text-base text-zinc-200 placeholder:text-zinc-600 focus:outline-none md:text-xs"
              />
              {busy === "run" && <LoaderCircle className="size-3.5 animate-spin text-zinc-500" />}
            </form>
          </Panel>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
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
                void act("port", async () => setPortUrl(await stub.vmExposePort(vm.key, value, false)))
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
        </div>
      </div>
    </div>
  )
}

function PageHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="dex-chrome dex-topbar flex h-12 shrink-0 items-center gap-2 border-b border-zinc-900 px-3 sm:gap-3 sm:px-4">
      <MenuButton />
      <Link to="/machine" className="-ml-1 flex shrink-0 items-center gap-0.5 rounded-md py-1 pr-1.5 pl-0.5 text-sm font-medium text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100" title="All machines">
        <ChevronLeft className="size-4" /> Machines
      </Link>
      {children}
    </header>
  )
}
