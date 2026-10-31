/**
 * A sidekick's face: a little character built from parts (a body, eyes, a mouth, an extra, a body color) on their
 * background color. Drawn as SVG from this one description, so every size stays crisp; apps that can't draw it show
 * the PNG snapshot saved with it (`CharacterProfile.image`).
 */

export const BODIES = ["blob", "bean", "cube", "ghost", "cat", "bot"] as const
export const EYES = ["dot", "round", "sparkle", "happy", "sleepy", "wink", "visor"] as const
export const MOUTHS = ["smile", "grin", "tongue", "purr", "o", "flat"] as const
export const EXTRAS = ["none", "headphones", "glasses", "beanie", "beret", "crown", "sprout", "bow", "wizard", "headband"] as const

/** Body colors, chosen to sit well on every background color. */
export const SKINS = {
  mint: "#6ee7b7",
  sky: "#7dd3fc",
  lilac: "#c4b5fd",
  pink: "#f9a8d4",
  peach: "#fdba74",
  lemon: "#fde68a",
  coral: "#fca5a5",
  teal: "#5eead4",
  cloud: "#e4e4e7",
  slate: "#94a3b8"
} as const

export type Body = (typeof BODIES)[number]
export type Eyes = (typeof EYES)[number]
export type Mouth = (typeof MOUTHS)[number]
export type Extra = (typeof EXTRAS)[number]
export type Skin = keyof typeof SKINS

export interface SidekickLook {
  readonly body: Body
  readonly skin: Skin
  readonly eyes: Eyes
  readonly mouth: Mouth
  readonly extra: Extra
  readonly blush: boolean
}

export const LABELS: Record<Body | Eyes | Mouth | Extra, string> = {
  blob: "Blob", bean: "Bean", cube: "Cube", ghost: "Ghost", cat: "Cat", bot: "Bot",
  dot: "Dots", round: "Round", sparkle: "Sparkle", happy: "Happy", sleepy: "Calm", wink: "Wink", visor: "Visor",
  smile: "Smile", grin: "Grin", tongue: "Silly", purr: "Purr", o: "Ooh", flat: "Deadpan",
  none: "None", headphones: "Headphones", glasses: "Glasses", beanie: "Beanie", beret: "Beret", crown: "Crown", sprout: "Sprout", bow: "Bow", wizard: "Wizard hat", headband: "Headband"
}

/** A look from anything: unknown parts fall back, so a bad value never breaks a page. Null if it isn't one at all. */
export const cleanLook = (value: unknown): SidekickLook | null => {
  if (!value || typeof value !== "object") return null
  const look = value as Record<string, unknown>
  const pick = <T extends string>(options: ReadonlyArray<T>, part: unknown) => (options.includes(part as T) ? (part as T) : options[0]!)
  return {
    body: pick(BODIES, look.body),
    skin: pick(Object.keys(SKINS) as Skin[], look.skin),
    eyes: pick(EYES, look.eyes),
    mouth: pick(MOUTHS, look.mouth),
    extra: pick(EXTRAS, look.extra),
    blush: look.blush === true
  }
}

export const randomLook = (random = Math.random): SidekickLook => {
  const any = <T>(options: ReadonlyArray<T>) => options[Math.floor(random() * options.length)]!
  const body = any(BODIES)
  return {
    body,
    skin: any(Object.keys(SKINS) as Skin[]),
    eyes: body === "bot" && random() < 0.5 ? "visor" : any(EYES.filter((eyes) => eyes !== "visor")),
    mouth: any(MOUTHS),
    extra: random() < 0.25 ? "none" : any(EXTRAS.filter((extra) => extra !== "none")),
    blush: random() < 0.6
  }
}

