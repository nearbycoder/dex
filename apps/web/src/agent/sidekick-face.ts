import { avatarFrame, type Matrix } from "open-bot-avatar"
import { EYE_INK, lookDefinition, SKINS, type SidekickLook } from "../shared/sidekick-look.ts"

/**
 * A sidekick's face as a PNG, drawn by the agent: the picture the iPhone and Android apps show, notifications carry, and
 * apps from before Open Bot Avatar show instead of their own drawing. Open Bot Avatar computes the face at rest (its
 * still: the silhouette's projected cross-sections, all in the face's color, and the two eyes) as plain paths, and
 * this fills them, so any look, a chat's custom shape included, gets its picture wherever it was saved from, with no
 * browser. Drawn 4 × 4 samples a pixel for smooth edges.
 */

type Point = [number, number]
/** A filled outline: its subpaths, as points, and whether it fills even-odd rather than nonzero. */
type Outline = { readonly polygons: Point[][]; readonly evenOdd: boolean }

/** SVG path data (every command, absolute and relative) flattened to polygons, `steps(length)` points per curve. */
export function flattenPath(d: string, steps: (length: number) => number = (length) => Math.min(48, Math.max(4, Math.ceil(length / 2)))): Point[][] {
  const polygons: Point[][] = []
  let current: Point[] = []
  let i = 0
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  // The previous curve's second control point, for S and T.
  let control: Point | null = null
  let command = ""
  // The command before this one: S and T reflect its control point only after a curve of their kind.
  let lastCommand = ""
  const space = () => {
    while (i < d.length && /[\s,]/.test(d[i]!)) i++
  }
  const number = () => {
    space()
    const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i, i + 40))
    if (!match) throw new Error(`Bad path data near "${d.slice(i, i + 12)}"`)
    i += match[0].length
    return Number(match[0])
  }
  const flag = () => {
    space()
    const char = d[i++]
    if (char !== "0" && char !== "1") throw new Error("Bad arc flag in path data")
    return char === "1"
  }
  const finish = () => {
    if (current.length > 2) polygons.push(current)
    current = []
  }
  const lineTo = (nx: number, ny: number) => {
    if (!current.length) current.push([x, y])
    current.push([nx, ny])
    x = nx
    y = ny
  }
  const cubic = (x1: number, y1: number, x2: number, y2: number, nx: number, ny: number) => {
    const n = steps(Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(nx - x2, ny - y2))
    const [ox, oy] = [x, y]
    if (!current.length) current.push([x, y])
    for (let k = 1; k <= n; k++) {
      const t = k / n
      const u = 1 - t
      current.push([
        u * u * u * ox + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * nx,
        u * u * u * oy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ny
      ])
    }
    x = nx
    y = ny
    control = [x2, y2]
  }
  const quadratic = (x1: number, y1: number, nx: number, ny: number) => {
    const [ox, oy] = [x, y]
    cubic(ox + (2 / 3) * (x1 - ox), oy + (2 / 3) * (y1 - oy), nx + (2 / 3) * (x1 - nx), ny + (2 / 3) * (y1 - ny), nx, ny)
    control = [x1, y1]
  }
  // SVG's elliptical arc, from its endpoint form (SVG 1.1 implementation notes, F.6.5).
  const arc = (rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, nx: number, ny: number) => {
    rx = Math.abs(rx)
    ry = Math.abs(ry)
    if (!rx || !ry || (nx === x && ny === y)) return lineTo(nx, ny)
    const phi = (rotation * Math.PI) / 180
    const cos = Math.cos(phi)
    const sin = Math.sin(phi)
    const dx = (x - nx) / 2
    const dy = (y - ny) / 2
    const x1 = cos * dx + sin * dy
    const y1 = -sin * dx + cos * dy
    const scale = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
    if (scale > 1) {
      rx *= Math.sqrt(scale)
      ry *= Math.sqrt(scale)
    }
    const sign = large === sweep ? -1 : 1
    const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
    const factor = sign * Math.sqrt(Math.max(0, numerator / (rx * rx * y1 * y1 + ry * ry * x1 * x1)))
    const cx1 = (factor * rx * y1) / ry
    const cy1 = (-factor * ry * x1) / rx
    const cx = cos * cx1 - sin * cy1 + (x + nx) / 2
    const cy = sin * cx1 + cos * cy1 + (y + ny) / 2
    const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
    let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
    if (!sweep && delta > 0) delta -= 2 * Math.PI
    if (sweep && delta < 0) delta += 2 * Math.PI
    const n = steps(Math.abs(delta) * Math.max(rx, ry))
    if (!current.length) current.push([x, y])
    for (let k = 1; k <= n; k++) {
      const theta = start + (delta * k) / n
      const ex = rx * Math.cos(theta)
      const ey = ry * Math.sin(theta)
      current.push(k === n ? [nx, ny] : [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy])
    }
    x = nx
    y = ny
  }

  for (;;) {
    space()
    if (i >= d.length) break
    if (/[a-zA-Z]/.test(d[i]!)) command = d[i++]!
    else if (!command) throw new Error("Path data must start with a command")
    const relative = command === command.toLowerCase()
    const ox = relative ? x : 0
    const oy = relative ? y : 0
    const previous = control
    control = null
    switch (command.toUpperCase()) {
      case "M": {
        finish()
        const nx = ox + number()
        const ny = oy + number()
        x = startX = nx
        y = startY = ny
        current = [[x, y]]
        // Further pairs after a move are lines.
        command = relative ? "l" : "L"
        break
      }
      case "L": {
        const nx = ox + number()
        lineTo(nx, oy + number())
        break
      }
      case "H":
        lineTo(ox + number(), y)
        break
      case "V":
        lineTo(x, oy + number())
        break
      case "C": {
        const values = [number(), number(), number(), number(), number(), number()]
        cubic(ox + values[0]!, oy + values[1]!, ox + values[2]!, oy + values[3]!, ox + values[4]!, oy + values[5]!)
        break
      }
      case "S": {
        const values = [number(), number(), number(), number()]
        const [rx, ry] = previous && /[CS]/i.test(lastCommand) ? [2 * x - previous[0], 2 * y - previous[1]] : [x, y]
        cubic(rx, ry, ox + values[0]!, oy + values[1]!, ox + values[2]!, oy + values[3]!)
        break
      }
      case "Q": {
        const values = [number(), number(), number(), number()]
        quadratic(ox + values[0]!, oy + values[1]!, ox + values[2]!, oy + values[3]!)
        break
      }
      case "T": {
        const [qx, qy] = previous && /[QT]/i.test(lastCommand) ? [2 * x - previous[0], 2 * y - previous[1]] : [x, y]
        const nx = ox + number()
        quadratic(qx, qy, nx, oy + number())
        break
      }
      case "A": {
        const rx = number()
        const ry = number()
        const rotation = number()
        const large = flag()
        const sweep = flag()
        const nx = ox + number()
        arc(rx, ry, rotation, large, sweep, nx, oy + number())
        break
      }
      case "Z":
        finish()
        x = startX
        y = startY
        break
      default:
        throw new Error(`Unknown path command "${command}"`)
    }
    lastCommand = command
  }
  finish()
  return polygons
}

