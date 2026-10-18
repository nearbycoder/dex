import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-durable"
import { generateSystemPrompt, type LibrarySpec } from "@openuidev/lang-core"
import spec from "~/shared/openui-spec.json"

export const RENDER_UI_TOOL = "render_ui"

/**
 * Shows generative UI in the chat. The browser renders the `code` argument
 * with OpenUI's React renderer as it streams in, so the tool itself only
 * acknowledges; user interactions come back as ordinary user messages.
 */
export const renderUiTool = defineTool({
  name: RENDER_UI_TOOL,
  description:
    "Render rich, interactive UI for the user (cards, tables, charts, forms, follow-up buttons) from OpenUI Lang code. " +
    "Call load_ui_guide once per chat before your first render_ui to learn the language. Use it when a visual answer beats prose: " +
    "comparisons, dashboards, data, step-by-step plans, or collecting input with a form. For API keys, tokens, and passwords use an " +
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
          "The user sees the UI now; when they click a button or submit a form you will get a user message describing it."
      }
    ]
  })
})

const reference = generateSystemPrompt({
  library: spec as unknown as LibrarySpec,
  promptOptions: {
    // The CLI serializes the library's own prompt options (examples, rules) next to the spec.
    ...(spec as { promptOptions?: object }).promptOptions,
    toolCalls: false,
    bindings: false,
    inlineMode: false,
    editMode: false,
    preamble:
      `You show UI by calling the ${RENDER_UI_TOOL} tool with an OpenUI Lang program in its \`code\` argument. ` +
      "Write ordinary prose in your normal reply and put only OpenUI Lang in `code` (no markdown fences). " +
      "@ToAssistant actions arrive back to you as user messages."
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
