#!/usr/bin/env node
// Bundles apps/ios/OpenUIEngine/engine.ts (on @openuidev/lang-core) into one script for JavaScriptCore:
// DexKit/Sources/DexCore/Resources/openui-engine.js. Run `npm ci` at the repo root first, then
// `node apps/ios/scripts/build-openui-engine.mjs`. Commit the built file.
//
// lang-core has opt-in PostHog telemetry: it needs fetch (JavaScriptCore has none) and an env flag, but the bundle
// strips it anyway, so nothing in the engine can reach the network.
import { build } from "esbuild"
import { statSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ios = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outfile = resolve(ios, "DexKit/Sources/DexCore/Resources/openui-engine.js")

/** Replaces lang-core's telemetry sender and its optional ci-info import with no-ops. */
const noTelemetry = {
  name: "no-telemetry",
  setup(build) {
    build.onResolve({ filter: /^ci-info$/ }, () => ({ path: "ci-info", namespace: "stub" }))
    build.onLoad({ filter: /^ci-info$/, namespace: "stub" }, () => ({ contents: "export const id = null; export const isCI = false", loader: "js" }))
    // zod re-exports every locale (260 KB); its messages only ever use English here.
    build.onResolve({ filter: /^\.\.\/locales\/index\.js$/ }, (args) =>
      /[\\/]zod[\\/]/.test(args.importer) ? { path: resolve(dirname(args.importer), "../locales/en.js"), namespace: "zod-locales" } : undefined
    )
    build.onLoad({ filter: /.*/, namespace: "zod-locales" }, (args) => ({
      contents: `export { default as en } from ${JSON.stringify(args.path)}`,
      resolveDir: dirname(args.path),
      loader: "js"
    }))
    build.onLoad({ filter: /@openuidev[\\/]lang-core[\\/]dist[\\/].*\.mjs$/ }, async (args) => {
      const { readFile } = await import("node:fs/promises")
      let source = await readFile(args.path, "utf8")
      const sender = /async function postCapture\(event, properties, runtime\) \{[\s\S]*?\n\}/
      if (args.path.endsWith("index.mjs")) {
        if (!sender.test(source)) throw new Error("lang-core's telemetry sender moved: update scripts/build-openui-engine.mjs")
        source = source.replace(sender, "async function postCapture() {}")
      }
      if (source.includes("globalThis.fetch(")) throw new Error(`${args.path} still calls fetch`)
      return { contents: source, loader: "js" }
    })
  }
}

await build({
  entryPoints: [resolve(ios, "OpenUIEngine/engine.ts")],
  outfile,
  bundle: true,
  format: "iife",
  platform: "neutral",
  mainFields: ["module", "main"],
  conditions: ["import", "default"],
  target: "es2022",
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  banner: { js: "// Built by apps/ios/scripts/build-openui-engine.mjs from apps/ios/OpenUIEngine/engine.ts. Don't edit." },
  plugins: [noTelemetry],
  logLevel: "warning"
})

console.log(`openui-engine.js: ${(statSync(outfile).size / 1024).toFixed(1)} KB`)
