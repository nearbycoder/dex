import type { ToolResultMessage } from "@earendil-works/pi-ai"
import type { ToolExecutionResult, ToolRegistration } from "@earendil-works/pi-durable"
import { webFetchTool } from "agents/webfetch/pi"
import { webSearchTool } from "agents/websearch/pi"

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

export const webTools = (ai: Ai) => [withOutput(webSearchTool({ binding: ai })), withOutput(webFetchTool({ binding: ai }))]
