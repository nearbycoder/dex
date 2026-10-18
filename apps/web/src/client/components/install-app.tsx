import { CheckCircle2, Download, Share, SquarePlus } from "lucide-react"
import { useEffect, useState } from "react"

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

declare global {
  interface Window {
    __dexInstallPrompt?: InstallPromptEvent
  }
}

const isStandalone = () =>
  document.documentElement.dataset.standalone === "true" || matchMedia("(display-mode: standalone)").matches

// iPadOS reports itself as a Mac; touch support gives it away.
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1)

/** Add-to-Home-Screen, as the control of a settings row: a native install button where the browser offers one, steps otherwise. */
export function InstallApp() {
  const [standalone, setStandalone] = useState(false)
  const [ios, setIos] = useState(false)
  const [prompt, setPrompt] = useState<InstallPromptEvent | undefined>()
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    setStandalone(isStandalone())
    setIos(isIos())
    setPrompt(window.__dexInstallPrompt)
    const available = () => setPrompt(window.__dexInstallPrompt)
    const done = () => setInstalled(true)
    addEventListener("dex-install-available", available)
    addEventListener("appinstalled", done)
    return () => {
      removeEventListener("dex-install-available", available)
      removeEventListener("appinstalled", done)
    }
  }, [])

  if (standalone || installed) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-400">
        <CheckCircle2 className="size-3.5" /> Installed
      </span>
    )
  }

  if (prompt) {
    return (
      <button
        type="button"
        onClick={async () => {
          await prompt.prompt()
          const { outcome } = await prompt.userChoice
          window.__dexInstallPrompt = undefined
          setPrompt(undefined)
          if (outcome === "accepted") setInstalled(true)
        }}
        className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
      >
        <Download className="size-4" /> Install
      </button>
    )
  }

  return (
    <span className="flex items-center gap-1 text-xs text-zinc-400">
      {ios ? (
        <>
          <Share className="size-3.5 text-sky-400" /> Share <span className="text-zinc-600">→</span> <SquarePlus className="size-3.5" /> Add to Home Screen
        </>
      ) : (
        "Browser menu → Install app"
      )}
    </span>
  )
}
