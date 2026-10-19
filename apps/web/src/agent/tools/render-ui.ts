import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-durable"
import { generateSystemPrompt, type LibrarySpec, type ToolSpec } from "@openuidev/lang-core"
import spec from "~/shared/openui-spec.json"
import { OPERATIONS } from "../operations"

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

/**
 * The tools a UI's Query() and Mutation() can call: the app operations a chat can run with app_call (so it can call
 * one first to see the shape of its result). Descriptions lead with what running one takes.
 */
const uiTools: ToolSpec[] = OPERATIONS.filter((operation) => operation.inChats !== false).map((operation) => {
  const risk = typeof operation.risk === "function" ? "varies" : operation.risk
  const label = risk === "read" ? "read: Query or Mutation" : risk === "admin" ? "admin: Mutation only; the user confirms it on click" : "changes things: Mutation only"
  return {
    name: operation.name,
    description: `[${label}] ${(operation.description.split(/(?<!e\.g|i\.e)\.\s/)[0] ?? "").replace(/\.$/, "")}.`,
    inputSchema: JSON.parse(JSON.stringify(operation.parameters)) as Record<string, unknown>,
    annotations: { readOnlyHint: risk === "read", destructiveHint: risk === "admin" }
    // No outputSchema: results aren't typed, so the guide would list `null` defaults; app_call shows the real shape.
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
      "The tools below are Dex's app operations. To learn a result's shape, run the operation once with app_call " +
        "before writing the UI, and use what it returned (condensed) as the Query defaults.",
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
