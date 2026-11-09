import { createFileRoute, Link } from "@tanstack/react-router"
import { Bot, ChevronLeft, LoaderCircle, Maximize, Minimize, Monitor, MonitorUp, Play, Plus, Square, Trash2, X } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ask } from "~/client/components/confirm-dialog"
import { MenuButton } from "~/client/lib/mobile-nav"
import { ControlPanelSkeleton } from "~/client/components/skeleton"
import { VM_STATUS } from "~/client/components/vm-status"
import { useDex } from "~/client/lib/dex"
import { useLatestActivity } from "~/client/lib/vm-activity"
import { savedDesktopMode, useDesktopUrl } from "~/client/lib/desktop"
import { chatOfVm, MAX_VMS_PER_CHAT, type VmInfo, vmKeyFor, vmNumber } from "~/shared/protocol"

/**
 * A chat's control panel: every one of its VMs (up to MAX_VMS_PER_CHAT) live at once, as tiles that fill the screen
 * (laid out so each desktop is as large as it can be), so you can watch an agent work several machines and browsers side by side. Fullscreen hides everything else;
 * a tile opens large on a click, and the Machine page is where you take control of one.
 */
export const Route = createFileRoute("/_app/control/$sessionId")({ component: ControlPanel })

/** The desktop page lays out at this size and is scaled with CSS (the players fit their picture once, on connect). */
const FRAME = { width: 960, height: 540 }
const GAP = 8
/** A tile's header row (h-8 and its border) above the desktop. */
const HEADER = 33
/** Below this desktop width, tiles stop shrinking to fit and the panel scrolls instead. */
const MIN_PICTURE = 180

/** An element's size, kept current. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}

/**
 * How many columns of tiles make each desktop largest when `count` share the area (each tile's desktop is 16:9 under
 * its header), and that desktop's width. The tiles then stretch to fill the area; their desktops keep their shape.
 */
const fit = (count: number, width: number, height: number) => {
  let best = { columns: 1, rows: 1, picture: 0 }
  for (let columns = 1; columns <= Math.max(1, count); columns++) {
    const rows = Math.ceil(count / columns)
    const cellWidth = (width - GAP * (columns - 1)) / columns
    const cellHeight = (height - GAP * (rows - 1)) / rows - HEADER
    const picture = Math.floor(Math.min(cellWidth, (cellHeight * FRAME.width) / FRAME.height))
    if (picture > best.picture) best = { columns, rows, picture }
  }
  return best
}