/** `inner` then `outer`, as nested SVG transforms apply them. */
const compose = (outer: Matrix, inner: Matrix): Matrix => [
  outer[0] * inner[0] + outer[2] * inner[1],
  outer[1] * inner[0] + outer[3] * inner[1],
  outer[0] * inner[2] + outer[2] * inner[3],
  outer[1] * inner[2] + outer[3] * inner[3],
  outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
  outer[1] * inner[4] + outer[3] * inner[5] + outer[5]
]
const apply = (m: Matrix, [x, y]: Point): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** A rounded rectangle's outline. */
const pill = (x: number, y: number, width: number, height: number, radius: number): Point[] => {
  const r = Math.min(radius, width / 2, height / 2)
  const points: Point[] = []
  const corners: Array<[number, number, number]> = [
    [x + width - r, y + r, -Math.PI / 2],
    [x + width - r, y + height - r, 0],
    [x + r, y + height - r, Math.PI / 2],
    [x + r, y + r, Math.PI]
  ]
  for (const [cx, cy, from] of corners) for (let k = 0; k <= 8; k++) points.push([cx + r * Math.cos(from + (k * Math.PI) / 16), cy + r * Math.sin(from + (k * Math.PI) / 16)])
  return points
}

/** The face at rest as outlines in its 0 0 100 100 box: the body's, then the eyes'. */
export function faceOutlines(look: Pick<SidekickLook, "shape" | "custom">): { body: Outline[]; eyes: Outline[] } {
  const frame = avatarFrame(lookDefinition(look), { reducedMotion: true })
  const paths = new Map(frame.paths.map((path) => [path.id, { polygons: flattenPath(path.d), evenOdd: path.evenOdd }]))
  const body: Outline[] = []
  const eyes: Outline[] = []
  for (const shape of frame.shapes) {
    const matrix = compose(frame.root, shape.matrix)
    if (shape.kind === "slice") {
      const path = paths.get(shape.path)
      if (path) body.push({ polygons: path.polygons.map((polygon) => polygon.map((point) => apply(matrix, point))), evenOdd: path.evenOdd })
    } else if (shape.kind === "eye") {
      const mark = shape.mark
      const polygons = mark.shape === "pill" ? [pill(mark.x, mark.y, mark.width, mark.height, mark.radius)] : mark.shape === "path" ? flattenPath(mark.d) : []
      eyes.push({ polygons: polygons.map((polygon) => polygon.map((point) => apply(matrix, point))), evenOdd: false })
    }
  }
  return { body, eyes }
}

