import { Type } from "@earendil-works/pi-ai"
import type { ToolResultMessage } from "@earendil-works/pi-ai"
import type { ToolExecutionResult, ToolRegistration } from "@earendil-works/pi-durable"
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
import type { SearchResult } from "./vm-tools"

/**
 * agents@0.28's pi tools return their text as `content`, but pi-durable 1.3 reads `output`
 * and otherwise falls back to streamed output, which these tools never write. Without this
 * the model sees an empty result.
 */
const withOutput = <T extends ToolRegistration<any, any>>(tool: T): T => ({
  ...tool,
  execute: async (args, api, context) => {
    const result: ToolExecutionResult<any> & { content?: ToolResultMessage["content"] } = await tool.execute(args, api, context)
    return result.output === undefined && result.content ? { ...result, output: result.content } : result
  }
})

/**
 * Searches in the chat's VM browser (vm-tools' browserSearch): `null` when the user has no VMs, so search goes
 * straight to Cloudflare. Throws when the browser couldn't search.
 */
export type BrowserSearch = (
  chatId: string,
  vm: number,
  query: string,
  limit: number,
  signal?: AbortSignal
) => Promise<{ engine: string; items: SearchResult[] }> | null

const text = (value: string) => [{ type: "text" as const, text: value }]
/** A result's details (kept with the call, not shown to the model). */
const info = (value: Record<string, string | boolean | null>) => value

/**
 * web_search: in the chat's VM browser by default (free, and through the chat's VPN when it has one), else through
 * Cloudflare's Web Search (billed through AI Gateway), which also covers a browser that couldn't search. Its results
 * read as the agents package renders them, which the apps parse.
 */
const webSearch = (ai: Ai, browser: BrowserSearch) => {
  const cloudflare = createAIWebSearch({ binding: ai })
  return defineTool({
    name: "web_search",
    description:
      `${WEB_SEARCH_TOOL_DESCRIPTION} Searches run in your VM's browser when the user has VMs (the user can watch; the first one can take ` +
      "~30s while the VM and browser start), else through a search API. For a page's full text, open it (web_fetch, or vm_browser for pages " +
      "that need a real browser).",
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
      let browserFailure: string | null = null
      const searching = browser(String(api.conversationId), vm, query, limit, signal)
      if (searching) {
        try {
          const found = await searching
          return {
            output: text(renderWebSearchResults({ items: found.items, metadata: { query, requestId: "", latencyMs: 0 } })),
            details: info({ ok: true, source: "browser", engine: found.engine })
          }
        } catch (error) {
          if (signal?.aborted) throw signal.reason
          browserFailure = error instanceof Error ? error.message : String(error)
        }
      }
      try {
        const timeout = AbortSignal.timeout(30_000)
        const response = await cloudflare.search({ query, limit }, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
        return { output: text(renderWebSearchResults(response)), details: info({ ok: true, source: "cloudflare", browserFailure }) }
      } catch (error) {
        if (signal?.aborted) throw signal.reason
        const code = error instanceof WebSearchError ? error.code : "web_search_unavailable"
        const retryable = error instanceof WebSearchError ? error.retryable : true
        const lines = [
          browserFailure
            ? `Web search failed: your VM's browser couldn't search (${browserFailure}), and the search API is unavailable (${code}).`
            : `Web search is unavailable (${code}).`,
          browserFailure
            ? "You may retry once; else search with vm_browser yourself (e.g. DuckDuckGo), or answer without it and say search was unavailable."
            : retryable
              ? "You may retry once."
              : "Do not retry; answer without it and say that web search was unavailable."
        ]
        return { output: text(lines.join(" ")), isError: true, details: info({ ok: false, code, browserFailure }) }
      }
    }
  })
}

export const webTools = (ai: Ai, browser: BrowserSearch) => [webSearch(ai, browser), withOutput(webFetchTool({ binding: ai }))]
