import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { test } from "node:test"
import { DIZIONE_COMMIT, type Dizione, loadDizione, SYMBOLS } from "../src/server/voice/dizione/index.ts"

// tiny-voca's files at the revision Dex uses, downloaded once into a gitignored cache.
const REVISION = "e5f9b11651a4db525fb207a56a91e4df2d1dd387"
const CACHE = new URL(`./.cache/tiny-voca-${REVISION}/`, import.meta.url)

async function file(path: string): Promise<Uint8Array> {
  const local = new URL(path, CACHE)
  try {
    return new Uint8Array(readFileSync(local))
  } catch {
    const response = await fetch(`https://huggingface.co/n4ze3m/tiny-voca/resolve/${REVISION}/${path}`)
    if (!response.ok) throw new Error(`${path}: ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    mkdirSync(new URL(".", local), { recursive: true })
    writeFileSync(local, bytes)
    return bytes
  }
}

/** What the Python dizione gave (scripts/build-dizione-fixture.py): str(result), null, or "!" and an exception. */
const fixture: { dizione: string; cases: [string, string | null][] } = JSON.parse(readFileSync(new URL("./fixtures/dizione.json", import.meta.url), "utf8"))

let loaded: Promise<Dizione> | undefined
const dizione = () => (loaded ??= loadDizione((name) => file(`phonemizer/${name}`)))

test("the symbols are the model's vocabulary, in order", async () => {
  const config = JSON.parse(new TextDecoder().decode(await file("config.json")))
  assert.deepEqual(Object.entries(config.vocab as Record<string, number>).sort(([, a], [, b]) => a - b).map(([symbol]) => symbol), SYMBOLS)
  assert.equal(config.phonemizer.name, "dizione")
})

test("the fixture comes from the dizione commit the port follows", () => {
  assert.equal(fixture.dizione, DIZIONE_COMMIT)
  assert.ok(fixture.cases.length > 3000)
})

test("every text gives what the Python dizione gives", async () => {
  const config = JSON.parse(new TextDecoder().decode(await file("config.json")))
  const vocab = config.vocab as Record<string, number>
  const started = performance.now()
  const phonemizer = await dizione()
  console.log(`loaded in ${(performance.now() - started).toFixed(0)} ms`)
  const failures: string[] = []
  const timing = performance.now()
  for (const [text, expected] of fixture.cases) {
    let got: string | null
    try {
      const result = phonemizer.phonemize(text)
      got = result && result.text
      if (result && result.text === expected) {
        // The ids and the stress must say the same as the text: the model's ids from config.json, the marks.
        const units = expected.split(" ")
        const ids = units.map((unit) => vocab[unit.replace(/^[ˈˌ]/, "")])
        const stress = units.map((unit) => (unit.startsWith("ˈ") ? 1 : unit.startsWith("ˌ") ? 2 : 0))
        if (JSON.stringify(result.ids) !== JSON.stringify(ids)) got = `ids ${result.ids.join(",")}`
        else if (JSON.stringify(result.stress) !== JSON.stringify(stress)) got = `stress ${result.stress.join(",")}`
      }
    } catch (error) {
      got = "!" + (error instanceof Error ? error.name : "Error")
      if (!expected?.startsWith("!")) got += ` ${error instanceof Error ? error.stack : error}`
    }
    if (got !== expected) failures.push(`${JSON.stringify(text)}\n  python: ${expected}\n  port:   ${got}`)
  }
  const elapsed = performance.now() - timing
  console.log(`${fixture.cases.length - failures.length}/${fixture.cases.length} match, ${(elapsed / fixture.cases.length).toFixed(2)} ms per text`)
  assert.equal(failures.length, 0, failures.slice(0, 20).join("\n"))
})
