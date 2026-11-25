import { type AvatarDefinition, validateAvatar } from "open-bot-avatar"

/**
 * A sidekick's face: an Open Bot Avatar (github.com/DominikScholz/open-bot-avatar, MIT), a little object with two dark
 * eyes (a robot, a cloud, a mug…) in a color. On the web it's live: it breathes, blinks, follows the pointer, works
 * while the sidekick works, and celebrates when it's done. The agent draws its PNG (`CharacterProfile.image`, see
 * src/agent/sidekick-face.ts) for the iPhone and Android apps and for notifications, which show pictures.
 *
 * A shape is one of Dex's (`SHAPES`), or `custom`: a silhouette and eye placement a chat drew (`custom`), checked by
 * Open Bot Avatar's own validator.
 *
 * The parts (body, eyes, mouth, extra, blush, finish) are from before, when looks were drawn from parts and then were
 * BoopFaces. They're still written so apps released before Open Bot Avatar read looks: a `finish` tells them to show
 * the saved picture instead of drawing a BoopFace, so it's always set (`LEGACY_FINISH`); nothing else reads them.
 */

export const BODIES = ["blob", "bean", "cube", "ghost", "cat", "bot"] as const
export const EYES = ["dot", "round", "sparkle", "happy", "sleepy", "wink", "visor"] as const
export const MOUTHS = ["smile", "grin", "tongue", "purr", "o", "flat"] as const
export const EXTRAS = ["none", "headphones", "glasses", "beanie", "beret", "crown", "sprout", "bow", "wizard", "headband"] as const
export const MATERIALS = ["flat", "fluffy", "glass"] as const
export const MATERIAL_LABELS: Record<(typeof MATERIALS)[number], string> = {
  flat: "Flat",
  fluffy: "Fluffy",
  glass: "Glass"
}

/** Face colors, light enough for the dark eyes. The keys are the ones looks have always had. */
export const SKINS = {
  peach: "#ff6a1a",
  lemon: "#facc15",
  mint: "#34d399",
  teal: "#2dd4bf",
  sky: "#38bdf8",
  lilac: "#a78bfa",
  pink: "#f472b6",
  coral: "#fb7185",
  cloud: "#d4d4d8",
  slate: "#94a3b8"
} as const

/** The eyes' ink: Open Bot Avatar's own. */
export const EYE_INK = "#151515"

/**
 * Dex's shapes, each an Open Bot Avatar definition: a silhouette in a 0 0 100 100 box (geometry within 8–92, holes
 * winding the other way) and where its eyes sit. The last six are Open Bot Avatar's own examples. Keys are stored in
 * looks: add shapes, don't rename or remove them (the apps fall back to the first for one they don't know).
 */