const SAMPLES = 4

/** Marks the samples `outline` covers in `mask` (a side × side grid of samples over the 0 0 100 100 box). */
function fill(mask: Uint8Array, side: number, outline: Outline) {
  const scale = side / 100
  const edges: Array<[number, number, number, number, number]> = []
  let top = Infinity
  let bottom = -Infinity
  for (const polygon of outline.polygons) {
    for (let k = 0; k < polygon.length; k++) {
      const [ax, ay] = polygon[k]!
      const [bx, by] = polygon[(k + 1) % polygon.length]!
      if (ay === by) continue
      const [x0, y0, x1, y1, winding] = ay < by ? [ax, ay, bx, by, 1] : [bx, by, ax, ay, -1]
      edges.push([x0 * scale, y0 * scale, x1 * scale, y1 * scale, winding])
      top = Math.min(top, y0 * scale)
      bottom = Math.max(bottom, y1 * scale)
    }
  }
  const crossings: Array<[number, number]> = []
  for (let row = Math.max(0, Math.floor(top)); row < Math.min(side, Math.ceil(bottom)); row++) {
    const y = row + 0.5
    crossings.length = 0
    for (const [x0, y0, x1, y1, winding] of edges) {
      if (y < y0 || y >= y1) continue
      crossings.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), winding])
    }
    crossings.sort((a, b) => a[0] - b[0])
    let inside = 0
    for (let k = 0; k < crossings.length - 1; k++) {
      inside = outline.evenOdd ? inside ^ 1 : inside + crossings[k]![1]
      if (!inside) continue
      const from = Math.max(0, Math.ceil(crossings[k]![0] - 0.5))
      const to = Math.min(side, Math.ceil(crossings[k + 1]![0] - 0.5))
      mask.fill(1, row * side + from, row * side + to)
    }
  }
}

const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]

/**
 * The face at rest as RGBA pixels, `size` on a side, on a clear background. `layer` draws one part alone, for the apps'
 * editors, which tint the body and lay the eyes over it: the body in white (eyes left in), or the eyes.
 */
export function faceRgba(look: Pick<SidekickLook, "shape" | "custom" | "skin">, size: number, layer?: "body" | "eyes"): Uint8Array {
  const { body, eyes } = faceOutlines(look)
  const side = size * SAMPLES
  const bodyMask = new Uint8Array(side * side)
  const eyeMask = new Uint8Array(side * side)
  if (layer !== "eyes") for (const outline of body) fill(bodyMask, side, outline)
  if (layer !== "body") for (const outline of eyes) fill(eyeMask, side, outline)
  const color = layer === "body" ? ([255, 255, 255] as const) : rgb(SKINS[look.skin] ?? SKINS.peach)
  const ink = rgb(EYE_INK)
  const pixels = new Uint8Array(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bodyCount = 0
      let eyeCount = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        const at = (py * SAMPLES + sy) * side + px * SAMPLES
        for (let sx = 0; sx < SAMPLES; sx++) {
          if (eyeMask[at + sx]) eyeCount++
          else if (bodyMask[at + sx]) bodyCount++
        }
      }
      const total = bodyCount + eyeCount
      if (!total) continue
      const o = (py * size + px) * 4
      for (let c = 0; c < 3; c++) pixels[o + c] = Math.round((color[c]! * bodyCount + ink[c]! * eyeCount) / total)
      pixels[o + 3] = Math.round((255 * total) / (SAMPLES * SAMPLES))
    }
  }
  return pixels
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** RGBA pixels as a PNG file. */
export async function encodePng(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const raw = new Uint8Array(height * (width * 4 + 1))
  for (let row = 0; row < height; row++) raw.set(pixels.subarray(row * width * 4, (row + 1) * width * 4), row * (width * 4 + 1) + 1)
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 6, 0, 0, 0], 8)
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array())]
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    png.set(part, at)
    at += part.length
  }
  return png
}

const base64 = (bytes: Uint8Array) => {
  let binary = ""
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}

/** A picture's limit as a sidekick's image (isProjectImage: 48 KB of data URL). */
const IMAGE_LIMIT = 48 * 1024

/** The look's PNG as a data: URL, 256 pixels on a side (smaller if it wouldn't fit a sidekick's picture). */
export async function facePng(look: SidekickLook, size = 256): Promise<string> {
  for (const side of [size, 192, 128, 96].filter((side) => side <= size)) {
    const url = `data:image/png;base64,${base64(await encodePng(faceRgba(look, side), side, side))}`
    if (url.length <= IMAGE_LIMIT) return url
  }
  throw new Error("This face's picture is too big to save.")
}

/** Bumped when faces are drawn differently, so the agent redraws each sidekick's saved picture once. */
export const FACE_STYLE = 1
