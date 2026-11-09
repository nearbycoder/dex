// Writes the UI-action goldens (core/model's UiActionTest compares against them) from the web's own
// apps/web/src/shared/ui-action.ts. It needs nothing installed. Run from the repo root:  node apps/android/tools/goldens/ui-action.mts
import { mkdirSync, writeFileSync } from "node:fs"
import { parseUiAction, uiActionMessage } from "../../../web/src/shared/ui-action.ts"

const OUT = new URL("../../core/model/src/test/resources/golden/", import.meta.url)
mkdirSync(OUT, { recursive: true })

const form = {
  deploy: {
    env: { value: "prod" },
    api_key: { value: "{{secret:API_KEY}}" },
    notify: { value: true },
    quiet: { value: false },
    notes: { value: "" },
    tags: { value: ["a", "b"] },
    count: { value: 3 },
    ratio: { value: 0.5 }
  }
}
const inputs = [
  uiActionMessage("Build the direction I picked", { $direction: "ironfront" }, { direction: "ironfront" }),
  uiActionMessage("Deploy it", form, "Selected item: 2"),
  uiActionMessage("Deploy it", {}, { item: { index: 0, name: "First  one\nhere" }, rows: [{ id: 1 }, { id: 2 }], none: null }),
  uiActionMessage("Open it", { filter: { value: "open" } }, "Selected item: {\"itemIndex\":0}"),
  uiActionMessage("Archive", undefined, { id: "t-42", done: true, note: null }),
  uiActionMessage("Save", Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`field-${index}`, "x".repeat(100 + index)])), undefined),
  uiActionMessage("Explain the dip on Saturday", undefined, undefined),
  uiActionMessage("Pick", undefined, 4),
  "[UI action] Why was Friday busiest?\nIt looked odd.",
  "[UI action] Context: 1",
  "[UI action] Go\nContext: not json",
  "[UI action] Go\nContext: soon",
  "[UI action] Go\nForm values: {\"a\":1}\nand more",
  "[UI action]",
  "plain message"
]
writeFileSync(new URL("ui-action.json", OUT), JSON.stringify({ parse: inputs.map((input) => ({ input, action: parseUiAction(input) })) }, null, 1) + "\n")

console.log("UI-action goldens written to", OUT.pathname)
