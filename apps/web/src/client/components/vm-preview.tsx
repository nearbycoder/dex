import { Link } from "@tanstack/react-router"
import { LoaderCircle, Maximize2, Minimize2, Minus, Monitor, MonitorUp } from "lucide-react"
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react"
import { savedDesktopMode, useDesktopUrl } from "~/client/lib/desktop"
import { haptic } from "~/client/lib/haptics"
import type { VmInfo } from "~/shared/protocol"

/**
 * A chat's VM, watchable while you read the chat: a small floating button that opens a picture-in-picture window of
 * the live desktop. Both can be dragged anywhere and stay where you leave them (on this device). The window is for
 * watching; "Open the Machine page" is where you take control. Closing it back to the button stops the stream.
 */

const OPEN_KEY = "dex-vm-preview-open"
const SIZE_KEY = "dex-vm-preview-large"
const POSITION_KEY = (what: "button" | "window") => `dex-vm-preview-${what}`
const MARGIN = 8
/** Below the top bar (48px plus the status bar), so its buttons stay reachable. */
const TOP = 56
const BUTTON = 48
/** Window widths; the desktop is 16:9 under a 32px title bar. */
const WIDTH = { small: 240, large: 360 }
const TITLE_BAR = 32

type Point = { x: number; y: number }

/** The status bar's height on an edge-to-edge phone (the app pads its top by it). */
const safeTop = () => Number.parseFloat(getComputedStyle(document.querySelector(".dex-app") ?? document.body).paddingTop) || 0

const viewport = () => ({ width: window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight })

const clamp = (point: Point, width: number, height: number): Point => {
  const { width: vw, height: vh } = viewport()
  return {
    x: Math.min(Math.max(MARGIN, point.x), Math.max(MARGIN, vw - width - MARGIN)),
    y: Math.min(Math.max(TOP + safeTop(), point.y), Math.max(TOP, vh - height - MARGIN))
  }
}

const savedPoint = (key: string): Point | null => {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as Point | null
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null
  } catch {
    return null
  }
}

/**
 * Drags a fixed-position box by pointer, kept inside the viewport and saved under `key`. `onTap` fires for a press
 * that didn't move (so the same element can be dragged and tapped).
 */
function useDrag(key: string, width: number, height: number, fallback: () => Point, onTap?: () => void) {
  const [point, setPoint] = useState<Point>(() => clamp(savedPoint(key) ?? fallback(), width, height))
  const drag = useRef<{ id: number; start: Point; origin: Point; moved: boolean } | null>(null)

  // Stay on screen when the box grows, the phone rotates, or the keyboard opens.
  useEffect(() => {
    const fit = () => setPoint((current) => clamp(current, width, height))
    fit()
    addEventListener("resize", fit)
    window.visualViewport?.addEventListener("resize", fit)
    return () => {
      removeEventListener("resize", fit)
      window.visualViewport?.removeEventListener("resize", fit)
    }
  }, [width, height])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      // Buttons inside the handle keep their own clicks.
      if ((event.target as Element).closest("button, a") !== event.currentTarget.closest("button, a")) return
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: point, moved: false }
    },
    [point]
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = drag.current
      if (!current || current.id !== event.pointerId) return
      const dx = event.clientX - current.start.x
      const dy = event.clientY - current.start.y
      if (!current.moved && Math.hypot(dx, dy) < 6) return
      current.moved = true
      setPoint(clamp({ x: current.origin.x + dx, y: current.origin.y + dy }, width, height))
    },
    [width, height]
  )

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = drag.current
      if (!current || current.id !== event.pointerId) return
      drag.current = null
      if (current.moved) setPoint((final) => (localStorage.setItem(key, JSON.stringify(final)), final))
      else onTap?.()
    },
    [key, onTap]
  )

  // The browser took the gesture over (or it was interrupted): keep where it got to, and it isn't a tap.
  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = drag.current
      if (!current || current.id !== event.pointerId) return
      drag.current = null
      if (current.moved) setPoint((final) => (localStorage.setItem(key, JSON.stringify(final)), final))
    },
    [key]
  )

  return {
    point,
    // Inline, so it beats styles.css giving every button `touch-action: manipulation` (unlayered CSS outranks
    // Tailwind's touch-none): otherwise iOS scrolls the page under the finger and cancels the drag.
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, style: { touchAction: "none" } as const }
  }
}

