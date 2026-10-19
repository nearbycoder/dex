import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-durable"
import { generateSystemPrompt, type LibrarySpec, type ToolSpec } from "@openuidev/lang-core"
import spec from "~/shared/openui-spec.json"
import { OUTPUTS } from "../operation-outputs"
import { inUi, OPERATIONS } from "../operations"

export const RENDER_UI_TOOL = "render_ui"

/**
 * Shows generative UI in the chat. The browser renders the `code` argument
 * with OpenUI's React renderer as it streams in, so the tool itself only
 * acknowledges. The UI keeps its own state ($variables), loads live data with
 * Query() and runs buttons' Mutation() through the app operations (in the
 * browser, via DexAgent.runUiOperation); @ToAssistant buttons come back as
 * ordinary user messages.
 */
export const renderUiTool = defineTool({
  name: RENDER_UI_TOOL,
  description:
    "Render rich, interactive UI for the user (cards, tables, charts, forms, follow-up buttons) from OpenUI Lang code. " +
    "Call load_ui_guide once per chat before your first render_ui to learn the language. Use it when a visual answer beats prose: " +
    "comparisons, dashboards, data, step-by-step plans, or collecting input with a form. The UI can keep its own state (filters, " +
    "tabs, toggles), show live Dex data with Query(), and run Dex operations from buttons with Mutation(), all without a message " +
    "to you. For API keys, tokens, and passwords use an " +
    "Input of type \"password\": its value never reaches the chat; you get {{secret:<field name>}} for vm_exec and vm_write_file.",
  parameters: Type.Object({
    title: Type.Optional(Type.String({ description: "Short label for this UI." })),
    code: Type.String({ description: "OpenUI Lang program. Must define `root = Card(...)`." })
  }),
  replay: "safe",
  execute: async ({ code }) => ({
    output: [
      {
        type: "text",
        text: `Rendered ${code.split("\n").filter((line) => line.includes("=")).length} statements. ` +
          "The user sees the UI now. Its Query() and Mutation() calls run in the UI without you; when they click a " +
          "@ToAssistant button or submit a form you will get a user message describing it."
      }
    ]
  })
})

type JsonSchema = { [key: string]: unknown }

/**
 * A schema in the subset OpenUI's guide prints (it shows anything else as `any`): unions of string literals become
 * enums, `X | null` becomes X, and intersections of objects one object.
 */
const forPrompt = (input: unknown): JsonSchema => {
  const schema = (input ?? {}) as JsonSchema
  const anyOf = schema.anyOf as JsonSchema[] | undefined
  if (anyOf) {
    const options = anyOf.filter((option) => option.type !== "null")
    if (options.length > 0 && options.every((option) => typeof option.const === "string")) return { type: "string", enum: options.map((option) => option.const) }
    if (options.length === 1) return forPrompt(options[0])
    return schema
  }
  const allOf = schema.allOf as JsonSchema[] | undefined
  if (allOf) {
    const parts = allOf.map(forPrompt)
    return {
      type: "object",
      properties: Object.assign({}, ...parts.map((part) => part.properties)),
      required: parts.flatMap((part) => (part.required as string[] | undefined) ?? [])
    }
  }
  if (schema.type === "array") return { ...schema, items: forPrompt(schema.items) }
  if (schema.type === "object" && schema.properties) {
    return { ...schema, properties: Object.fromEntries(Object.entries(schema.properties as JsonSchema).map(([key, value]) => [key, forPrompt(value)])) }
  }
  return schema
}

/** A UI reads a list as `{ rows: [...] }` (the OpenUI block wraps it), the shape OpenUI's guide uses throughout. */
const asRows = (schema: JsonSchema): JsonSchema => (schema.type === "array" ? { type: "object", properties: { rows: schema }, required: ["rows"] } : schema)

/**
 * The tools a UI's Query() and Mutation() can call: the app operations, with what the read ones return (OUTPUTS).
 * Descriptions lead with what running one takes.
 */
const uiTools: ToolSpec[] = OPERATIONS.filter(inUi).map((operation) => {
  const risk = typeof operation.risk === "function" ? "varies" : operation.risk
  const label = risk === "read" ? "read: Query or Mutation" : risk === "admin" ? "admin: Mutation only; the user confirms it on click" : "changes things: Mutation only"
  return {
    name: operation.name,
    description: `[${label}] ${(operation.description.split(/(?<!e\.g|i\.e)\.\s/)[0] ?? "").replace(/\.$/, "")}.`,
    inputSchema: forPrompt(JSON.parse(JSON.stringify(operation.parameters))),
    // Untyped results get none: the guide would list `null` defaults; app_call shows the real shape.
    ...(OUTPUTS[operation.name] && { outputSchema: asRows(forPrompt(JSON.parse(JSON.stringify(OUTPUTS[operation.name])))) }),
    annotations: { readOnlyHint: risk === "read", destructiveHint: risk === "admin" }
  } as ToolSpec
})

const reference = generateSystemPrompt({
  library: spec as unknown as LibrarySpec,
  promptOptions: {
    // The CLI serializes the library's own prompt options (examples, rules) next to the spec.
    ...(spec as { promptOptions?: object }).promptOptions,
    tools: uiTools,
    toolCalls: true,
    bindings: true,
    inlineMode: false,
    editMode: false,
    preamble:
      `You show UI by calling the ${RENDER_UI_TOOL} tool with an OpenUI Lang program in its \`code\` argument. ` +
      "Write ordinary prose in your normal reply and put only OpenUI Lang in `code` (no markdown fences). " +
      "@ToAssistant actions arrive back to you as user messages; Query() and Mutation() run in the user's browser " +
      "without you, and you don't see their results.",
    additionalRules: [
      ...((spec as { promptOptions?: { additionalRules?: string[] } }).promptOptions?.additionalRules ?? []),
      "The tools below are Dex's app operations. Most read tools show what they return (after →); build on those fields. " +
        "Every list comes wrapped as {rows: [...]}, so read `q.rows` (app_call shows it unwrapped). " +
        "For a tool without one, run it once with app_call before writing the UI. Use real values (condensed) as Query defaults. " +
        "Fields that can be empty come back as null. Times are milliseconds since 1970 when they're numbers, ISO 8601 when " +
        "strings: show them with @Ago or @DateTime, and sizes in bytes with @Bytes, never raw.",
      "Query() may only use [read] tools: it runs on its own whenever the UI shows. Anything else goes in a Mutation() " +
        "run by a button, with a label that says exactly what it does.",
      "Admin tools ask the user to confirm Dex's own description of the action when they click; don't add a confirmation step of your own.",
      "Use @ToAssistant only when you need to think about the answer or do work your tools can't do from the UI."
    ]
  }
})

/** The OpenUI Lang reference (~13k tokens), returned on demand instead of sitting in every system prompt. */
export const loadUiGuideTool = defineTool({
  name: "load_ui_guide",
  description: `Load the OpenUI Lang reference for the ${RENDER_UI_TOOL} tool: components, charts, forms, actions, and examples.`,
  parameters: Type.Object({}),
  replay: "safe",
  execute: async () => ({ output: [{ type: "text", text: reference }] })
})