export const SHAPES = [
  {
    key: "bot",
    name: "Robot",
    path: "M30 30H70A12 12 0 0 1 82 42V74A12 12 0 0 1 70 86H30A12 12 0 0 1 18 74V42A12 12 0 0 1 30 30Z M48 31V20H52V31Z M50 9A6 6 0 0 1 56 15A6 6 0 0 1 50 21A6 6 0 0 1 44 15A6 6 0 0 1 50 9Z M12 54A2 2 0 0 1 14 52H19V64H14A2 2 0 0 1 12 62Z M81 52H86A2 2 0 0 1 88 54V62A2 2 0 0 1 86 64H81Z",
    eyes: { x: 50, y: 58, spacing: 20, scale: 1.3 }
  },
  {
    key: "blob",
    name: "Blob",
    path: "M50 14C70 13 86 26 87 46C88 66 80 84 58 86C42 88 18 84 14 62C10 42 26 15 50 14Z",
    eyes: { x: 50, y: 46, spacing: 18, scale: 1.25 }
  },
  {
    key: "ghost",
    name: "Ghost",
    path: "M50 12C70 12 82 28 82 48V82C82 86 78 87 75 84L69 78L62 85C60 87 58 87 56 85L50 79L44 85C42 87 40 87 38 85L31 78L25 84C22 87 18 86 18 82V48C18 28 30 12 50 12Z",
    eyes: { x: 50, y: 44, spacing: 18, scale: 1.2 }
  },
  {
    key: "cat",
    name: "Cat",
    path: "M18 40L20 14C20 11 23 10 25 12L40 26C46 24 54 24 60 26L75 12C77 10 80 11 80 14L82 40C88 50 88 64 82 74C74 86 62 88 50 88C38 88 26 86 18 74C12 64 12 50 18 40Z",
    eyes: { x: 50, y: 54, spacing: 20, scale: 1.2 }
  },
  {
    key: "bean",
    name: "Bean",
    path: "M50 10C64 10 72 20 72 34V66C72 80 64 90 50 90C36 90 28 80 28 66V34C28 20 36 10 50 10Z",
    eyes: { x: 50, y: 40, spacing: 15, scale: 1.1 }
  },
  {
    key: "cube",
    name: "Cube",
    path: "M24 18H76A8 8 0 0 1 84 26V78A8 8 0 0 1 76 86H24A8 8 0 0 1 16 78V26A8 8 0 0 1 24 18Z",
    eyes: { x: 50, y: 48, spacing: 20, scale: 1.3 }
  },
  {
    key: "cloud",
    name: "Cloud",
    path: "M30 78C18 78 10 70 10 60C10 50 17 43 27 42C28 28 38 20 50 20C61 20 69 27 72 36C83 36 90 45 90 56C90 68 82 78 70 78Z",
    eyes: { x: 50, y: 54, spacing: 18, scale: 1.2 }
  },
  {
    key: "screen",
    name: "Screen",
    path: "M20 16H80A6 6 0 0 1 86 22V62A6 6 0 0 1 80 68H20A6 6 0 0 1 14 62V22A6 6 0 0 1 20 16Z M44 66H56V79H44Z M32 78H68A4 4 0 0 1 72 82V86H28V82A4 4 0 0 1 32 78Z",
    eyes: { x: 50, y: 42, spacing: 20, scale: 1.25 }
  },
  {
    key: "rocket",
    name: "Rocket",
    path: "M50 8C62 18 68 34 68 52V74H32V52C32 34 38 18 50 8Z M33 54L20 68V82L33 74Z M67 54V74L80 82V68Z M42 74H58L54 86H46Z",
    eyes: { x: 50, y: 44, spacing: 14, scale: 1 }
  },
  {
    key: "note",
    name: "Note",
    path: "M24 12H62L80 30V84A4 4 0 0 1 76 88H24A4 4 0 0 1 20 84V16A4 4 0 0 1 24 12Z",
    eyes: { x: 48, y: 50, spacing: 18, scale: 1.2 }
  },
  {
    key: "heart",
    name: "Heart",
    path: "M50 86C34 74 12 60 12 38C12 24 22 14 34 14C42 14 47 18 50 24C53 18 58 14 66 14C78 14 88 24 88 38C88 60 66 74 50 86Z",
    eyes: { x: 50, y: 42, spacing: 18, scale: 1.2 }
  },
  {
    key: "controller",
    name: "Controller",
    path: "M28 22C38 20 44 23 50 23C56 23 62 20 72 22C84 24 90 34 91 48C92 62 91 76 82 80C75 83 69 78 66 72C63 67 58 66 50 66C42 66 37 67 34 72C31 78 25 83 18 80C9 76 8 62 9 48C10 34 16 24 28 22Z",
    eyes: { x: 50, y: 42, spacing: 16, scale: 1.05 }
  },
  {
    key: "mug",
    name: "Mug",
    path: "M22 20H62C67 20 70 23 70 28V72C70 80 64 86 56 86H28C20 86 14 80 14 72V28C14 23 17 20 22 20Z M68 36C80 34 87 42 87 53C87 64 80 72 68 70Z M69 45L69 61C75.5 62 79 58.5 79 53C79 47.5 76 44 69 45Z",
    eyes: { x: 42, y: 49, spacing: 16, scale: 1.15 }
  },
  {
    key: "lightbulb",
    name: "Lightbulb",
    path: "M36 72V66C36 60 18 55 18 40A32 32 0 0 1 82 40C82 55 64 60 64 66V72Z M36 68H64V77A4 4 0 0 1 60 81H40A4 4 0 0 1 36 77Z M43 78H57V84A4 4 0 0 1 53 88H47A4 4 0 0 1 43 84Z",
    eyes: { x: 50, y: 40, spacing: 17, scale: 1.2 }
  },
  {
    key: "chat",
    name: "Chat",
    path: "M28 14H72C82 14 90 22 90 32V54C90 64 82 72 72 72H42L25 86C23.5 87.3 21.5 86 22.3 84L27 71.5C17 70 10 63 10 54V32C10 22 18 14 28 14Z",
    eyes: { x: 50, y: 42, spacing: 18, scale: 1.25 }
  },
  {
    key: "sprout",
    name: "Sprout",
    path: "M49.5 19H50.5A3 3 0 0 1 53.5 22V46H46.5V22A3 3 0 0 1 49.5 19Z M49 38C36 41 22.5 36 17.6 23.4A1.4 1.4 0 0 1 18.4 21.6C29 17.5 41.5 21.5 49 34Z M51 30C57 14.5 72 8.5 82.6 11.8A1.4 1.4 0 0 1 83.5 13.4C80.5 27.5 66 35.5 51 34Z M24 44H76A4 4 0 0 1 80 48V54A4 4 0 0 1 76 58H24A4 4 0 0 1 20 54V48A4 4 0 0 1 24 44Z M24 56H76L71 84C70.4 87.5 68 90 64.5 90H35.5C32 90 29.6 87.5 29 84Z",
    eyes: { x: 50, y: 71, spacing: 16, scale: 1.05 }
  },
  {
    key: "watering-can",
    name: "Watering can",
    path: "M32 38H62C68 38 71 41 72 47L74 76C74.5 82 70 86 64 86H30C24 86 19.5 82 20 76L22 47C23 41 26 38 32 38Z M23 63C14 63 8.5 57 8.5 48C8.5 37 13 30.5 19 30.5C25 30.5 28.5 34 30 39.5L26 52Z M23.5 42C22 38 20 36 17.5 36C15 36 14 41 14 48C14 54 16 57.5 22 58L23.5 47Z M69 66C75 61 78 55 80 46.5L88 49.5C85 62 80 73 72 81Z M78.7 43A7 4.5 25 0 1 91.3 49A7 4.5 25 0 1 78.7 43Z",
    eyes: { x: 47, y: 61, spacing: 16, scale: 1.15 }
  }
] as const