function ControlPanel() {
  const { state, stub } = useDex()
  const { sessionId } = Route.useParams()
  const root = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [area, areaSize] = useSize<HTMLDivElement>()

  const session = state?.sessions.find((candidate) => candidate.id === sessionId)
  const vms = (state?.vms ?? []).filter((vm) => chatOfVm(vm.key) === sessionId).sort((a, b) => vmNumber(a.key) - vmNumber(b.key))
  const latest = useLatestActivity(vms.map((vm) => vm.key))
  const running = vms.filter((vm) => vm.status === "running").length
  const focusedVm = focused ? vms.find((vm) => vm.key === focused) : undefined

  // Fullscreen: the browser's own where it has one for elements (not iPhone), and the panel covers the page either way.
  const toggleFullscreen = useCallback(async () => {
    if (fullscreen) {
      setFullscreen(false)
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
      return
    }
    setFullscreen(true)
    await root.current?.requestFullscreen?.().catch(() => undefined)
  }, [fullscreen])
  useEffect(() => {
    const left = () => {
      if (!document.fullscreenElement) setFullscreen(false)
    }
    document.addEventListener("fullscreenchange", left)
    return () => document.removeEventListener("fullscreenchange", left)
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (focused) setFocused(null)
      else if (fullscreen) void toggleFullscreen()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [focused, fullscreen, toggleFullscreen])

  const act = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  // The lowest free number, so a stopped-and-deleted VM's slot is reused.
  const taken = new Set(vms.map((vm) => vmNumber(vm.key)))
  const nextNumber = Array.from({ length: MAX_VMS_PER_CHAT }, (_, index) => index + 1).find((n) => !taken.has(n))
  const addVm = async () => {
    if (!nextNumber) return
    setAdding(true)
    await act(() => stub.vmStart(vmKeyFor(sessionId, nextNumber)))
    setAdding(false)
  }

  if (!state) return <ControlPanelSkeleton />
  if (!session) return <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">This chat no longer exists.</div>

  const layout = fit(vms.length, areaSize.width, areaSize.height)
  const fits = layout.picture >= MIN_PICTURE
  const iconButton = "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-40"

  return (
    <div ref={root} className={`flex min-h-0 flex-1 flex-col bg-zinc-950 ${fullscreen ? "fixed inset-0 z-50" : ""}`}>
      <header className="dex-chrome dex-topbar flex h-12 shrink-0 items-center gap-2 border-b border-zinc-900 px-3 sm:gap-3 sm:px-4">
        {!fullscreen && <MenuButton />}
        <Link
          to="/chat/$sessionId"
          params={{ sessionId }}
          title="Back to the chat"
          className="-ml-1 flex min-w-0 items-center gap-0.5 rounded-md py-1 pr-1.5 pl-0.5 text-sm font-medium text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
        >
          <ChevronLeft className="size-4 shrink-0" /> <span className="truncate">{session.title}</span>
        </Link>
        <span className="hidden shrink-0 text-xs text-zinc-500 sm:inline">
          {vms.length} of {MAX_VMS_PER_CHAT} VMs · {running} running
        </span>
        <div className="ml-auto flex items-center gap-1">
          {session.busy && <LoaderCircle className="size-3.5 animate-spin text-emerald-400" aria-label="The chat is working" />}
          <button type="button" disabled={!nextNumber || adding} onClick={() => void addVm()} title="Start another VM for this chat" className={iconButton}>
            {adding ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            <span className="hidden sm:inline">Add VM</span>
          </button>
          {running > 0 && (
            <button
              type="button"
              onClick={() => void act(() => Promise.all(vms.filter((vm) => vm.status === "running").map((vm) => stub.vmStop(vm.key))))}
              title="Stop every VM of this chat (disks are kept)"
              className={iconButton}
            >
              <Square className="size-3.5" /> <span className="hidden sm:inline">Stop all</span>
            </button>
          )}
          <button type="button" onClick={() => void toggleFullscreen()} title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"} className={iconButton}>
            {fullscreen ? <Minimize className="size-3.5" /> : <Maximize className="size-3.5" />}
            <span className="hidden sm:inline">{fullscreen ? "Exit" : "Fullscreen"}</span>
          </button>
        </div>
      </header>
      {error && <p className="border-b border-zinc-900 px-4 py-2 text-xs break-words text-red-400">{error}</p>}

      <div ref={area} className={`relative min-h-0 flex-1 p-2 ${fits || focusedVm ? "overflow-hidden" : "scrollbar-thin overflow-y-auto"}`}>
        {vms.length === 0 ? (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 p-6 text-center text-sm leading-relaxed text-zinc-400">
            <Monitor className="size-8 text-zinc-600" />
            <p>
              This chat has no VMs running yet. Ask it to work on several at once, like “check these five sites side by side”, and each VM shows up here
              live. It can run up to {MAX_VMS_PER_CHAT}.
            </p>
          </div>
        ) : focusedVm ? (
          <Tile vm={focusedVm} activity={latest[focusedVm.key]} large fill onToggle={() => setFocused(null)} onAct={act} />
        ) : (
          <ul
            className="grid"
            style={
              fits
                ? {
                    gap: GAP,
                    gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
                    height: "100%"
                  }
                : { gap: GAP, gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${MIN_PICTURE + 60}px), 1fr))` }
            }
          >
            {vms.map((vm) => (
              <li key={vm.key} className="min-h-0 min-w-0">
                <Tile vm={vm} activity={latest[vm.key]} fill={fits} onToggle={() => setFocused(vm.key)} onAct={act} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * One VM, live and watch-only: its number, status, and latest action, with start/stop and a way into its Machine page.
 * `fill` stretches it to its grid cell (the desktop fits inside); otherwise the desktop sets its height at 16:9.
 */
function Tile({
  vm,
  activity,
  large = false,
  fill = false,
  onToggle,
  onAct
}: {
  vm: VmInfo
  activity: string | undefined
  large?: boolean
  fill?: boolean
  onToggle: () => void
  onAct: (action: () => Promise<unknown>) => Promise<void>
}) {
  const { state, stub } = useDex()
  const [box, size] = useSize<HTMLDivElement>()
  const running = vm.status === "running"
  // A helper agent (vm_agents) working on this VM.
  const helper = state?.vmHelpers?.find((candidate) => candidate.chatId === chatOfVm(vm.key) && candidate.vm === vmNumber(vm.key) && candidate.status === "working")
  const { url, loading, error } = useDesktopUrl(vm.key, savedDesktopMode(), running)
  const n = vmNumber(vm.key)
  // The 16:9 desktop, as large as the tile's picture area allows, centered.
  const scale = size.width && size.height ? Math.min(size.width / FRAME.width, size.height / FRAME.height) : 0
  const canStart = vm.status === "stopped" || vm.status === "error" || vm.status === "none"
  const tileButton = "rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border bg-zinc-900 ${fill ? "h-full" : ""} ${vm.busy ? "border-emerald-700/70" : "border-zinc-800"}`}
    >
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-zinc-800 pr-1 pl-2.5">
        <span className={`size-1.5 shrink-0 rounded-full ${VM_STATUS[vm.status].dot}`} title={VM_STATUS[vm.status].label} />
        <span className="shrink-0 text-xs font-medium text-zinc-200">VM {n}</span>
        {helper && (
          <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-950/60 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300" title={`Helper: ${helper.task}`}>
            <Bot className="size-3" /> Helper
          </span>
        )}
        <span className="min-w-0 truncate text-[11px] text-zinc-500" title={activity ?? helper?.task}>
          {vm.busy ? (activity ?? "Working…") : helper ? helper.task : VM_STATUS[vm.status].label}
        </span>
        <div className="ml-auto flex shrink-0 items-center">
          {running && (
            <button type="button" onClick={() => void onAct(() => stub.vmStop(vm.key))} title="Stop this VM (disk is kept)" className={tileButton}>
              <Square className="size-3.5" />
            </button>
          )}
          {(vm.status === "stopped" || vm.status === "error") && !helper && (
            <button
              type="button"
              onClick={async () => {
                const body = `Deletes VM ${n} and everything on its disk. The chat gets a fresh one if it needs VM ${n} again.`
                if (await ask({ title: `Delete VM ${n}?`, body, confirm: "Delete" })) await onAct(() => stub.vmDestroy(vm.key))
              }}
              title="Delete this VM and its disk"
              className={`${tileButton} hover:text-red-400`}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
          <Link to="/machine/$vmKey" params={{ vmKey: vm.key }} title="Open its Machine page to take control" className={tileButton}>
            <MonitorUp className="size-3.5" />
          </Link>
          {large && (
            <button type="button" onClick={onToggle} title="Back to all VMs (Esc)" className={tileButton}>
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <div ref={box} className={`relative overflow-hidden bg-black ${fill ? "min-h-0 flex-1" : "aspect-video"}`}>
        {running && url && scale > 0 ? (
          <>
            <iframe
              key={url}
              // Dex's own desktop page (Selkies) has a watch-only view without its touch controls.
              src={url.startsWith("/vm-desktop/") ? `${url}?view=watch` : url}
              title={`VM ${n} desktop`}
              allow="autoplay"
              tabIndex={-1}
              style={{
                width: FRAME.width,
                height: FRAME.height,
                transform: `scale(${scale})`,
                transformOrigin: "0 0",
                left: (size.width - FRAME.width * scale) / 2,
                top: (size.height - FRAME.height * scale) / 2
              }}
              className="absolute border-0"
            />
            {/* Watch only: a click opens the VM large instead of reaching it. */}
            <button
              type="button"
              onClick={large ? undefined : onToggle}
              aria-label={large ? `VM ${n} desktop` : `Show VM ${n} large`}
              className={`absolute inset-0 ${large ? "cursor-default" : "cursor-zoom-in"}`}
            />
          </>
        ) : (
          <TileMessage>
            {loading || vm.status === "starting" || vm.status === "stopping" ? <LoaderCircle className="size-4 animate-spin" /> : <Monitor className="size-4" />}
            <span>{running ? (error ?? "Connecting to the desktop…") : vm.status === "starting" ? "Starting…" : VM_STATUS[vm.status].label}</span>
            {canStart && (
              <button
                type="button"
                onClick={() => void onAct(() => stub.vmStart(vm.key))}
                className="mt-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <Play className="size-3.5" /> {vm.status === "stopped" ? "Resume" : "Start"}
              </button>
            )}
          </TileMessage>
        )}
      </div>
    </div>
  )
}

function TileMessage({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center text-[11px] text-zinc-500">{children}</div>
}
