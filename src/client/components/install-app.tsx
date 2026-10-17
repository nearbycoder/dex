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

/** Add-to-Home-Screen: a native install button where the browser offers one, steps on iOS. */
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
      <p className="flex items-center gap-2 text-sm text-emerald-400">
        <CheckCircle2 className="size-4" /> Dex is installed on this device.
      </p>
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
        className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
      >
        <Download className="size-4" /> Install Dex
      </button>
    )
  }

  if (ios) {
    return (
      <ol className="space-y-2 text-sm text-zinc-300">
        <li className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-zinc-800 text-xs">1</span>
          Tap <Share className="inline size-4 text-sky-400" /> <span className="text-zinc-400">Share</span> in Safari's toolbar
        </li>
        <li className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-zinc-800 text-xs">2</span>
          Choose <SquarePlus className="inline size-4" /> <span className="text-zinc-400">Add to Home Screen</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-zinc-800 text-xs">3</span>
          Open Dex from your Home Screen and sign in once
        </li>
      </ol>
    )
  }

  return (
    <p className="text-sm text-zinc-400">
      Use your browser's menu and choose <span className="text-zinc-200">Install app</span> or{" "}
      <span className="text-zinc-200">Add to Home screen</span>.
    </p>
  )
}
