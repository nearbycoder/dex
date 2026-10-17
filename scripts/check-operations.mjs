// Every capability of the app must be reachable by chats and external agents (src/agent/operations.ts).
// Fails when a DexAgent @callable() is neither covered by an operation nor listed in EXCLUDED with a reason.
// Runs before every deploy (npm run deploy) and on its own with `npm run check:ops`.
import { readFileSync } from "node:fs"

const agent = readFileSync(new URL("../src/agent/dex-agent.ts", import.meta.url), "utf8")
const operations = readFileSync(new URL("../src/agent/operations.ts", import.meta.url), "utf8")

const callables = [...agent.matchAll(/@callable\(\)\s*(?:\/\*\*[\s\S]*?\*\/\s*)?(?:async\s+)?(\w+)\s*\(/g)].map((match) => match[1])
const covered = new Set([...operations.matchAll(/covers:\s*\[([^\]]*)\]/g)].flatMap((match) => [...match[1].matchAll(/"(\w+)"/g)].map((name) => name[1])))
const excludedBlock = /export const EXCLUDED[^{]*\{([\s\S]*?)\n\}/.exec(operations)?.[1] ?? ""
const excluded = new Set([...excludedBlock.matchAll(/^\s*(\w+):/gm)].map((match) => match[1]))

const missing = callables.filter((name) => !covered.has(name) && !excluded.has(name))
const stale = [...covered, ...excluded].filter((name) => !callables.includes(name))

if (stale.length) console.warn(`check:ops: no longer callables (remove from operations.ts): ${stale.join(", ")}`)
if (missing.length) {
  console.error(
    `check:ops: these DexAgent callables aren't available to chats or MCP:\n  ${missing.join("\n  ")}\n` +
      "Add an operation that covers each in src/agent/operations.ts, or list it in EXCLUDED with the reason."
  )
  process.exit(1)
}
console.log(`check:ops: all ${callables.length} callables are covered (${covered.size} by operations, ${excluded.size} excluded).`)
