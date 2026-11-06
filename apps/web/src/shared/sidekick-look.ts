/**
 * A sidekick's face: a BoopFace (github.com/CX-ArtLab/BoopFace), the little robot head with two big eyes, in a color
 * (`skin`) or one of BoopFace's finishes (`finish`, its skin number: glaze, jelly, metal, wood…). On the web it's live:
 * it blinks, follows the pointer, waits while the sidekick works and smiles when it's done. Apps that don't run it show
 * the PNG snapshot saved with it (`CharacterProfile.image`).
 *
 * The parts (body, eyes, mouth, extra, blush) are from before BoopFace, when looks were drawn from them. They're kept so
 * looks saved by older apps still read, and those apps' editors still work; the web no longer draws them.
 */

export const BODIES = ["blob", "bean", "cube", "ghost", "cat", "bot"] as const
export const EYES = ["dot", "round", "sparkle", "happy", "sleepy", "wink", "visor"] as const
export const MOUTHS = ["smile", "grin", "tongue", "purr", "o", "flat"] as const
export const EXTRAS = ["none", "headphones", "glasses", "beanie", "beret", "crown", "sprout", "bow", "wizard", "headband"] as const

/** Face colors, deep enough for BoopFace's white eyes. */
export const SKINS = {
  mint: "#10b981",
  sky: "#0ea5e9",
  lilac: "#8b5cf6",
  pink: "#ec4899",
  peach: "#f97316",
  lemon: "#eab308",
  coral: "#ef4444",
  teal: "#14b8a6",
  cloud: "#71717a",
  slate: "#3f3f46"
} as const

export type Body = (typeof BODIES)[number]
export type Eyes = (typeof EYES)[number]
export type Mouth = (typeof MOUTHS)[number]
export type Extra = (typeof EXTRAS)[number]
export type Skin = keyof typeof SKINS

export interface SidekickLook {
  readonly body: Body
  /** The face's color, shown when there's no finish. */
  readonly skin: Skin
  readonly eyes: Eyes
  readonly mouth: Mouth
  readonly extra: Extra
  readonly blush: boolean
  /** A BoopFace skin number (101–1717: the series, then two digits), or null for the plain color. */
  readonly finish?: number | null
}

/** BoopFace's finish series and their numbers, for descriptions (the picker reads the catalog from BoopFace itself). */
export const FINISH_SERIES =
  "Glaze 101–106, Ice glass 201–206, Gummy 301–312, Candy glass 401–406, Acrylic 501–512, Jelly 601–612, Gradient 701–712, Frosted glass 801–806, Metal 901–930, Gems and ceramics 1001–1012, Wood 1101–1106, Balls 1201–1210, Clear and shimmer 1301–1305, Fabric and leather 1401–1412, Sweets and fruit 1501–1512, Nature 1601–1612, Patterns and tech 1701–1717"

/** A finish number shaped like BoopFace's (series 1–17, then 01–30); anything else is the plain color. */
const cleanFinish = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 101 && value <= 1799 && value % 100 >= 1 && value % 100 <= 30 ? value : null

/**
 * A look from anything: unknown parts fall back, so a bad value never breaks a page. Null if it isn't one at all. A
 * look without `finish` (from an app that predates finishes) keeps `previous`'s.
 */
export const cleanLook = (value: unknown, previous?: SidekickLook | null): SidekickLook | null => {
  if (!value || typeof value !== "object") return null
  const look = value as Record<string, unknown>
  const pick = <T extends string>(options: ReadonlyArray<T>, part: unknown) => (options.includes(part as T) ? (part as T) : options[0]!)
  return {
    body: pick(BODIES, look.body),
    skin: pick(Object.keys(SKINS) as Skin[], look.skin),
    eyes: pick(EYES, look.eyes),
    mouth: pick(MOUTHS, look.mouth),
    extra: pick(EXTRAS, look.extra),
    blush: look.blush === true,
    finish: "finish" in look ? cleanFinish(look.finish) : (previous?.finish ?? null)
  }
}

