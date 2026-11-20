// Draws the sidekick pictures the iPhone and Android apps bundle, with the agent's own renderer (src/agent/sidekick-face.ts),
// into assets/sidekicks and both apps' copies of it. Run it whenever SHAPES, SKINS, or LOOK_PRESETS change:
//   npm run sidekicks:assets -w @dex/web
//
//   presets.json, <preset>.png     the ready-made looks: key, name, accent color, look, and its picture
//   shapes.json, shapes/<shape>-body.png, shapes/<shape>-eyes.png
//                                  each shape's body in white (for the editors to tint any color) and its eyes, to lay
//                                  over it; shapes.json has the colors and where the eyes are (to blink them)
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { encodePng, faceOutlines, facePng, faceRgba } from "../src/agent/sidekick-face.ts"
import { EYE_INK, LOOK_PRESETS, makeLook, SHAPES, SKINS } from "../src/shared/sidekick-look.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const targets = [
  join(root, "assets/sidekicks"),
  join(root, "apps/ios/DexKit/Sources/DexCore/Resources/Sidekicks"),
  join(root, "apps/android/core/model/src/main/resources/dev/trydex/core/model/sidekicks")
]
const SIZE = 256

const files = new Map<string, Uint8Array | string>()
const png = (url: string) => Uint8Array.from(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"))

files.set(
  "presets.json",
  JSON.stringify(
    LOOK_PRESETS.map((preset) => ({ key: preset.key, name: preset.name, color: preset.color, look: preset.look, image: `${preset.key}.png` })),
    null,
    2
  ) + "\n"
)
for (const preset of LOOK_PRESETS) files.set(`${preset.key}.png`, png(await facePng(preset.look, SIZE)))

const shapes = []
for (const shape of SHAPES) {
  const look = makeLook(shape.key, "peach")
  files.set(`shapes/${shape.key}-body.png`, await encodePng(faceRgba(look, SIZE, "body"), SIZE, SIZE))
  files.set(`shapes/${shape.key}-eyes.png`, await encodePng(faceRgba(look, SIZE, "eyes"), SIZE, SIZE))
  // Where the eyes are, as fractions of the picture: they close toward their middle to blink.
  const points = faceOutlines(look).eyes.flatMap((outline) => outline.polygons.flat())
  const ys = points.map(([, y]) => y / 100)
  shapes.push({ key: shape.key, name: shape.name, eyes: { top: Math.min(...ys), bottom: Math.max(...ys) } })
}
files.set("shapes.json", JSON.stringify({ skins: SKINS, ink: EYE_INK, shapes }, null, 2) + "\n")

for (const target of targets) {
  // Everything here is generated; the README is kept.
  for (const name of ["shapes", ...LOOK_PRESETS.map((preset) => `${preset.key}.png`)]) rmSync(join(target, name), { recursive: true, force: true })
  mkdirSync(join(target, "shapes"), { recursive: true })
  for (const [name, data] of files) writeFileSync(join(target, name), data)
}
console.log(`Wrote ${files.size} files to ${targets.length} places.`)
