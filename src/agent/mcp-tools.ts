import type { ToolResultMessage, TSchema } from "@earendil-works/pi-ai"
import { defineExtension, type Extension, section, type ToolExecutionResult, type ToolRegistration } from "@earendil-works/pi-durable"

/** The Pi extension holding one MCP server's tools; chats select it by this name. */
export const mcpExtensionName = (serverId: string) => `mcp-${serverId}`
export const isMcpExtension = (name: string) => name.startsWith("mcp-")

/** An MCP tool as listed by the server (and cached, so chats keep their tools while it reconnects). */
export interface McpToolSpec {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: Record<string, unknown>
}

/** Part of an MCP `tools/call` result. */
type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; mimeType: string }
  | { type: "resource"; resource: { uri: string; text?: string; blob?: string; mimeType?: string } }
  | { type: "resource_link"; uri: string; name?: string; description?: string }
  | { type: string; [key: string]: unknown }

export interface McpCallResult {
  content?: McpContent[]
  structuredContent?: unknown
  isError?: boolean
  [key: string]: unknown
}

const MAX_TEXT = 40_000
const clip = (value: string) => (value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}\n… [${value.length - MAX_TEXT} more chars cut]` : value)

/** Tool names must match `^[a-zA-Z0-9_-]{1,64}$` for OpenAI-compatible APIs. */
export const mcpToolName = (prefix: string, tool: string) => `${prefix}__${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 64)

/** MCP input schemas are plain JSON Schema; Pi validates those as is. Keep only what a tool schema needs. */
const toParameters = (schema: Record<string, unknown> | undefined): TSchema => {
  const { $schema: _ignored, ...rest } = schema ?? {}
  return { ...rest, type: "object", properties: (rest.properties as object | undefined) ?? {} } as unknown as TSchema
}

/** An MCP result as a Pi tool result: text and images pass through; everything else becomes text. */
export const toToolResult = (result: McpCallResult): ToolExecutionResult => {
  const output: Array<ToolResultMessage["content"][number]> = []
  for (const part of result.content ?? []) {
    switch (part.type) {
      case "text":
        output.push({ type: "text", text: clip(String(part.text)) })
        break
      case "image":
        output.push({ type: "image", data: String(part.data), mimeType: String(part.mimeType) })
        break
      case "resource": {
        const resource = (part as Extract<McpContent, { type: "resource" }>).resource
        output.push({ type: "text", text: resource.text !== undefined ? clip(`[${resource.uri}]\n${resource.text}`) : `[binary resource ${resource.uri} (${resource.mimeType ?? "unknown type"})]` })
        break
      }
      case "resource_link": {
        const link = part as Extract<McpContent, { type: "resource_link" }>
        output.push({ type: "text", text: `[resource ${link.name ?? ""} ${link.uri}]${link.description ? ` ${link.description}` : ""}` })
        break
      }
      default:
        output.push({ type: "text", text: `[${part.type} content omitted]` })
    }
  }
  if (!output.length && result.structuredContent !== undefined) output.push({ type: "text", text: clip(JSON.stringify(result.structuredContent, null, 2)) })
  if (!output.length) output.push({ type: "text", text: result.isError ? "The tool failed without a message." : "(no output)" })
  return { output, isError: Boolean(result.isError) }
}

export interface McpExtensionInput {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly prefix: string
  readonly tools: ReadonlyArray<McpToolSpec>
  /** The server's own usage notes, from its handshake. */
  readonly instructions: () => string | null
  /** Why calls may fail right now (e.g. it needs sign-in), or null when it is ready. */
  readonly problem: () => string | null
  readonly call: (tool: string, args: Record<string, unknown>, signal: AbortSignal | undefined) => Promise<ToolExecutionResult>
}

/** One MCP server as a Pi extension: its tools, and a prompt section that only chats using it see. */
export const mcpExtension = (server: McpExtensionInput): Extension => {
  const seen = new Set<string>()
  const tools: ToolRegistration[] = []
  for (const tool of server.tools) {
    const name = mcpToolName(server.prefix, tool.name)
    if (seen.has(name)) continue
    seen.add(name)
    tools.push({
      name,
      description: `[${server.name} MCP] ${tool.description ?? tool.name}`.slice(0, 1024),
      parameters: toParameters(tool.inputSchema),
      execute: (args, _api, context) => server.call(tool.name, args as Record<string, unknown>, context.abortSignal)
    })
  }
  return defineExtension({
    name: mcpExtensionName(server.id),
    tools,
    sections: [
      section(`mcp_${server.prefix}`, () => {
        const lines = [`The "${server.name}" MCP server (${server.url}) is attached to this chat. Its tools are named ${server.prefix}__<tool>.`]
        const problem = server.problem()
        if (problem) lines.push(`Right now: ${problem}`)
        const instructions = server.instructions()?.trim()
        if (instructions) lines.push(`Its instructions:\n${instructions.slice(0, 4_000)}`)
        return lines.join("\n")
      })
    ]
  })
}
