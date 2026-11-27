import { Type } from "typebox"
import type { ToolResultMessage } from "@earendil-works/pi-ai"
import type { ToolExecutionResult, ToolPark, ToolRegistration } from "@earendil-works/pi-durable"
import { defineTool } from "@earendil-works/pi-durable"
import { webFetchTool } from "agents/webfetch/pi"
import {
  createAIWebSearch,
  DEFAULT_WEB_SEARCH_LIMIT,
  MAX_WEB_SEARCH_LIMIT,
  MAX_WEB_SEARCH_QUERY_LENGTH,
  renderWebSearchResults,
  WEB_SEARCH_TOOL_DESCRIPTION,
  WebSearchError
} from "agents/websearch"
import type { SearchResult } from "../chatgpt-search"

/**
 * agents@0.28's pi tools return their text as `content`, but pi-durable 1.3 reads `output`
 * and otherwise falls back to streamed output, which these tools never write. Without this
 * the model sees an empty result.
 */
const withOutput = <T extends ToolRegistration<any, any>>(tool: T): T => ({
  ...tool,
  execute: async (args, api, context) => {
    const result: (ToolExecutionResult<any> & { content?: ToolResultMessage["content"] }) | ToolPark = await tool.execute(args, api, context)
    if ("kind" in result && result.kind !== undefined) return result
    const execution = result as ToolExecutionResult<any> & { content?: ToolResultMessage["content"] }
    return execution.output === undefined && execution.content ? { ...execution, output: execution.content } : execution
  }
})

/**
 * One way web_search can search, tried in order: `search` gives `null` when it can't here (not connected), throws
 * with what went wrong when it failed, else the results. `name` says it to the model when it failed.
 */
export interface Searcher {
  name: string
  /** Why `search` gave null, for the result's note ("ChatGPT isn't connected"). */
  unavailable: string
  search(chatId: string, vm: number, query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> | null
}

const text = (value: string) => [{ type: "text" as const, text: value }]
/** A result's details (kept with the call, not shown to the model). */
const info = (value: Record<string, string | boolean | null>) => value

/**
 * web_search: through each searcher in turn (ChatGPT's web search on the user's plan, then the chat's VM browser),
 * then Cloudflare's Web Search (billed through AI Gateway), which also covers searchers that failed. Its results read
 * as the agents package renders them, which the apps parse.
 */
const webSearch = (ai: Ai, searchers: ReadonlyArray<Searcher>) => {
  const cloudflare = createAIWebSearch({ binding: ai })
  return defineTool({
    name: "web_search",
    description:
      `${WEB_SEARCH_TOOL_DESCRIPTION} For a page's full text, open it (web_fetch, or vm_browser for pages that need a real browser).`,
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: MAX_WEB_SEARCH_QUERY_LENGTH, description: "What to search for." }),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, description: `How many results to return (at most ${MAX_WEB_SEARCH_LIMIT}; default ${DEFAULT_WEB_SEARCH_LIMIT}).` })
      )
    }),
    replay: "safe",
    execute: async (args, api, context) => {
      const signal = context.abortSignal
      const query = args.query.trim()
      const limit = Math.min(MAX_WEB_SEARCH_LIMIT, Math.max(1, Math.trunc(Number(args.limit) || DEFAULT_WEB_SEARCH_LIMIT)))
      // A VM agent's call arrives (forWorkers) with its chat's id and its own VM's number.
      const vm = Number((args as { vm?: unknown }).vm) || 1
      const failures: string[] = []
      const skipped: string[] = []
      // Which way answered and why earlier ones didn't, above the results so the user sees it in the search card
      // (the apps' result parsers skip lines before the first numbered result).
      const note = (source: string) => {
        const why = [...skipped, ...failures.map((failure) => `${failure.replace(/: /, " failed: ")}`)]
        return why.length ? `(Searched with ${source}. ${why.join("; ")}.)\n\n` : ""
      }
      for (const searcher of searchers) {
        const searching = searcher.search(String(api.conversationId), vm, query, limit, signal)
        if (!searching) {
          skipped.push(searcher.unavailable)
          continue
        }
        try {
          const items = await searching
          return {
            output: text(note(searcher.name) + renderWebSearchResults({ items, metadata: { query, requestId: "", latencyMs: 0 } })),
            details: info({ ok: true, source: searcher.name, failures: failures.join("; ") || null })
          }
        } catch (error) {
          if (signal?.aborted) throw signal.reason
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`web_search: ${searcher.name} couldn't search: ${message}`)
          failures.push(`${searcher.name}: ${message}`)
        }
      }
      try {
        const timeout = AbortSignal.timeout(30_000)
        const response = await cloudflare.search({ query, limit }, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
        return { output: text(note("Cloudflare's search API") + renderWebSearchResults(response)), details: info({ ok: true, source: "cloudflare", failures: failures.join("; ") || null }) }
      } catch (error) {
        if (signal?.aborted) throw signal.reason
        const code = error instanceof WebSearchError ? error.code : "web_search_unavailable"
        const retryable = error instanceof WebSearchError ? error.retryable : true
        const lines = [
          failures.length
            ? `Web search failed (${failures.join("; ")}), and the search API is unavailable (${code}).`
            : `Web search is unavailable (${code}).`,
          failures.length
            ? "You may retry once; else search with vm_browser yourself (e.g. DuckDuckGo), or answer without it and say search was unavailable."
            : retryable
              ? "You may retry once."
              : "Do not retry; answer without it and say that web search was unavailable."
        ]
        return { output: text(lines.join(" ")), isError: true, details: info({ ok: false, code, failures: failures.join("; ") || null }) }
      }
    }
  })
}

export const webTools = (ai: Ai, searchers: ReadonlyArray<Searcher>) => [webSearch(ai, searchers), withOutput(webFetchTool({ binding: ai }))]
