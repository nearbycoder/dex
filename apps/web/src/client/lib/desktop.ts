import { useCallback, useEffect, useRef, useState } from "react"
import { useDex } from "./dex"

/**
 * boat's Stream player needs MediaStreamTrackGenerator (Chromium only) and hangs elsewhere, notably on
 * iPhone/iPad where every browser is WebKit. Those get Selkies (H.264 over WebCodecs, served by Dex), with noVNC as
 * the fallback that runs anywhere.
 */
export const streamSupported = () => typeof window !== "undefined" && "MediaStreamTrackGenerator" in window

export type DesktopMode = "stream" | "selkies" | "vnc"
const MODE_KEY = "dex-desktop-mode"

/** The streaming mode last picked on this device, else the best one this browser can play. */
export const savedDesktopMode = (): DesktopMode => {
  try {
    const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(MODE_KEY)
    if (saved === "selkies" || saved === "vnc" || (saved === "stream" && streamSupported())) return saved
  } catch {
    // Storage blocked: fall through to the browser default.
  }
  return streamSupported() ? "stream" : "selkies"
}

export const saveDesktopMode = (mode: DesktopMode) => {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {}
}

/** The desktop page to frame for a VM, fetched while it runs (Selkies may first need setting up, ~30s once). */
export function useDesktopUrl(vmKey: string, mode: DesktopMode, running: boolean) {
  const { stub } = useDex()
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Ignore responses from an older mode/VM request (e.g. switching off a slow Selkies setup to noVNC).
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const next = await stub.vmDesktopUrl(vmKey, mode)
      if (id !== requestId.current) return
      setUrl(next)
      if (!next) setError("The desktop is still starting. Try again in a few seconds.")
    } catch (cause) {
      if (id !== requestId.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [mode, stub, vmKey])

  useEffect(() => {
    if (running) {
      void load()
    } else {
      requestId.current++
      setUrl(null)
      setLoading(false)
    }
    return () => {
      requestId.current++
    }
  }, [running, load])

  return { url, loading, error, reload: load }
}
