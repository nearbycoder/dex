import { renderAvatarSvg } from "open-bot-avatar"
import type { AvatarOptions, MountedAvatar } from "open-bot-avatar/dom"
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react"
import { type LookMood, lookDefinition, SKINS, type SidekickLook } from "~/shared/sidekick-look"

/** Open Bot Avatar's live renderer touches the DOM, so it loads in the browser only, once. */
let loading: Promise<typeof import("open-bot-avatar/dom")> | null = null
const loadLive = () => (loading ??= import("open-bot-avatar/dom"))

/** How long a face celebrates when its work is done, or shows its exclamation mark when the work failed. */
const AFTERGLOW_MS = { done: 6000, blocked: 4000 } as const

/**
 * A sidekick's face, an Open Bot Avatar, live: it breathes, blinks, looks around, and follows the pointer. While `mood`
 * is thinking, it turns into three hopping dots; while working, it bends over the work. When either ends it
 * celebrates, or shows an exclamation mark if `failed`. A still face is drawn once, with no animation. An
 * `interactive` face turns when dragged. Elsewhere clicks go to what's under it.
 */
export function SidekickFace({
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
  const definition = useMemo(() => lookDefinition(look), [look.shape, look.custom?.path, look.custom?.eyes, look.custom?.name])
  const color = SKINS[look.skin] ?? SKINS.peach
  // Until the live face loads (and on the server), the same face drawn still, so nothing moves when it appears.
  const still = useMemo(() => renderAvatarSvg(definition, { color, reducedMotion: true }), [definition, color])

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
  const options: AvatarOptions = {
    definition,
    color,
    state: mood === "working" ? "working" : mood === "thinking" ? "thinking" : (afterglow ?? "idle"),
    followPointer: mood !== "still" && !view,
    still: mood === "still",
    view: view ?? { yaw: 0, pitch: 0 },
    label: ""
  }
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
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
  }, [])

  useEffect(() => {
    avatar.current?.update(options)
  })

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
      {!mounted && <span className="absolute inset-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: still }} />}
      <span ref={host} className="absolute inset-0" />
    </span>
  )
}