export type Body = (typeof BODIES)[number]
export type Eyes = (typeof EYES)[number]
export type Mouth = (typeof MOUTHS)[number]
export type Extra = (typeof EXTRAS)[number]
export type Material = (typeof MATERIALS)[number]
export type Skin = keyof typeof SKINS
export type ShapeKey = (typeof SHAPES)[number]["key"]

/** A shape a chat drew: an Open Bot Avatar definition's name, silhouette, and eyes. */
export interface CustomShape {
  readonly name: string
  /** One filled SVG path in a 0 0 100 100 box, geometry within 8–92; holes wind opposite to their outline. */
  readonly path: string
  /** The eye pair's center, center-to-center distance, and size (1: about 4 by 11 units each). */
  readonly eyes: { readonly x: number; readonly y: number; readonly spacing: number; readonly scale: number }
}

export interface SidekickLook {
  /** One of `SHAPES`, or `custom` for `custom`. */
  readonly shape: ShapeKey | "custom"
  /** The shape when `shape` is custom. */
  readonly custom?: CustomShape | null
  /** The face's color. */
  readonly skin: Skin
  /** The body's finish: flat (solid color, default when absent on older looks), fluffy (brushed fur), or glass. */
  readonly material?: Material
  // For apps from before Open Bot Avatar (see the top of this file).
  readonly body: Body
  readonly eyes: Eyes
  readonly mouth: Mouth
  readonly extra: Extra
  readonly blush: boolean
  readonly finish?: number | null
}

/** A BoopFace finish number: apps from before Open Bot Avatar show a look's saved picture when it has one. */
export const LEGACY_FINISH = 101

