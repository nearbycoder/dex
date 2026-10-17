import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-durable"
import { type AccessCenter, stringifyResult } from "../access"
import { OPERATIONS } from "../operations"

const text = (value: string) => [{ type: "text" as const, text: value }]

const inChats = OPERATIONS.filter((operation) => operation.inChats !== false)
const riskLabel = (operation: (typeof OPERATIONS)[number]) =>
  typeof operation.risk === "function" ? "varies" : operation.risk === "admin" ? "needs confirmation" : operation.risk

/**
 * Two tools give a chat all of Dex's app operations (chats, agents, projects, MCP servers, VMs, settings, usage)
 * without putting dozens of schemas in every request: one lists them, one runs one.
 */
export const appTools = (access: AccessCenter) => [
  defineTool({
    name: "app_operations",
    description:
      "List the Dex app operations you can run with app_call, or get one operation's full parameter schema. " +
      "Operations manage Dex itself: chats, agents, projects, MCP servers, VMs, settings, notifications, and usage.\n\n" +
      inChats.map((operation) => `- ${operation.name} (${riskLabel(operation)}): ${operation.description.split(". ")[0]}`).join("\n"),
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "An operation name, for its full description and parameter schema." }))
    }),
    replay: "safe",
    execute: async ({ name }) => {
      if (!name) {
        return {
          output: text(
            inChats.map((operation) => `${operation.name} [${riskLabel(operation)}]: ${operation.description}`).join("\n")
          )
        }
      }
      const operation = inChats.find((candidate) => candidate.name === name)
      if (!operation) return { output: text(`No operation ${name}. Call app_operations without a name to list them.`), isError: true }
      return {
        output: text(
          JSON.stringify({ name: operation.name, description: operation.description, risk: riskLabel(operation), parameters: operation.parameters }, null, 2)
        )
      }
    }
  }),
  defineTool({
    name: "app_call",
    description:
      "Run a Dex app operation (see app_operations) with its arguments. Read and write operations run right away. " +
      "Admin operations (deleting things, changing settings, existing agents and projects, or MCP servers) show the user a " +
      "Confirm button in this chat and return immediately: stop and wait for their answer, which arrives as a message.",
    parameters: Type.Object({
      operation: Type.String({ description: "The operation's name, e.g. app_create_session." }),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "The operation's arguments as an object." }))
    }),
    execute: async ({ operation, arguments: args }, api) => {
      const outcome = await access.execute(operation, args ?? {}, { kind: "chat", sessionId: String(api.conversationId) })
      if (outcome.ok === "pending") {
        return {
          output: text(
            `Waiting for the user to confirm: "${outcome.pending.summary}". A Confirm button is shown in this chat. ` +
              "End your turn now and don't retry; their answer arrives as a message."
          ),
          details: { confirmation: { id: outcome.pending.id, summary: outcome.pending.summary } }
        }
      }
      if (outcome.ok === false) return { output: text(outcome.error), isError: true }
      return { output: text(stringifyResult(outcome.result)) }
    }
  })
]
