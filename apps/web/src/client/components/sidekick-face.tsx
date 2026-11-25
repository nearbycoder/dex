import { renderAvatarSvg } from "open-bot-avatar"
import type { AvatarMaterial, AvatarOptions, MountedAvatar } from "open-bot-avatar/dom"
import { memo, type PointerEvent, useEffect, useMemo, useRef, useState } from "react"
import { EYE_INK, type LookMood, lookDefinition, lookMaterial, type Material, SKINS, type SidekickLook } from "~/shared/sidekick-look"

/** Open Bot Avatar's live renderer touches the DOM, so it loads in the browser only, once. */
let loading: Promise<typeof import("open-bot-avatar/dom")> | null = null
const loadLive = () => (loading ??= import("open-bot-avatar/dom"))

/** Open Bot Avatar 0.5+ materials are imported values so unused ones stay out of the bundle. */
const resolvedMaterials = new Map<Material, AvatarMaterial>([["flat", "flat"]])
const materialLoaders = new Map<Material, Promise<AvatarMaterial>>()
function loadMaterial(material: Material): Promise<AvatarMaterial> {
  const ready = resolvedMaterials.get(material)
  if (ready) return Promise.resolve(ready)
  let pending = materialLoaders.get(material)
  if (!pending) {
    pending = (
      material === "fluffy"
        ? import("open-bot-avatar/materials/fluffy").then((mod) => mod.fluffy)
        : material === "glass"
          ? import("open-bot-avatar/materials/glass").then((mod) => mod.glass)
          : Promise.resolve<AvatarMaterial>("flat")
    ).then((value) => {
      resolvedMaterials.set(material, value)
      return value
    })
    materialLoaders.set(material, pending)
  }
  return pending
}

/** How long a face celebrates when its work is done, or shows its exclamation mark when the work failed. */
const AFTERGLOW_MS = { done: 6000, blocked: 4000 } as const
const ZERO_VIEW = { yaw: 0, pitch: 0 }

/** Cached material still data URLs so lists, pickers, and long chats render plain <img>s after one WebGL2 paint. */
const materialCache = new Map<string, string>()
const materialPending = new Map<string, Promise<string | null>>()
let materialQueue: Promise<unknown> = Promise.resolve()
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
  return `${size}|${lookMaterial(look)}|${look.shape}|${look.skin}|${custom}`
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
 * Renders a non-flat look (fluffy or glass) once at rest into a transparent square data: URL using Open Bot Avatar's
 * WebGL2 renderer, cached by look, material, and size. Returns null for flat looks or without WebGL2 (callers fall
 * back to flat SVG / the agent's flat PNG).
 */
export function materialImageDataUrl(look: SidekickLook, size = 256): Promise<string | null> {
  const material = lookMaterial(look)
  if (material === "flat" || !hasWebGL2()) return Promise.resolve(null)
  const key = lookCacheKey(look, size)
  const hit = materialCache.get(key)
  if (hit) return Promise.resolve(hit)
  const inflight = materialPending.get(key)
  if (inflight) return inflight

  const run = (materialQueue = materialQueue
    .then(async () => {
      const again = materialCache.get(key)
      if (again) return again
      const [{ mountAvatar }, avatarMaterial] = await Promise.all([loadLive(), loadMaterial(material)])
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
          material: avatarMaterial,
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
        if (materialCache.size >= 128) materialCache.delete(materialCache.keys().next().value!)
        materialCache.set(key, url)
        return url
      } finally {
        mounted?.destroy()
        host.remove()
      }
    })
    .catch(() => null)) as Promise<string | null>

  materialPending.set(key, run)
  void run.finally(() => materialPending.delete(key))
  return run
}

/**
 * A sidekick's face, an Open Bot Avatar, live: it breathes, blinks, looks around, and follows the pointer. While `mood`
 * is thinking, it turns into three hopping dots; while working, it bends over the work. When either ends it
 * celebrates, or shows an exclamation mark if `failed`. A still face is drawn once, with no animation (plain SVG when
 * flat, cached single-frame WebGL2 image when fluffy or glass). An `interactive` face turns when dragged. Elsewhere
 * clicks go to what's under it.
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

  // A fluffy or glass still renders once into the shared cache and displays as an ordinary <img>.
  const stillPixels = size <= 48 ? 128 : 256
  const stillKey = isStill && material !== "flat" ? lookCacheKey(look, stillPixels) : null
  const [materialStill, setMaterialStill] = useState<string | null>(() => (stillKey ? (materialCache.get(stillKey) ?? null) : null))
  useEffect(() => {
    if (!stillKey) {
      setMaterialStill(null)
      return
    }
    const cached = materialCache.get(stillKey)
    if (cached) {
      setMaterialStill(cached)
      return
    }
    setMaterialStill(null)
    let active = true
    void materialImageDataUrl(look, stillPixels).then((url) => {
      if (active) setMaterialStill(url)
    })
    return () => {
      active = false
    }
  }, [stillKey, look, stillPixels])

  // Load the imported Open Bot Avatar material object for live avatars when needed.
  const [resolvedMaterial, setResolvedMaterial] = useState<{ name: Material; value: AvatarMaterial } | null>(() => {
    const ready = resolvedMaterials.get(material)
    return ready ? { name: material, value: ready } : null
  })
  useEffect(() => {
    if (isStill) return
    const ready = resolvedMaterials.get(material)
    if (ready) {
      setResolvedMaterial({ name: material, value: ready })
      return
    }
    let active = true
    void loadMaterial(material).then((value) => {
      if (active) setResolvedMaterial({ name: material, value })
    })
    return () => {
      active = false
    }
  }, [isStill, material])

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
  const options = useMemo<Omit<AvatarOptions, "material">>(
    () => ({
      definition,
      color,
      state: mood === "working" ? "working" : mood === "thinking" ? "thinking" : (afterglow ?? "idle"),
      followPointer: !isStill && !view,
      still: isStill,
      view: view ?? ZERO_VIEW,
      label: ""
    }),
    [definition, color, mood, afterglow, isStill, view]
  )
  const latestOptions = useRef(options)
  latestOptions.current = options
  const latestMaterial = useRef(material)
  latestMaterial.current = material

  useEffect(() => {
    // Still faces stay static (plain SVG for flat, cached image for fluffy/glass) without mounting live DOM controllers.
    if (isStill) {
      setMounted(false)
      return
    }
    let live = true
    void Promise.all([loadLive(), loadMaterial(latestMaterial.current)]).then(([{ mountAvatar }, loadedMaterial]) => {
      if (!live || !host.current) return
      const currentMaterial = resolvedMaterials.get(latestMaterial.current) ?? loadedMaterial
      avatar.current = mountAvatar(host.current, { ...latestOptions.current, material: currentMaterial })
      setMounted(true)
    })
    return () => {
      live = false
      avatar.current?.destroy()
      avatar.current = null
    }
  }, [isStill])

  useEffect(() => {
    if (!avatar.current) return
    if (resolvedMaterial?.name === material) {
      avatar.current.update({ ...options, material: resolvedMaterial.value })
    } else {
      avatar.current.update(options)
    }
  }, [options, material, resolvedMaterial])

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
      {materialStill ? (
        <img src={materialStill} alt="" className="size-full" draggable={false} />
      ) : (
        !mounted && <span className="absolute inset-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: still }} />
      )}
      {!isStill && <span ref={host} className="absolute inset-0" />}
    </span>
  )
})
