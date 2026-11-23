import assert from "node:assert/strict"
import { test } from "node:test"
import { webTools } from "../src/agent/tools/agents-tools.ts"

const api = { conversationId: "chat-1" } as never
const context = { abortSignal: new AbortController().signal } as never
const items = [{ url: "https://sqlite.org/wal.html", title: "Write-Ahead Logging", description: "WAL mode." }]
const ai = (search: () => Promise<unknown>) => ({ websearch: search }) as unknown as Ai
const run = async (tool: ReturnType<typeof webTools>[number], args: Record<string, unknown>) => {
  const result = (await tool.execute(args as never, api, context)) as { output: Array<{ text: string }>; isError?: boolean; details: Record<string, unknown> }
  return { text: result.output.map((part) => part.text).join(""), isError: result.isError ?? false, details: result.details }
}

test("searches in the chat's VM browser first, rendered as the apps expect", async () => {
  const calls: unknown[] = []
  const [search] = webTools(ai(() => Promise.reject(new Error("not used"))), (...args) => {
    calls.push(args.slice(0, 4))
    return Promise.resolve({ engine: "DuckDuckGo", items })
  })
  const result = await run(search!, { query: " sqlite wal ", limit: 50 })
  assert.deepEqual(calls, [["chat-1", 1, "sqlite wal", 10]])
  assert.equal(result.text, '1 result for "sqlite wal":\n\n1. Write-Ahead Logging\nhttps://sqlite.org/wal.html\nWAL mode.')
  assert.deepEqual(result.details, { ok: true, source: "browser", engine: "DuckDuckGo" })
})

test("a VM agent's search runs on its own VM", async () => {
  let vm = 0
  const [search] = webTools(ai(() => Promise.reject(new Error("not used"))), (_chat, n) => {
    vm = n
    return Promise.resolve({ engine: "Bing", items })
  })
  await run(search!, { query: "x", vm: 3 })
  assert.equal(vm, 3)
})

test("falls back to Cloudflare when the browser can't search, or there are no VMs", async () => {
  const cloudflare = ai(() => Promise.resolve(Response.json({ items: [{ url: "https://a.example", title: "A" }] })))
  const failing = await run(webTools(cloudflare, () => Promise.reject(new Error("no results: DuckDuckGo: blocked")))[0]!, { query: "q" })
  assert.equal(failing.isError, false)
  assert.equal(failing.details.source, "cloudflare")
  assert.equal(failing.details.browserFailure, "no results: DuckDuckGo: blocked")
  const noVms = await run(webTools(cloudflare, () => null)[0]!, { query: "q" })
  assert.equal(noVms.details.source, "cloudflare")
  assert.equal(noVms.details.browserFailure, null)
})

test("says what failed when neither can search", async () => {
  const unpaid = ai(() => Promise.resolve(Response.json({ error: "payment required" }, { status: 402 })))
  const result = await run(webTools(unpaid, () => Promise.reject(new Error("the VM's browser couldn't be set up (x)")))[0]!, { query: "q" })
  assert.equal(result.isError, true)
  assert.match(result.text, /your VM's browser couldn't search \(the VM's browser couldn't be set up \(x\)\), and the search API is unavailable/)
  assert.match(result.text, /\(web_search_payment_required\)/)
  assert.match(result.text, /vm_browser/)
})