/** Finishes a shuffle picks from: the ones that read well small. */
const SHUFFLE_FINISHES = [101, 102, 103, 104, 105, 106, 301, 303, 304, 305, 306, 310, 601, 603, 605, 701, 704, 706, 711, 901, 911, 926, 1003, 1101, 1503, 1504, 1505, 1603, 1606, 1702]

export const randomLook = (random = Math.random): SidekickLook => {
  const any = <T>(options: ReadonlyArray<T>) => options[Math.floor(random() * options.length)]!
  const body = any(BODIES)
  return {
    body,
    skin: any(Object.keys(SKINS) as Skin[]),
    eyes: body === "bot" && random() < 0.5 ? "visor" : any(EYES.filter((eyes) => eyes !== "visor")),
    mouth: any(MOUTHS),
    extra: random() < 0.25 ? "none" : any(EXTRAS.filter((extra) => extra !== "none")),
    blush: random() < 0.6,
    finish: random() < 0.6 ? any(SHUFFLE_FINISHES) : null
  }
}

/** Ready-made sidekicks to pick from, each with an accent color (an agent color key). */
export const LOOK_PRESETS: ReadonlyArray<{ readonly key: string; readonly name: string; readonly color: string; readonly look: SidekickLook }> = [
  { key: "boop", name: "Boop", color: "zinc", look: { body: "bot", skin: "slate", eyes: "round", mouth: "smile", extra: "none", blush: false, finish: null } },
  { key: "muse", name: "Muse", color: "violet", look: { body: "blob", skin: "pink", eyes: "sparkle", mouth: "grin", extra: "beret", blush: true, finish: 605 } },
  { key: "atlas", name: "Atlas", color: "sky", look: { body: "cube", skin: "cloud", eyes: "round", mouth: "smile", extra: "glasses", blush: false, finish: 102 } },
  { key: "sage", name: "Sage", color: "teal", look: { body: "ghost", skin: "mint", eyes: "sleepy", mouth: "smile", extra: "sprout", blush: true, finish: 202 } },
  { key: "rex", name: "Rex", color: "orange", look: { body: "bean", skin: "peach", eyes: "happy", mouth: "grin", extra: "headband", blush: false, finish: 306 } },
  { key: "byte", name: "Byte", color: "zinc", look: { body: "bot", skin: "sky", eyes: "visor", mouth: "flat", extra: "headphones", blush: false, finish: 1702 } },
  { key: "mochi", name: "Mochi", color: "rose", look: { body: "cat", skin: "cloud", eyes: "dot", mouth: "purr", extra: "bow", blush: true, finish: 1504 } },
  { key: "nova", name: "Nova", color: "violet", look: { body: "bean", skin: "lilac", eyes: "sparkle", mouth: "o", extra: "wizard", blush: true, finish: 1606 } },
  { key: "pip", name: "Pip", color: "emerald", look: { body: "blob", skin: "lemon", eyes: "wink", mouth: "tongue", extra: "none", blush: true, finish: 303 } },
  { key: "duke", name: "Duke", color: "amber", look: { body: "cube", skin: "coral", eyes: "round", mouth: "smile", extra: "crown", blush: false, finish: 901 } },
  { key: "fern", name: "Fern", color: "emerald", look: { body: "cat", skin: "teal", eyes: "happy", mouth: "smile", extra: "sprout", blush: true, finish: 1603 } },
  { key: "ziggy", name: "Ziggy", color: "sky", look: { body: "ghost", skin: "lilac", eyes: "dot", mouth: "o", extra: "beanie", blush: false, finish: 1303 } },
  { key: "bolt", name: "Bolt", color: "amber", look: { body: "bot", skin: "slate", eyes: "round", mouth: "grin", extra: "none", blush: false, finish: 926 } }
]

/** Still for many at once (a list of messages); idle blinks, glances and dozes off; working waits until it's done. */
export type LookMood = "still" | "idle" | "working"