/** The longest silhouette a custom shape may have, in characters. */
export const CUSTOM_PATH_LIMIT = 4000

const shapeKeys = SHAPES.map((shape) => shape.key) as ReadonlyArray<ShapeKey>
const SHAPE_BY_KEY = new Map<string, (typeof SHAPES)[number]>(SHAPES.map((shape) => [shape.key, shape]))
const SKIN_KEYS = Object.keys(SKINS) as ReadonlyArray<Skin>
const SKIN_SET = new Set<string>(SKIN_KEYS)
const MATERIAL_SET = new Set<string>(MATERIALS)

/** The older apps' body nearest a shape, and the shape for an older app's body. */
const BODY_OF: Partial<Record<ShapeKey, Body>> = { bot: "bot", blob: "blob", ghost: "ghost", cat: "cat", bean: "bean", cube: "cube" }
const shapeOfBody = (body: unknown): ShapeKey => (typeof body === "string" && SHAPE_BY_KEY.has(body) && BODY_OF[body as ShapeKey] ? (body as ShapeKey) : "bot")

/** A custom shape checked by Open Bot Avatar's validator, or null. */
export const cleanCustom = (value: unknown): CustomShape | null => {
  if (!value || typeof value !== "object") return null
  const shape = value as Record<string, unknown>
  const eyes = (shape.eyes ?? {}) as Record<string, unknown>
  const name = typeof shape.name === "string" && shape.name.trim() ? shape.name.trim().replace(/[<>]/g, "").slice(0, 40) : "Custom"
  if (typeof shape.path !== "string" || shape.path.length > CUSTOM_PATH_LIMIT) return null
  const custom: CustomShape = {
    name,
    path: shape.path,
    eyes: { x: Number(eyes.x), y: Number(eyes.y), spacing: Number(eyes.spacing), scale: Number(eyes.scale ?? 1) }
  }
  return validateAvatar(definitionOf(custom, "custom")).ok ? custom : null
}

/** Why a custom shape doesn't validate (for chats drawing one), or null when it does. */
export const customShapeErrors = (custom: CustomShape): string[] | null => {
  const result = validateAvatar(definitionOf(custom, "custom"))
  return result.ok ? null : result.errors
}

/** A look's shape as an Open Bot Avatar definition. */
export function definitionOf(shape: CustomShape | (typeof SHAPES)[number], id = "key" in shape ? shape.key : "custom"): AvatarDefinition {
  return { version: 1, id, name: shape.name, body: { path: shape.path }, eyes: { ...shape.eyes } }
}

/** The definition a look draws: its custom shape, or one of Dex's (the first, for one this build doesn't know). */
export const lookDefinition = (look: Pick<SidekickLook, "shape" | "custom">): AvatarDefinition => {
  if (look.shape === "custom" && look.custom) return definitionOf(look.custom)
  return definitionOf(SHAPE_BY_KEY.get(look.shape) ?? SHAPES[0])
}

/** A look's shape name, for people and models. */
export const shapeName = (look: Pick<SidekickLook, "shape" | "custom">) =>
  look.shape === "custom" ? (look.custom?.name ?? "Custom") : (SHAPE_BY_KEY.get(look.shape)?.name ?? SHAPES[0].name)

/** A look's material, defaulting to flat when absent (looks saved before materials existed). */
export const lookMaterial = (look?: Pick<SidekickLook, "material"> | null): Material =>
  typeof look?.material === "string" && MATERIAL_SET.has(look.material) ? (look.material as Material) : "flat"

/** A look of `shape` in `skin`, with `material` and the older apps' parts filled in. */
export const makeLook = (shape: ShapeKey | "custom", skin: Skin, custom: CustomShape | null = null, material: Material = "flat"): SidekickLook => ({
  shape: shape === "custom" && !custom ? "bot" : shape,
  custom: shape === "custom" ? custom : null,
  skin,
  material: MATERIAL_SET.has(material) ? material : "flat",
  body: shape === "custom" ? "blob" : (BODY_OF[shape] ?? "blob"),
  eyes: "round",
  mouth: "smile",
  extra: "none",
  blush: false,
  finish: LEGACY_FINISH
})

