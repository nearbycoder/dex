import type { BoopFace as BoopFaceElement } from "boopface"
import { type DetailedHTMLProps, type HTMLAttributes, useEffect, useRef, useState } from "react"
import { isProjectImage } from "~/shared/projects"
import { type LookMood, SKINS, type SidekickLook } from "~/shared/sidekick-look"

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "boop-face": DetailedHTMLProps<HTMLAttributes<BoopFaceElement>, BoopFaceElement> & {
        size?: string
        motion?: "auto" | "reduce" | "full"
        "auto-sleep"?: string
        "wake-on"?: "activity" | "interaction" | "manual"
        "press-squeeze"?: string
        "antenna-drag"?: string
      }
    }
  }
}

/** BoopFace defines <boop-face> when loaded; it touches the DOM, so it loads in the browser only, once. */
let loading: Promise<typeof import("boopface")> | null = null
export const loadBoopFace = () => (loading ??= import("boopface"))

/** A finish BoopFace knows, or none (an unknown number throws). */
const applyFinish = (face: BoopFaceElement, finish: number | null | undefined) => {
  try {
    face.setSkin(finish ?? null)
  } catch {
    face.setSkin(null)
  }
}

/**
 * A sidekick's BoopFace, live: it blinks and glances around, its eyes follow the pointer, and it dozes off after a few
 * quiet minutes. While `mood` is working it waits (eyes circling); when the work ends it smiles, or droops if `failed`.
 * Only `interactive` faces take the pointer (squeeze, drag, the antenna); elsewhere clicks go to what's under them.
 */
export function BoopAvatar({
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
  const face = useRef<BoopFaceElement>(null)
  const [ready, setReady] = useState(() => typeof customElements !== "undefined" && Boolean(customElements.get("boop-face")))
  const previous = useRef<LookMood | null>(null)

  useEffect(() => {
    if (ready) return
    let live = true
    void loadBoopFace().then(() => live && setReady(true))
    return () => {
      live = false
    }
  }, [ready])

  useEffect(() => {
    if (ready && face.current) applyFinish(face.current, look.finish)
  }, [ready, look.finish])

  useEffect(() => {
    const element = face.current
    if (!ready || !element) return
    element.setPointerFollow(mood !== "still")
    if (mood === "working") {
      element.noteActivity(true)
      void element.startWaiting()
    } else if (previous.current === "working") {
      element.stopWaiting()
      void element.play(failed ? "failure" : "success")
    }
    previous.current = mood
  }, [ready, mood, failed])

  return (
    // Holds the face's room before BoopFace loads, so nothing moves when it appears.
    <span className={`inline-flex shrink-0 ${interactive ? "" : "pointer-events-none"} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      {ready && (
        <boop-face
          ref={face}
          size={String(size)}
          color={SKINS[look.skin] ?? SKINS.slate}
          motion={mood === "still" ? "reduce" : "auto"}
          auto-sleep={mood === "idle" ? "180000" : "0"}
          wake-on="activity"
          press-squeeze={String(interactive)}
          antenna-drag={String(interactive)}
        />
      )}
    </span>
  )
}

/**
 * The PNG saved with a look, for the iPhone and Android apps, which show pictures rather than run BoopFace: a face drawn
 * out of sight at rest, its SVG (finish included) copied and painted onto a canvas.
 */
export async function lookPng(look: SidekickLook, size = 256): Promise<string> {
  const { loadSkins } = await loadBoopFace()
  const face = document.createElement("boop-face")
  face.setAttribute("size", "240")
  face.setAttribute("auto-sleep", "0")
  face.setAttribute("color", SKINS[look.skin] ?? SKINS.slate)
  face.style.cssText = "position:fixed;left:0;top:0;opacity:0;pointer-events:none"
  document.body.appendChild(face)
  try {
    if (look.finish) await loadSkins()
    face.setPointerFollow(false)
    applyFinish(face, look.finish)
    // Let the finish paint and the face settle at rest.
    await new Promise((resolve) => setTimeout(resolve, 500))
    const svg = face.shadowRoot?.querySelector("svg")?.cloneNode(true) as SVGSVGElement | undefined
    if (!svg) throw new Error("BoopFace didn't draw")
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg")
    // BoopFace draws the antenna from its animation loop, which a face out of sight doesn't run: add it at rest, in
    // the head's fill, as BoopFace does.
    if (!svg.querySelector("#antennaDot")) {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle")
      dot.setAttribute("cx", "120")
      dot.setAttribute("cy", "12")
      dot.setAttribute("r", "15")
      dot.setAttribute("fill", svg.querySelector("#head")?.getAttribute("fill") ?? SKINS[look.skin] ?? SKINS.slate)
      svg.appendChild(dot)
    }
    // Room for the antenna, which sits above the head.
    svg.setAttribute("viewBox", "0 -8 240 248")
    svg.setAttribute("width", "256")
    svg.setAttribute("height", "256")
    const image = new Image()
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
    await image.decode()
    // Busy finishes (carbon, galaxy, metal) make big PNGs: smaller until it fits the agent's picture limit.
    for (const side of [size, 224, 192, 160, 128, 96].filter((side) => side <= size)) {
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = side
      canvas.getContext("2d")!.drawImage(image, 0, 0, side, side)
      const png = canvas.toDataURL("image/png")
      if (isProjectImage(png)) return png
    }
    throw new Error("This face's picture is too big to save.")
  } finally {
    face.remove()
  }
}

/** Bumped when looks are drawn differently, so each sidekick's saved PNG is redrawn once for the apps. */
export const LOOK_STYLE = 3