/** Ready-made sidekicks to pick from, each with a background color (an agent color key). */
export const LOOK_PRESETS: ReadonlyArray<{ readonly key: string; readonly name: string; readonly color: string; readonly look: SidekickLook }> = [
  { key: "muse", name: "Muse", color: "violet", look: { body: "blob", skin: "pink", eyes: "sparkle", mouth: "grin", extra: "beret", blush: true } },
  { key: "atlas", name: "Atlas", color: "sky", look: { body: "cube", skin: "cloud", eyes: "round", mouth: "smile", extra: "glasses", blush: false } },
  { key: "sage", name: "Sage", color: "teal", look: { body: "ghost", skin: "mint", eyes: "sleepy", mouth: "smile", extra: "sprout", blush: true } },
  { key: "rex", name: "Rex", color: "orange", look: { body: "bean", skin: "peach", eyes: "happy", mouth: "grin", extra: "headband", blush: false } },
  { key: "byte", name: "Byte", color: "zinc", look: { body: "bot", skin: "sky", eyes: "visor", mouth: "flat", extra: "headphones", blush: false } },
  { key: "mochi", name: "Mochi", color: "rose", look: { body: "cat", skin: "cloud", eyes: "dot", mouth: "purr", extra: "bow", blush: true } },
  { key: "nova", name: "Nova", color: "violet", look: { body: "bean", skin: "lilac", eyes: "sparkle", mouth: "o", extra: "wizard", blush: true } },
  { key: "pip", name: "Pip", color: "emerald", look: { body: "blob", skin: "lemon", eyes: "wink", mouth: "tongue", extra: "none", blush: true } },
  { key: "duke", name: "Duke", color: "amber", look: { body: "cube", skin: "coral", eyes: "round", mouth: "smile", extra: "crown", blush: false } },
  { key: "fern", name: "Fern", color: "emerald", look: { body: "cat", skin: "teal", eyes: "happy", mouth: "smile", extra: "sprout", blush: true } },
  { key: "ziggy", name: "Ziggy", color: "sky", look: { body: "ghost", skin: "lilac", eyes: "dot", mouth: "o", extra: "beanie", blush: false } },
  { key: "bolt", name: "Bolt", color: "amber", look: { body: "bot", skin: "slate", eyes: "round", mouth: "grin", extra: "none", blush: false } }
]

// ── Drawing ─────────────────────────────────────────────────────────────────
// On a 100×100 canvas. Every body puts its face at the same place (eyes on y≈52, mouth on y≈66), and says where
// its head starts so hats sit on it.

const INK = "#1e1b2e"

const BODY_SHAPES: Record<Body, { readonly path: string; readonly top: number; readonly extra?: string }> = {
  blob: { top: 24, path: "M50 24C71 24 80 37 80 56C80 75 68 86 50 86C32 86 20 75 20 56C20 37 29 24 50 24Z" },
  bean: { top: 20, path: "M50 20C67 20 76 32 76 50V64C76 79 66 88 50 88C34 88 24 79 24 64V50C24 32 33 20 50 20Z" },
  cube: { top: 27, path: "M36 27H64C73 27 79 33 79 42V70C79 79 73 85 64 85H36C27 85 21 79 21 70V42C21 33 27 27 36 27Z" },
  ghost: {
    top: 22,
    path: "M23 54C23 34 35 22 50 22C65 22 77 34 77 54V84C77 87 74 88 72 86L67 81L61 86C59 88 57 88 55 86L50 81L45 86C43 88 41 88 39 86L33 81L28 86C26 88 23 87 23 84Z"
  },
  cat: {
    top: 28,
    path: "M50 28C70 28 80 41 80 58C80 76 67 86 50 86C33 86 20 76 20 58C20 41 30 28 50 28Z",
    extra: "M24 44L27 17C27.4 14.6 30 13.8 31.7 15.5L45 30ZM76 44L73 17C72.6 14.6 70 13.8 68.3 15.5L55 30Z"
  },
  bot: { top: 31, path: "M34 31H66C74 31 79 36 79 44V71C79 79 74 84 66 84H34C26 84 21 79 21 71V44C21 36 26 31 34 31Z" }
}