export function VmPreview({ vm }: { vm: VmInfo }) {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === "1")
  const toggle = (next: boolean) => {
    haptic()
    localStorage.setItem(OPEN_KEY, next ? "1" : "0")
    setOpen(next)
  }
  return open ? <PreviewWindow vm={vm} onClose={() => toggle(false)} /> : <PreviewButton vm={vm} onOpen={() => toggle(true)} />
}

/** Busy (the agent is using the VM, or it's starting): a pulsing amber dot. Idle and running: green. */
const dotClass = (vm: VmInfo) =>
  vm.busy || vm.status === "starting" || vm.setup.status === "running" ? "animate-pulse bg-amber-400" : "bg-emerald-400"

function PreviewButton({ vm, onOpen }: { vm: VmInfo; onOpen: () => void }) {
  const { point, handlers } = useDrag(
    POSITION_KEY("button"),
    BUTTON,
    BUTTON,
    () => ({ x: viewport().width - BUTTON - 12, y: viewport().height - BUTTON - 180 }),
    onOpen
  )
  return (
    <button
      type="button"
      {...handlers}
      title="Watch this chat's VM"
      aria-label="Watch this chat's VM"
      data-no-haptic
      data-no-press
      // No pressed dimming (styles.css dims every tapped button on phones): it reads as broken while dragging.
      style={{ ...handlers.style, opacity: 1, left: point.x, top: point.y, width: BUTTON, height: BUTTON }}
      className="animate-pop fixed z-40 flex touch-none items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/95 text-zinc-200 shadow-lg shadow-black/50 backdrop-blur select-none hover:bg-zinc-800"
    >
      <Monitor className="size-5" />
      <span className={`absolute top-2.5 right-2.5 size-2 rounded-full ring-2 ring-zinc-900 ${dotClass(vm)}`} />
    </button>
  )
}

function PreviewWindow({ vm, onClose }: { vm: VmInfo; onClose: () => void }) {
  const [large, setLarge] = useState(() => localStorage.getItem(SIZE_KEY) === "1")
  const width = Math.min(large ? WIDTH.large : WIDTH.small, viewport().width - 2 * MARGIN)
  const height = Math.round((width * 9) / 16) + TITLE_BAR
  const { point, handlers } = useDrag(POSITION_KEY("window"), width, height, () => ({
    x: viewport().width - width - 12,
    y: viewport().height - height - 180
  }))
  const running = vm.status === "running"
  const { url, loading, error } = useDesktopUrl(vm.key, savedDesktopMode(), running)

  const iconButton = "rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
  return (
    <div
      role="dialog"
      aria-label="VM preview"
      style={{ left: point.x, top: point.y, width, height }}
      className="animate-pop fixed z-40 flex flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl shadow-black/60 select-none"
    >
      {/* Title bar: drag it to move the window. */}
      <div {...handlers} className="flex h-8 shrink-0 cursor-grab touch-none items-center gap-1.5 border-b border-zinc-800 bg-zinc-900 pr-1 pl-2.5 active:cursor-grabbing">
        <span className={`size-1.5 shrink-0 rounded-full ${dotClass(vm)}`} />
        <span className="truncate text-xs font-medium text-zinc-300">{vm.busy ? "Dex is working" : "VM desktop"}</span>
        <div className="ml-auto flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => {
              localStorage.setItem(SIZE_KEY, large ? "0" : "1")
              setLarge(!large)
            }}
            title={large ? "Smaller" : "Larger"}
            className={iconButton}
          >
            {large ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
          <Link to="/machine/$vmKey" params={{ vmKey: vm.key }} title="Open the Machine page to take control" className={iconButton}>
            <MonitorUp className="size-3.5" />
          </Link>
          <button type="button" onClick={onClose} title="Close to a button" className={iconButton}>
            <Minus className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 bg-black">
        {running && url ? (
          <>
            <iframe key={url} src={url} title="VM desktop preview" allow="autoplay" tabIndex={-1} className="absolute inset-0 size-full border-0" />
            {/* Watch only: taps and drags on the picture move the window instead of reaching the VM. */}
            <div {...handlers} className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing" />
          </>
        ) : (
          <div {...handlers} className="absolute inset-0 flex touch-none flex-col items-center justify-center gap-1.5 p-3 text-center text-[11px] text-zinc-500">
            {loading || vm.status === "starting" ? <LoaderCircle className="size-4 animate-spin" /> : <Monitor className="size-4" />}
            {running ? (error ?? "Connecting to the desktop…") : vm.status === "starting" ? "The VM is starting…" : "The VM isn't running."}
          </div>
        )}
      </div>
    </div>
  )
}
