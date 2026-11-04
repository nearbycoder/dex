import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

interface Ask {
  readonly title: string
  readonly body?: string
  /** The confirming button's label: "Delete", "Remove", "Sign out". */
  readonly confirm: string
  /** Red for deleting and other things that can't be taken back. Defaults to danger. */
  readonly tone?: "danger" | "default"
}

let show: ((ask: Ask & { resolve: (ok: boolean) => void }) => void) | null = null

/**
 * Asks before something lasting happens, in Dex's own dialog rather than the browser's. Resolves true when confirmed;
 * Escape, Cancel, or a tap outside resolve false. Needs `ConfirmHost` mounted (the app layout does).
 */
export function ask(options: Ask): Promise<boolean> {
  if (!show) return Promise.resolve(window.confirm(options.body ? `${options.title}\n\n${options.body}` : options.title))
  return new Promise((resolve) => show?.({ ...options, resolve }))
}

/** Where `ask` shows its dialog. */
export function ConfirmHost() {
  const [current, setCurrent] = useState<(Ask & { resolve: (ok: boolean) => void }) | null>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    show = (next) =>
      setCurrent((previous) => {
        previous?.resolve(false)
        return next
      })
    return () => {
      show = null
    }
  }, [])

  const settle = (ok: boolean) => {
    current?.resolve(ok)
    setCurrent(null)
  }

  useEffect(() => {
    if (!current) return
    confirmButton.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        settle(false)
      }
    }
    document.addEventListener("keydown", key)
    return () => document.removeEventListener("keydown", key)
  }, [current])

  if (!current) return null
  const danger = (current.tone ?? "danger") === "danger"
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex animate-fade items-end justify-center bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-[2px] sm:items-center"
      onPointerDown={(event) => event.target === event.currentTarget && settle(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dex-confirm-title"
        aria-describedby={current.body ? "dex-confirm-body" : undefined}
        className="w-full max-w-sm animate-pop rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl shadow-black/60"
      >
        <h2 id="dex-confirm-title" className="text-base font-semibold text-zinc-100">
          {current.title}
        </h2>
        {current.body && (
          <p id="dex-confirm-body" className="mt-1.5 text-sm leading-relaxed text-zinc-400">
            {current.body}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => settle(false)} className="rounded-lg px-3.5 py-2 text-sm text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100">
            Cancel
          </button>
          <button
            ref={confirmButton}
            type="button"
            onClick={() => settle(true)}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:outline-none ${
              danger ? "bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-500" : "bg-zinc-100 text-zinc-900 hover:bg-white focus-visible:ring-zinc-300"
            }`}
          >
            {current.confirm}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