const eyesSvg = (eyes: Eyes, skin: string) => {
  const dot = (x: number, r = 4.2) => `<circle cx="${x}" cy="52" r="${r}" fill="${INK}"/><circle cx="${x + r * 0.35}" cy="${52 - r * 0.35}" r="${r * 0.33}" fill="#fff"/>`
  const arc = (x: number, up: boolean) =>
    `<path d="M${x - 5} ${up ? 54 : 51}Q${x} ${up ? 47 : 56} ${x + 5} ${up ? 54 : 51}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`
  switch (eyes) {
    case "dot":
      return dot(40) + dot(60)
    case "round":
      return [40, 60].map((x) => `<ellipse cx="${x}" cy="52" rx="6.3" ry="6.8" fill="#fff"/><circle cx="${x + 0.8}" cy="53" r="3.6" fill="${INK}"/><circle cx="${x + 2}" cy="51.6" r="1.2" fill="#fff"/>`).join("")
    case "sparkle":
      return [40, 60].map((x) => `<ellipse cx="${x}" cy="52" rx="5" ry="6" fill="${INK}"/><circle cx="${x + 1.6}" cy="49.6" r="1.9" fill="#fff"/><circle cx="${x - 1.6}" cy="55" r="0.9" fill="#fff"/>`).join("")
    case "happy":
      return arc(40, true) + arc(60, true)
    case "sleepy":
      return arc(40, false) + arc(60, false)
    case "wink":
      return dot(40) + arc(60, true)
    case "visor":
      return `<rect x="29" y="44.5" width="42" height="15" rx="7.5" fill="${INK}"/><rect x="35" y="49.5" width="8" height="5" rx="2.5" fill="${skin}"/><rect x="57" y="49.5" width="8" height="5" rx="2.5" fill="${skin}"/>`
  }
}

const mouthSvg = (mouth: Mouth) => {
  const line = (d: string) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
  switch (mouth) {
    case "smile":
      return line("M44 65Q50 70.5 56 65")
    case "grin":
      return `<path d="M42.5 63.5H57.5Q57 72 50 72Q43 72 42.5 63.5Z" fill="${INK}"/><path d="M45.5 69.6Q50 66.5 54.5 69.6Q52.6 71.8 50 71.8Q47.4 71.8 45.5 69.6Z" fill="#fb7185"/>`
    case "tongue":
      return `<path d="M47 66.5Q50 74 53 66.5Z" fill="#fb7185"/>${line("M43.5 65Q50 70 56.5 65")}`
    case "purr":
      return line("M43 65Q46.5 69 50 65Q53.5 69 57 65")
    case "o":
      return `<ellipse cx="50" cy="67" rx="3.2" ry="3.8" fill="${INK}"/>`
    case "flat":
      return line("M45 67H55")
  }
}