/**
 * A look from anything: unknown values fall back, so a bad value never breaks a page. Null if it isn't one at all. A
 * look without `shape` (from an app released before Open Bot Avatar) keeps `previous`'s shape, or takes the one
 * nearest its body; one without `material` (from an app released before materials) keeps `previous`'s material; such an
 * app's color is kept.
 */
export const cleanLook = (value: unknown, previous?: SidekickLook | null): SidekickLook | null => {
  if (!value || typeof value !== "object") return null
  const look = value as Record<string, unknown>
  const skin = typeof look.skin === "string" && SKIN_SET.has(look.skin) ? (look.skin as Skin) : "peach"
  const material: Material =
    typeof look.material === "string" && MATERIAL_SET.has(look.material)
      ? (look.material as Material)
      : !("material" in look) && previous
        ? lookMaterial(previous)
        : "flat"
  if (look.shape === "custom") {
    const custom = cleanCustom(look.custom) ?? (previous?.shape === "custom" ? (previous.custom ?? null) : null)
    return custom ? makeLook("custom", skin, custom, material) : makeLook("bot", skin, null, material)
  }
  if (typeof look.shape === "string" && SHAPE_BY_KEY.has(look.shape)) return makeLook(look.shape as ShapeKey, skin, null, material)
  if (previous) return makeLook(previous.shape, skin, previous.custom ?? null, material)
  return makeLook(shapeOfBody(look.body), skin, null, material)
}

/** A look's shape, color, and material, for comparing. */
export const sameLook = (a: SidekickLook | null | undefined, b: SidekickLook | null | undefined) =>
  Boolean(a && b) &&
  a!.shape === b!.shape &&
  a!.skin === b!.skin &&
  lookMaterial(a) === lookMaterial(b) &&
  (a!.shape !== "custom" || a!.custom?.path === b!.custom?.path)

export const randomLook = (random = Math.random): SidekickLook => {
  const any = <T>(options: ReadonlyArray<T>) => options[Math.floor(random() * options.length)]!
  return makeLook(any(shapeKeys), any(SKIN_KEYS), null, any(MATERIALS))
}

/** Ready-made sidekicks to pick from, each with an accent color (an agent color key). Keys are stored; keep them. */
export const LOOK_PRESETS: ReadonlyArray<{ readonly key: string; readonly name: string; readonly color: string; readonly look: SidekickLook }> = [
  { key: "boop", name: "Boop", color: "orange", look: makeLook("bot", "peach") },
  { key: "muse", name: "Muse", color: "violet", look: makeLook("lightbulb", "pink") },
  { key: "atlas", name: "Atlas", color: "sky", look: makeLook("cloud", "sky") },
  { key: "sage", name: "Sage", color: "teal", look: makeLook("sprout", "mint") },
  { key: "rex", name: "Rex", color: "rose", look: makeLook("controller", "coral") },
  { key: "byte", name: "Byte", color: "zinc", look: makeLook("screen", "slate") },
  { key: "mochi", name: "Mochi", color: "rose", look: makeLook("cat", "cloud") },
  { key: "nova", name: "Nova", color: "violet", look: makeLook("rocket", "lilac") },
  { key: "pip", name: "Pip", color: "emerald", look: makeLook("blob", "lemon") },
  { key: "duke", name: "Duke", color: "amber", look: makeLook("mug", "peach") },
  { key: "fern", name: "Fern", color: "emerald", look: makeLook("watering-can", "teal") },
  { key: "ziggy", name: "Ziggy", color: "sky", look: makeLook("ghost", "lilac") },
  { key: "bolt", name: "Bolt", color: "amber", look: makeLook("cube", "lemon") }
]

/**
 * What a face shows. Still for many at once (a list of messages, notifications); idle breathes, blinks, and looks
 * around; thinking turns into three hopping dots; working bends over the work. When thinking or working ends, it
 * celebrates, or shows an exclamation mark if it failed.
 */
export type LookMood = "still" | "idle" | "thinking" | "working"
