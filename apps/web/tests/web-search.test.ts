import assert from "node:assert/strict"
import { test } from "node:test"
import { readSearchResponse } from "../src/agent/chatgpt-search.ts"
import { type Searcher, webTools } from "../src/agent/tools/agents-tools.ts"

const api = { conversationId: "chat-1" } as never
const context = { abortSignal: new AbortController().signal } as never
const items = [{ url: "https://sqlite.org/wal.html", title: "Write-Ahead Logging", description: "WAL mode." }]
const ai = (search: () => Promise<unknown>) => ({ websearch: search }) as unknown as Ai
const unused = ai(() => Promise.reject(new Error("not used")))
const run = async (tool: ReturnType<typeof webTools>[number], args: Record<string, unknown>) => {
  const result = (await tool.execute(args as never, api, context)) as { output: Array<{ text: string }>; isError?: boolean; details: Record<string, unknown> }
  return { text: result.output.map((part) => part.text).join(""), isError: result.isError ?? false, details: result.details }
}
const searcher = (name: string, search: Searcher["search"]): Searcher => ({ name, unavailable: `${name} isn't set up`, search })

test("the first searcher that can search answers, rendered as the apps expect", async () => {
  const calls: unknown[] = []
  const [search] = webTools(unused, [
    searcher("ChatGPT", () => null),
    searcher("browser", (...args) => {
      calls.push(args.slice(0, 4))
      return Promise.resolve(items)
    })
  ])
  const result = await run(search!, { query: " sqlite wal ", limit: 50 })
  assert.deepEqual(calls, [["chat-1", 1, "sqlite wal", 10]])
  assert.equal(result.text, '(Searched with browser. ChatGPT isn\'t set up.)\n\n1 result for "sqlite wal":\n\n1. Write-Ahead Logging\nhttps://sqlite.org/wal.html\nWAL mode.')
  assert.deepEqual(result.details, { ok: true, source: "browser", failures: null })
})

test("a VM agent's search runs on its own VM", async () => {
  let vm = 0
  const [search] = webTools(unused, [searcher("browser", (_chat, n) => ((vm = n), Promise.resolve(items)))])
  await run(search!, { query: "x", vm: 3 })
  assert.equal(vm, 3)
})

test("a searcher that fails hands over to the next, then to Cloudflare", async () => {
  const cloudflare = ai(() => Promise.resolve(Response.json({ items: [{ url: "https://a.example", title: "A" }] })))
  const next = await run(webTools(unused, [searcher("ChatGPT", () => Promise.reject(new Error("OpenAI answered 403"))), searcher("browser", () => Promise.resolve(items))])[0]!, { query: "q" })
  assert.deepEqual(next.details, { ok: true, source: "browser", failures: "ChatGPT: OpenAI answered 403" })
  // Said above the results, so the user sees why in the search card.
  assert.match(next.text, /^\(Searched with browser\. ChatGPT failed: OpenAI answered 403\.\)\n\n1 result for "q":/)
  const last = await run(webTools(cloudflare, [searcher("browser", () => Promise.reject(new Error("blocked")))])[0]!, { query: "q" })
  assert.deepEqual(last.details, { ok: true, source: "cloudflare", failures: "browser: blocked" })
  const none = await run(webTools(cloudflare, [searcher("ChatGPT", () => null)])[0]!, { query: "q" })
  assert.deepEqual(none.details, { ok: true, source: "cloudflare", failures: null })
  assert.match(none.text, /^\(Searched with Cloudflare's search API\. ChatGPT isn't set up\.\)/)
})

test("says what failed when nothing can search", async () => {
  const unpaid = ai(() => Promise.resolve(Response.json({ error: "payment required" }, { status: 402 })))
  const result = await run(webTools(unpaid, [searcher("your VM's browser", () => Promise.reject(new Error("couldn't be set up")))])[0]!, { query: "q" })
  assert.equal(result.isError, true)
  assert.match(result.text, /Web search failed \(your VM's browser: couldn't be set up\), and the search API is unavailable \(web_search_payment_required\)/)
  assert.match(result.text, /vm_browser/)
})

test("ChatGPT's answer: the JSON list it was asked for, links cleaned", () => {
  const output = [
    { type: "web_search_call", action: { sources: [{ url: "https://sqlite.org/wal.html" }, { url: "https://extra.example/" }] } },
    {
      type: "message",
      content: [{ type: "output_text", text: '{"results":[{"title":"WAL","url":"https://sqlite.org/wal.html?utm_source=openai","description":"How WAL works."},{"title":"Bad","url":"javascript:alert(1)"}]}', annotations: [] }]
    }
  ]
  assert.deepEqual(readSearchResponse(output, 2), [
    { url: "https://sqlite.org/wal.html", title: "WAL", description: "How WAL works." },
    { url: "https://extra.example/", title: "https://extra.example/" }
  ])
})

test("ChatGPT's answer in prose: the pages it cited", () => {
  const output = [
    {
      type: "message",
      content: [{ type: "output_text", text: "SQLite 3.54.1 is the latest.", annotations: [{ type: "url_citation", url: "https://sqlite.org/changes.html?utm_source=openai", title: "Release History" }] }]
    }
  ]
  assert.deepEqual(readSearchResponse(output, 5), [{ url: "https://sqlite.org/changes.html", title: "Release History" }])
})
