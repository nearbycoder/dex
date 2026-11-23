import { renderAvatarSvg } from "open-bot-avatar"
import type { AvatarOptions, MountedAvatar } from "open-bot-avatar/dom"
import { memo, type PointerEvent, useEffect, useMemo, useRef, useState } from "react"
import { EYE_INK, type LookMood, lookDefinition, lookMaterial, SKINS, type SidekickLook } from "~/shared/sidekick-look"

/** Open Bot Avatar's live renderer touches the DOM, so it loads in the browser only, once. */
let loading: Promise<typeof import("open-bot-avatar/dom")> | null = null
const loadLive = () => (loading ??= import("open-bot-avatar/dom"))

/** How long a face celebrates when its work is done, or shows its exclamation mark when the work failed. */
const AFTERGLOW_MS = { done: 6000, blocked: 4000 } as const
const ZERO_VIEW = { yaw: 0, pitch: 0 }

/** Cached fluffy still data URLs so lists, pickers, and long chats render plain <img>s after one WebGL2 paint. */
const fluffyCache = new Map<string, string>()
const fluffyPending = new Map<string, Promise<string | null>>()
let fluffyQueue: Promise<unknown> = Promise.resolve()
let webgl2Checked: boolean | null = null

function hasWebGL2(): boolean {
  if (typeof document === "undefined") return false
  if (webgl2Checked === null) {
    try {
      const probe = document.createElement("canvas")
      probe.width = probe.height = 1
      webgl2Checked = Boolean(probe.getContext("webgl2"))
    } catch {
      webgl2Checked = false
    }
  }
  return webgl2Checked
}

function lookCacheKey(look: SidekickLook, size: number): string {
  const custom = look.shape === "custom" && look.custom ? `${look.custom.path}|${look.custom.eyes.x},${look.custom.eyes.y},${look.custom.eyes.spacing},${look.custom.eyes.scale}` : ""
  return `${size}|${look.shape}|${look.skin}|${custom}`
}

/** Encodes a transparent 256px (or smaller) canvas under the 48 KB character image limit (WebP first, PNG fallback). */
function encodeStillCanvas(source: HTMLCanvasElement, maxChars = 63_000): string | null {
  const webp = source.toDataURL("image/webp", 0.85)
  if (webp.startsWith("data:image/webp") && webp.length <= maxChars) return webp
  for (const side of [256, 160, 128, 96]) {
    const canvas = side === source.width ? source : document.createElement("canvas")
    if (canvas !== source) {
      canvas.width = canvas.height = side
      canvas.getContext("2d")!.drawImage(source, 0, 0, side, side)
    }
    const png = canvas.toDataURL("image/png")
    if (png.length <= maxChars) return png
  }
  return null
}

/**
 * Renders a fluffy look once at rest into a transparent square data: URL using Open Bot Avatar's WebGL2 renderer,
 * cached by look and size. Returns null without WebGL2 (callers fall back to flat SVG / the agent's flat PNG).
 */
export function fluffyImageDataUrl(look: SidekickLook, size = 256): Promise<string | null> {
  if (!hasWebGL2()) return Promise.resolve(null)
  const key = lookCacheKey(look, size)
  const hit = fluffyCache.get(key)
  if (hit) return Promise.resolve(hit)
  const inflight = fluffyPending.get(key)
  if (inflight) return inflight

  const run = (fluffyQueue = fluffyQueue.then(async () => {
    const again = fluffyCache.get(key)
    if (again) return again
    const { mountAvatar } = await loadLive()
    const host = document.createElement("div")
    host.style.cssText = `position:fixed;left:-9999px;top:0;width:${size}px;height:${size}px;pointer-events:none;visibility:hidden`
    document.body.appendChild(host)
    let mounted: MountedAvatar | null = null
    try {
      const definition = lookDefinition(look)
      const color = SKINS[look.skin] ?? SKINS.peach
      mounted = mountAvatar(host, {
        definition,
        color,
        eyeColor: EYE_INK,
        material: "fluffy",
        still: true,
        view: ZERO_VIEW,
        label: ""
      })
      let painted: HTMLCanvasElement | null = null
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const canvas = host.querySelector("canvas")
        if (canvas && canvas.width > 0 && canvas.style.width) {
          painted = canvas
          break
        }
      }
      if (!painted) return null
      const out = document.createElement("canvas")
      out.width = out.height = size
      const ctx = out.getContext("2d")
      if (!ctx) return null
      const left = Number.parseFloat(painted.style.left) || 0
      const top = Number.parseFloat(painted.style.top) || 0
      const width = Number.parseFloat(painted.style.width) || size
      const height = Number.parseFloat(painted.style.height) || size
      ctx.drawImage(painted, left, top, width, height)
      const url = encodeStillCanvas(out)
      if (!url) return null
      if (fluffyCache.size >= 64) fluffyCache.delete(fluffyCache.keys().next().value!)
      fluffyCache.set(key, url)
      return url
    } finally {
      mounted?.destroy()
      host.remove()
    }
  }).catch(() => null)) as Promise<string | null>

  fluffyPending.set(key, run)
  void run.finally(() => fluffyPending.delete(key))
  return run
}