/** Headwear and face things. `top` is where the head starts; hats are drawn for a head starting at 24. */
const extraSvg = (extra: Extra, top: number) => {
  const hat = (svg: string) => `<g transform="translate(0 ${top - 24})">${svg}</g>`
  switch (extra) {
    case "none":
      return ""
    case "headphones":
      return `<path d="M20 54C20 30 33 ${top - 4} 50 ${top - 4}C67 ${top - 4} 80 30 80 54" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/><rect x="13" y="46" width="11" height="19" rx="5" fill="#f43f5e"/><rect x="76" y="46" width="11" height="19" rx="5" fill="#f43f5e"/>`
    case "glasses":
      return `<g fill="rgba(255,255,255,.18)" stroke="${INK}" stroke-width="2.6"><circle cx="40" cy="52" r="8.6"/><circle cx="60" cy="52" r="8.6"/></g><path d="M48.6 51Q50 49.6 51.4 51" fill="none" stroke="${INK}" stroke-width="2.6"/>`
    case "beanie":
      return hat(`<path d="M25 34C25 16 75 16 75 34Z" fill="#ef4444"/><rect x="23" y="30" width="54" height="9" rx="4.5" fill="#b91c1c"/><circle cx="50" cy="13" r="5.5" fill="#fef2f2"/>`)
    case "beret":
      return hat(`<path d="M24 31C25 18 58 11 76 23C72 30 44 34 24 31Z" fill="#1e1b2e"/><path d="M56 15L58 9" stroke="#1e1b2e" stroke-width="3" stroke-linecap="round"/>`)
    case "crown":
      return hat(`<path d="M32 27L34 9L43 19L50 6L57 19L66 9L68 27Z" fill="#fbbf24" stroke="#b45309" stroke-width="2" stroke-linejoin="round"/><circle cx="50" cy="20" r="2.4" fill="#ef4444"/>`)
    case "sprout":
      return hat(`<path d="M50 25V12" stroke="#16a34a" stroke-width="3" stroke-linecap="round"/><path d="M50 15C44 15 39 11 39 6C45 6 50 9 50 15Z" fill="#22c55e"/><path d="M50 13C55 13 61 9 61 4C55 4 50 7 50 13Z" fill="#4ade80"/>`)
    case "bow":
      return hat(`<path d="M64 24L56 17V31Z" fill="#ec4899"/><path d="M64 24L72 17V31Z" fill="#ec4899"/><circle cx="64" cy="24" r="3" fill="#be185d"/>`)
    case "wizard":
      return hat(`<path d="M27 30L55 0L72 30Z" fill="#6d28d9"/><rect x="22" y="27" width="56" height="7" rx="3.5" fill="#4c1d95"/><path d="M54 12L55.4 15.4L59 15.6L56.2 17.8L57.2 21.2L54 19.2L50.8 21.2L51.8 17.8L49 15.6L52.6 15.4Z" fill="#fde68a"/>`)
    case "headband":
      return hat(`<rect x="21" y="35" width="58" height="8" rx="2" fill="#ef4444"/><path d="M79 38L88 33L86 41Z M79 40L87 45L80 46Z" fill="#dc2626"/>`)
  }
}

/** The whole picture as an SVG document: a disc of `background` with the character on it. */
export const sidekickSvg = (look: SidekickLook, background: string) => {
  const skin = SKINS[look.skin] ?? SKINS.mint
  const shape = BODY_SHAPES[look.body] ?? BODY_SHAPES.blob
  const bot =
    look.body === "bot"
      ? `<path d="M50 31V19" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><circle cx="50" cy="16" r="4.5" fill="#f43f5e"/><rect x="15" y="50" width="7" height="12" rx="3" fill="${skin}"/><rect x="78" y="50" width="7" height="12" rx="3" fill="${skin}"/>`
      : ""
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`,
    `<defs><clipPath id="c"><circle cx="50" cy="50" r="50"/></clipPath></defs>`,
    `<g clip-path="url(#c)">`,
    `<rect width="100" height="100" fill="${background}"/>`,
    `<ellipse cx="50" cy="91" rx="25" ry="4" fill="#000" opacity=".22"/>`,
    // A little bigger than drawn, so faces read in the sidebar.
    `<g transform="translate(50 58) scale(1.08) translate(-50 -58)">`,
    look.extra === "headphones" ? "" : bot,
    shape.extra ? `<path d="${shape.extra}" fill="${skin}"/>` : "",
    `<path d="${shape.path}" fill="${skin}"/>`,
    // A soft shade along the bottom and a shine at the top left give the flat shape some roundness.
    `<path d="${shape.path}" fill="#000" opacity=".1" transform="translate(0 6) scale(1 .94)"/>`,
    `<path d="${shape.path}" fill="${skin}" transform="translate(0 -1.5)"/>`,
    `<ellipse cx="36" cy="${shape.top + 11}" rx="8" ry="4.5" fill="#fff" opacity=".35" transform="rotate(-24 36 ${shape.top + 11})"/>`,
    look.blush ? `<ellipse cx="31" cy="62" rx="5" ry="3" fill="#fb7185" opacity=".5"/><ellipse cx="69" cy="62" rx="5" ry="3" fill="#fb7185" opacity=".5"/>` : "",
    eyesSvg(look.eyes, skin),
    mouthSvg(look.mouth),
    look.extra === "headphones" ? bot : "",
    extraSvg(look.extra, shape.top),
    `</g></g></svg>`
  ].join("")
}
