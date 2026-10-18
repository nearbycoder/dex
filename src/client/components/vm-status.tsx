import { useEffect, useState } from "react"
import { useDex } from "~/client/lib/dex"
import { MCP_VM, SHARED_VM, type VmInfo, type VmStatus } from "~/shared/protocol"

export const VM_STATUS: Record<VmStatus, { label: string; dot: string }> = {
  none: { label: "No VM yet", dot: "bg-zinc-600" },
  starting: { label: "Starting", dot: "animate-pulse bg-amber-500" },
  running: { label: "Running", dot: "bg-emerald-500" },
  stopping: { label: "Stopping", dot: "animate-pulse bg-amber-500" },
  stopped: { label: "Stopped · disk saved", dot: "bg-zinc-500" },
  error: { label: "Error", dot: "bg-red-500" }
}

export function VmStatusDot({ status, className = "" }: { status: VmStatus; className?: string }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${VM_STATUS[status].dot} ${className}`} title={VM_STATUS[status].label} />
}

/** A VM's chat (or the shared VM's label), with the chat's agent and project. */
export function useVmLabel() {
  const { state } = useDex()
  return (key: string) => {
    if (key === SHARED_VM) return { title: "Shared VM", subtitle: "Not linked to a chat (from before VMs were per chat)", agent: undefined, project: undefined }
    if (key === MCP_VM) return { title: "MCP servers", subtitle: "Runs your local MCP servers; starts when a chat uses one", agent: undefined, project: undefined }
    const session = state?.sessions.find((candidate) => candidate.id === key)
    return {
      title: session?.title ?? "Deleted chat",
      subtitle: null,
      agent: session?.agentId ? state?.agents.find((agent) => agent.id === session.agentId) : undefined,
      project: session?.projectId ? state?.projects.find((project) => project.id === session.projectId) : undefined
    }
  }
}

/** Running VMs first, then the most recently used. */
export const byRecentUse = (a: VmInfo, b: VmInfo) =>
  Number(b.status === "running") - Number(a.status === "running") || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)

/** Re-renders every `ms` so relative times stay fresh; `0` stops. */
export function useNow(ms: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    // 0 pauses it (nothing on screen is counting).
    if (ms <= 0) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

/** When a running VM will stop itself, as "stops when idle in 3 min". */
export const idleText = (vm: VmInfo, minutes: number, now: number) => {
  if (vm.busy) return "in use"
  const left = Math.ceil(((vm.lastActiveAt ?? now) + minutes * 60_000 - now) / 60_000)
  return left > 0 ? `stops when idle in ${left} min` : "idle, stopping any moment now"
}
