import { Type } from "typebox"
import { defineTool } from "@earendil-works/pi-durable"

const MAX_BATCH_CALLS = 10
const MAX_CALL_OUTPUT_CHARS = 8_000

const summarizeOutput = (output: unknown): string => {
  if (typeof output === "string") return output
  if (Array.isArray(output)) {
    return output
      .map((part) => (typeof part === "object" && part !== null && "text" in part ? String((part as { text: unknown }).text) : "[binary]"))
      .join("\n")
  }
  return output === undefined ? "(no output)" : JSON.stringify(output)
}

/**
 * Multi-resource parallel tool runner: executes up to 10 independent tool calls concurrently
 * (across MCP servers, workspace, web search, etc.) in a single model turn without requiring
 * dynamic WASM execution (safe inside Cloudflare Workers).
 */
export const batchToolsTool = defineTool({
  name: "batch_tools",
  description:
    "Run up to 10 independent tool calls in parallel in a single turn (for example, querying multiple MCP servers, " +
    "reading several files, or combining web_search + MCP lookups at once). Nested calls to batch_tools itself are rejected.",
  parameters: Type.Object({
    calls: Type.Array(
      Type.Object({
        tool: Type.String({ description: "Exact tool name to call (e.g. github__list_issues, read_file, web_search)." }),
        arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Arguments object for that tool." }))
      }),
      { minItems: 1, maxItems: MAX_BATCH_CALLS, description: "Independent tool calls to execute concurrently." }
    )
  }),
  execute: async ({ calls }, api, context) => {
    const items = calls.slice(0, MAX_BATCH_CALLS)
    const confirmations: Array<{ id: string; summary: string }> = []
    const results = await Promise.all(
      items.map(async (entry, index) => {
        if (!entry.tool || entry.tool === "batch_tools") {
          return { index, tool: entry.tool, isError: true, text: "Recursive batch_tools calls are not allowed." }
        }
        if (entry.tool === "app_call") {
          return { index, tool: entry.tool, isError: true, text: "Call app_call directly instead of inside batch_tools." }
        }
        try {
          const result = await api.executeTool(entry.tool, (entry.arguments ?? {}) as never, context, { key: `b${index}` })
          if (result.details && typeof result.details === "object" && !Array.isArray(result.details)) {
            const conf = (result.details as { confirmation?: { id?: unknown; summary?: unknown } }).confirmation
            if (conf && typeof conf.id === "string" && typeof conf.summary === "string") {
              confirmations.push({ id: conf.id, summary: conf.summary })
            }
          }
          const raw =
            result.structuredOutput !== undefined
              ? summarizeOutput(result.structuredOutput)
              : result.diagnostics.length > 0
                ? result.diagnostics.map((diag) => diag.message).join("\n")
                : "(no output)"
          const text = raw.length > MAX_CALL_OUTPUT_CHARS ? `${raw.slice(0, MAX_CALL_OUTPUT_CHARS)}\n… [truncated]` : raw
          return { index, tool: entry.tool, isError: Boolean(result.isError), text }
        } catch (error) {
          return { index, tool: entry.tool, isError: true, text: error instanceof Error ? error.message : String(error) }
        }
      })
    )
    const lines = results.map((res) => `### [${res.index + 1}] ${res.tool}${res.isError ? " (error)" : ""}\n${res.text}`)
    return {
      output: [{ type: "text" as const, text: lines.join("\n\n") }],
      isError: results.every((res) => res.isError),
      details: {
        count: results.length,
        errors: results.filter((res) => res.isError).length,
        ...(confirmations.length === 1 ? { confirmation: confirmations[0] } : {}),
        ...(confirmations.length > 0 ? { confirmations } : {})
      }
    }
  }
})
