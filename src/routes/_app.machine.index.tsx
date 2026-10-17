import { createFileRoute, Link } from "@tanstack/react-router"
import { ChevronRight, Cpu, LoaderCircle, MessageSquare, Monitor, Play, RefreshCw, Square, Wrench } from "lucide-react"
import { useEffect, useState } from "react"
import { AgentAvatar } from "~/client/components/agent-avatar"
import { byRecentUse, idleText, useNow, useVmLabel, VM_STATUS, VmStatusDot } from "~/client/components/vm-status"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import { MenuButton } from "~/client/lib/mobile-nav"
import { VM_SIZES, type VmInfo, type VmSize } from "~/shared/protocol"

/** Every chat's VM at a glance; each opens its desktop, activity, and terminal. */
export const Route = createFileRoute("/_app/machine/")({ component: MachinesPage })

function MachineCard({ vm, index }: { vm: VmInfo; index: number }) {
  const { state, stub } = useDex()
  const label = useVmLabel()
  const now = useNow(15_000)
  const [busy, setBusy] = useState<"start" | "stop" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { title, subtitle, agent, project } = label(vm.key)
  const badge = project ?? agent
  const session = state?.sessions.find((candidate) => candidate.id === vm.key)
  const running = vm.status === "running"
  const canStart = vm.status === "stopped" || vm.status === "error" || vm.status === "none"

  const act = async (kind: "start" | "stop") => {
    setBusy(kind)
    setError(null)
    try {
      await (kind === "start" ? stub.vmStart(vm.key) : stub.vmStop(vm.key))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <li
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
      className="flex min-w-0 animate-rise flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40"
    >
      <Link to="/machine/$vmKey" params={{ vmKey: vm.key }} className="flex min-w-0 items-start gap-3 p-4 hover:bg-zinc-900/70">
        {badge ? (
          <AgentAvatar icon={badge.icon} color={badge.color} size={36} />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-zinc-800 text-zinc-400">
            <Monitor className="size-4.5" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-zinc-100">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-zinc-500">
            {subtitle ?? [project?.name, agent?.name].filter(Boolean).join(" · ")}
            {!subtitle && !project && !agent && "Chat"}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5 text-zinc-300">
              <VmStatusDot status={vm.status} />
              {VM_STATUS[vm.status].label}
            </span>
            {vm.size && <span className="text-zinc-600">{vm.size}</span>}
            <span className="text-zinc-500">
              {running ? idleText(vm, state?.settings.vmMinutes ?? 5, now) : vm.lastActiveAt ? `used ${timeAgo(vm.lastActiveAt)}` : null}
            </span>
          </span>
          {vm.setup.status === "running" && (
            <span className="mt-2 flex items-center gap-1.5 text-xs text-sky-300">
              <LoaderCircle className="size-3.5 animate-spin" /> Setting up: {vm.setup.step ?? "preparing"}
            </span>
          )}
          {vm.setup.status === "error" && (
            <span className="mt-2 flex items-center gap-1.5 text-xs text-amber-300">
              <Wrench className="size-3.5 shrink-0" /> <span className="truncate">Setup failed{vm.setup.step ? ` at ${vm.setup.step}` : ""}</span>
            </span>
          )}
        </span>
        <ChevronRight className="mt-2.5 size-4 shrink-0 text-zinc-600" />
      </Link>

      <div className="mt-auto flex items-center gap-1 border-t border-zinc-800/80 px-2 py-1.5">
        {running && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act("stop")}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
          >
            {busy === "stop" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Square className="size-3.5" />} Stop
          </button>
        )}
        {canStart && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act("start")}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
          >
            {busy === "start" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            {vm.status === "stopped" ? "Resume" : "Start"}
          </button>
        )}
        {session && (
          <Link
            to="/chat/$sessionId"
            params={{ sessionId: session.id }}
            className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <MessageSquare className="size-3.5" /> Open chat
          </Link>
        )}
      </div>
      {(error ?? vm.error) && <p className="border-t border-zinc-800/80 px-4 py-2 text-xs break-words text-red-400">{error ?? vm.error}</p>}
    </li>
  )
}

function MachinesPage() {
  const { state, stub, connected } = useDex()
  const [refreshing, setRefreshing] = useState(false)
  const vms = [...(state?.vms ?? [])].sort(byRecentUse)
  const running = vms.filter((vm) => vm.status === "running").length

  const refresh = async () => {
    setRefreshing(true)
    try {
      await Promise.all((state?.vms ?? []).map((vm) => stub.vmRefresh(vm.key).catch(() => undefined)))
    } finally {
      setRefreshing(false)
    }
  }

  // Statuses can change while the page was closed (boat's own auto-stop, for one).
  useEffect(() => {
    if (connected && state) void refresh()
  }, [connected, state === undefined])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="dex-chrome flex h-12 shrink-0 items-center gap-2 border-b border-zinc-900 px-3 sm:gap-3 sm:px-4">
        <MenuButton />
        <span className="shrink-0 text-sm font-medium">Machines</span>
        {vms.length > 0 && (
          <span className="truncate text-xs text-zinc-500">
            {running} running · {vms.length} total
          </span>
        )}
        <button type="button" onClick={() => void refresh()} title="Refresh" className="ml-auto rounded-md p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pt-8">
          {!state ? (
            <div className="p-8 text-sm text-zinc-500">Connecting to your agent…</div>
          ) : !state.vmConfigured ? (
            <p className="mx-auto max-w-lg p-8 text-sm text-zinc-400">
              No VM provider is configured. Set the <code className="text-zinc-200">BOAT_API_KEY</code> secret to give Dex boat.dev cloud VMs.
            </p>
          ) : (
            <>
              <p className="mb-4 text-sm text-zinc-400">
                Each chat gets its own VM the first time Dex needs one; project chats get theirs right away, with the repos cloned. A VM
                stops when idle and keeps its disk until its chat is deleted.
              </p>
              {vms.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center text-sm text-zinc-500">
                  <Monitor className="mx-auto mb-3 size-7 text-zinc-600" />
                  No VMs yet.
                </div>
              ) : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {vms.map((vm, index) => (
                    <MachineCard key={vm.key} vm={vm} index={index} />
                  ))}
                </ul>
              )}

              <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40">
                <div className="flex h-10 items-center gap-2 border-b border-zinc-800 px-3 text-xs">
                  <Cpu className="size-3.5 text-zinc-500" />
                  <span className="font-medium text-zinc-300">VM defaults</span>
                  <span className="truncate text-zinc-600">for new VMs; projects can pick a size</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <select
                    value={state.settings.vmSize}
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
                    Stop when idle for
                    <select
                      value={state.settings.vmMinutes}
                      onChange={(event) => void stub.updateSettings({ vmMinutes: Number(event.target.value) })}
                      className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-zinc-200"
                    >
                      {[5, 10, 15, 30, 60].map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes} min
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
