import { Info } from "lucide-react"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"

/**
 * Secondary explanation behind an ⓘ, so pages stay short. Tap or click to open; tap anywhere else, scroll, or press
 * Escape to close. Rendered in a portal against the viewport, so no scroll container or animated parent can clip it.
 */
export function InfoTip({ children, label = "More info", className = "" }: { children: ReactNode; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const openedAt = Date.now()
    const close = (event: Event) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape") return
      // Tapping can nudge a scroll container (e.g. scrolling the button into view); only a real scroll closes it.
      if (event.type === "scroll" && Date.now() - openedAt < 400) return
      if (event.type === "pointerdown" && (button.current?.contains(event.target as Node) || panel.current?.contains(event.target as Node))) return
      setOpen(false)
    }
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", close)
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      document.removeEventListener("pointerdown", close)
      document.removeEventListener("keydown", close)
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [open])

  const toggle = () => {
    const rect = button.current?.getBoundingClientRect()
    if (rect) {
      const width = Math.min(288, window.innerWidth - 24)
      setPosition({ top: rect.bottom + 6, left: Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12)) })
    }
    setOpen((value) => !value)
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={toggle}
        data-no-press
        className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-zinc-500 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none ${open ? "text-zinc-200" : ""} ${className}`}
      >
        <Info className="size-3.5" />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="tooltip"
            style={{ top: position.top, left: position.left, width: Math.min(288, window.innerWidth - 24) }}
            className="fixed z-50 animate-pop rounded-xl border border-zinc-700/80 bg-zinc-900 px-3 py-2.5 text-xs leading-relaxed font-normal tracking-normal text-zinc-300 normal-case shadow-xl shadow-black/50"
          >
            {children}
          </div>,
          document.body
        )}
    </>
  )
}
