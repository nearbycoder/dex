import assert from "node:assert/strict"
import { test } from "node:test"
import { faceRgba, facePng, flattenPath } from "../src/agent/sidekick-face.ts"
import { cleanLook, customShapeErrors, LEGACY_FINISH, LOOK_PRESETS, lookMaterial, makeLook, sameLook, SHAPES } from "../src/shared/sidekick-look.ts"

test("path data flattens with relative commands, curves, and arcs", () => {
  const square = flattenPath("M10 10h20v20H10z")
  assert.deepEqual(square[0]!.slice(0, 4), [[10, 10], [30, 10], [30, 30], [10, 30]])
  // A circle from two arcs, its points all on it.
  const [circle] = flattenPath("M40 50A10 10 0 0 1 60 50A10 10 0 0 1 40 50Z")
  for (const [x, y] of circle!) assert.ok(Math.abs(Math.hypot(x - 50, y - 50) - 10) < 1e-6)
  // q, t, and numbers run together, as Open Bot Avatar writes them.
  const [smooth] = flattenPath("M25.88 17.11q-.68.09-1.13.19t-1.32.38-1.35.48Z")
  assert.ok(smooth!.length > 4)
  assert.throws(() => flattenPath("M10 10 X 4"))
})

test("every shape and ready-made look draws, the eyes dark on the face's color", async () => {
  for (const shape of SHAPES) {
    const pixels = faceRgba(makeLook(shape.key, "peach"), 64)
    let face = 0
    let eye = 0
    for (let at = 0; at < pixels.length; at += 4) {
      if (pixels[at + 3] !== 255) continue
      if (pixels[at] === 0xff && pixels[at + 1] === 0x6a) face++
      if (pixels[at] === 0x15) eye++
    }
    assert.ok(face > 600, `${shape.key} has a body`)
    assert.ok(eye > 10, `${shape.key} has eyes`)
  }
  for (const preset of LOOK_PRESETS) {
    const url = await facePng(preset.look)
    assert.match(url, /^data:image\/png;base64,iVBORw0KGgo/)
    assert.ok(url.length < 48 * 1024)
  }
})

test("looks from older apps keep their shape, and always tell older apps to show the picture", () => {
  const robot = makeLook("mug", "sky")
  // An app from before Open Bot Avatar sends parts and a color, no shape.
  const fromOldApp = cleanLook({ body: "cat", skin: "pink", eyes: "dot", mouth: "smile", extra: "none", blush: false, finish: null }, robot)
  assert.equal(fromOldApp?.shape, "mug")
  assert.equal(fromOldApp?.skin, "pink")
  assert.equal(fromOldApp?.finish, LEGACY_FINISH)
  // With nothing before it, the shape nearest its body.
  assert.equal(cleanLook({ body: "ghost", skin: "mint" })?.shape, "ghost")
  assert.equal(cleanLook({ shape: "nope", skin: "nope" })?.shape, "bot")
  assert.equal(cleanLook("robot"), null)
})

test("a custom shape is checked by Open Bot Avatar's validator", () => {
  const box = { name: "Box", path: "M20 20 H80 V80 H20 Z", eyes: { x: 50, y: 46, spacing: 15, scale: 1 } }
  assert.equal(customShapeErrors(box), null)
  assert.equal(cleanLook({ shape: "custom", custom: box, skin: "teal" })?.custom?.path, box.path)
  const outside = { ...box, path: "M0 0 H100 V100 H0 Z" }
  assert.ok(customShapeErrors(outside)?.some((error) => error.includes("safe area")))
  // One that can't be drawn falls back rather than breaking a page.
  assert.equal(cleanLook({ shape: "custom", custom: outside, skin: "teal" })?.shape, "bot")
})

test("fluffy and glass materials round-trip, default to flat, and survive older apps", () => {
  const fluffy = makeLook("cat", "sky", null, "fluffy")
  const glass = makeLook("cat", "sky", null, "glass")
  assert.equal(fluffy.material, "fluffy")
  assert.equal(glass.material, "glass")
  assert.equal(lookMaterial(fluffy), "fluffy")
  assert.equal(lookMaterial(glass), "glass")
  assert.equal(sameLook(fluffy, makeLook("cat", "sky", null, "flat")), false)
  assert.equal(sameLook(fluffy, glass), false)
  assert.equal(sameLook(glass, makeLook("cat", "sky", null, "flat")), false)
  assert.equal(sameLook(fluffy, makeLook("cat", "sky", null, "fluffy")), true)
  assert.equal(sameLook(glass, makeLook("cat", "sky", null, "glass")), true)
  // Older apps that don't send `material` keep a sidekick's material when editing color or shape.
  assert.equal(cleanLook({ shape: "mug", skin: "pink" }, fluffy)?.material, "fluffy")
  assert.equal(cleanLook({ shape: "mug", skin: "pink" }, glass)?.material, "glass")
  // Explicitly switching back to flat clears it; unknown materials fall back to flat.
  assert.equal(cleanLook({ shape: "cat", skin: "sky", material: "flat" }, fluffy)?.material, "flat")
  assert.equal(cleanLook({ shape: "cat", skin: "sky", material: "flat" }, glass)?.material, "flat")
  assert.equal(cleanLook({ shape: "cat", skin: "sky", material: "velvet" }, glass)?.material, "flat")
  // Without a previous look, missing material defaults to flat.
  assert.equal(cleanLook({ shape: "cat", skin: "sky" })?.material, "flat")
  // Custom shapes can be fluffy or glass too.
  const box = { name: "Box", path: "M20 20 H80 V80 H20 Z", eyes: { x: 50, y: 46, spacing: 15, scale: 1 } }
  assert.equal(cleanLook({ shape: "custom", custom: box, skin: "coral", material: "fluffy" })?.material, "fluffy")
  assert.equal(cleanLook({ shape: "custom", custom: box, skin: "coral", material: "glass" })?.material, "glass")
})