/**
 * A sidekick's face, an Open Bot Avatar, live: it breathes, blinks, looks around, and follows the pointer. While `mood`
 * is thinking, it turns into three hopping dots; while working, it bends over the work. When either ends it
 * celebrates, or shows an exclamation mark if `failed`. A still face is drawn once, with no animation (plain SVG when
 * flat, cached single-frame WebGL2 image when fluffy). An `interactive` face turns when dragged. Elsewhere clicks go
 * to what's under it.
 */
export const SidekickFace = memo(function SidekickFace({
  look,
  size,
  mood = "idle",
  failed = false,
  interactive = false,
  className = ""
}: {
  look: SidekickLook
  size: number
  mood?: LookMood
  failed?: boolean
  interactive?: boolean
  className?: string
}) {
  const host = useRef<HTMLSpanElement>(null)
  const avatar = useRef<MountedAvatar | null>(null)
  const [mounted, setMounted] = useState(false)
  const isStill = mood === "still"
  const material = lookMaterial(look)
  const definition = useMemo(() => lookDefinition(look), [look.shape, look.custom?.path, look.custom?.eyes, look.custom?.name])
  const color = SKINS[look.skin] ?? SKINS.peach
  // Until the live face loads (and whenever a flat face is still), draw the same face as a static SVG.
  const still = useMemo(() => renderAvatarSvg(definition, { color, reducedMotion: true }), [definition, color])

  // A fluffy still renders once into the shared cache and displays as an ordinary <img>.
  const stillPixels = size <= 48 ? 128 : 256
  const stillKey = isStill && material === "fluffy" ? lookCacheKey(look, stillPixels) : null
  const [fluffyStill, setFluffyStill] = useState<string | null>(() => (stillKey ? (fluffyCache.get(stillKey) ?? null) : null))
  useEffect(() => {
    if (!stillKey) {
      setFluffyStill(null)
      return
    }
    const cached = fluffyCache.get(stillKey)
    if (cached) {
      setFluffyStill(cached)
      return
    }
    setFluffyStill(null)
    let active = true
    void fluffyImageDataUrl(look, stillPixels).then((url) => {
      if (active) setFluffyStill(url)
    })
    return () => {
      active = false
    }
  }, [stillKey, look, stillPixels])

  // When thinking or working ends: a short celebration, or the exclamation mark.
  const [afterglow, setAfterglow] = useState<keyof typeof AFTERGLOW_MS | null>(null)
  const previous = useRef(mood)
  useEffect(() => {
    const was = previous.current
    previous.current = mood
    if (mood !== "idle") return setAfterglow(null)
    if (was !== "working" && was !== "thinking") return
    const next = failed ? "blocked" : "done"
    setAfterglow(next)
    const timer = setTimeout(() => setAfterglow(null), AFTERGLOW_MS[next])
    return () => clearTimeout(timer)
  }, [mood, failed])

  const [view, setView] = useState<{ yaw: number; pitch: number } | null>(null)
  const options = useMemo<AvatarOptions>(
    () => ({
      definition,
      color,
      material,
      state: mood === "working" ? "working" : mood === "thinking" ? "thinking" : (afterglow ?? "idle"),
      followPointer: !isStill && !view,
      still: isStill,
      view: view ?? ZERO_VIEW,
      label: ""
    }),
    [definition, color, material, mood, afterglow, isStill, view]
  )
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    // Still faces stay static (plain SVG for flat, cached image for fluffy) without mounting live DOM controllers.
    if (isStill) {
      setMounted(false)
      return
    }
    let live = true
    void loadLive().then(({ mountAvatar }) => {
      if (!live || !host.current) return
      avatar.current = mountAvatar(host.current, latest.current)
      setMounted(true)
    })
    return () => {
      live = false
      avatar.current?.destroy()
      avatar.current = null
    }
  }, [isStill])

  useEffect(() => {
    avatar.current?.update(options)
  }, [options])

  // Dragging turns it; letting go, it turns back.
  const drag = useRef<{ x: number; y: number } | null>(null)
  const pointer = interactive
    ? {
        onPointerDown: (event: PointerEvent) => {
          drag.current = { x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture(event.pointerId)
        },
        onPointerMove: (event: PointerEvent) => {
          if (!drag.current) return
          const yaw = Math.max(-1.2, Math.min(1.2, (event.clientX - drag.current.x) / 60))
          const pitch = Math.max(-0.6, Math.min(0.6, -(event.clientY - drag.current.y) / 80))
          setView({ yaw, pitch })
        },
        onPointerUp: () => {
          drag.current = null
          setView(null)
        },
        onPointerCancel: () => {
          drag.current = null
          setView(null)
        }
      }
    : {}

  return (
    <span
      className={`relative inline-flex shrink-0 ${interactive ? "cursor-grab touch-none active:cursor-grabbing" : "pointer-events-none"} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
      {...pointer}
    >
      {fluffyStill ? (
        <img src={fluffyStill} alt="" className="size-full" draggable={false} />
      ) : (
        !mounted && <span className="absolute inset-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: still }} />
      )}
      {!isStill && <span ref={host} className="absolute inset-0" />}
    </span>
  )
})
