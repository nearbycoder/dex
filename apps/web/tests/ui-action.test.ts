import assert from "node:assert/strict"
import { test } from "node:test"
import { parseUiAction, uiActionMessage, withoutUiAction } from "../src/shared/ui-action.ts"

test("a UI action reads back as its words and what it carried", () => {
  const text = uiActionMessage("Build the direction I picked", { $direction: "ironfront" }, { direction: "ironfront" })
  assert.equal(text, '[UI action] Build the direction I picked\nForm values: {"$direction":"ironfront"}\nContext: {"direction":"ironfront"}')
  assert.deepEqual(parseUiAction(text), { message: "Build the direction I picked", details: [{ label: "direction", value: "ironfront" }] })
})

test("form fields are opened, secrets hidden, empty ones dropped", () => {
  const form = { deploy: { env: { value: "prod" }, api_key: { value: "{{secret:API_KEY}}" }, notify: { value: true }, notes: { value: "" }, tags: { value: ["a", "b"] } } }
  assert.deepEqual(parseUiAction(uiActionMessage("Deploy it", form, "Selected item: 2"))?.details, [
    { label: "env", value: "prod" },
    { label: "api key", value: "••••••" },
    { label: "notify", value: "Yes" },
    { label: "tags", value: "a, b" },
    { label: "", value: "Selected item: 2" }
  ])
})

test("only a simple context is shown", () => {
  assert.deepEqual(parseUiAction(uiActionMessage("Archive", undefined, { id: "t-42", done: true, note: null }))?.details, [
    { label: "id", value: "t-42" },
    { label: "done", value: "Yes" }
  ])
  assert.deepEqual(parseUiAction(uiActionMessage("Open it", undefined, 'Selected item: {"itemIndex":0}')), { message: "Open it", details: [] })
  assert.deepEqual(parseUiAction(uiActionMessage("Open it", undefined, { item: { index: 0 } })), { message: "Open it", details: [] })
})

test("words alone, and other messages", () => {
  assert.deepEqual(parseUiAction("[UI action] Why was Friday busiest?\nIt looked odd."), { message: "Why was Friday busiest?\nIt looked odd.", details: [] })
  assert.deepEqual(parseUiAction("[UI action] Context: 1"), { message: "Context: 1", details: [] })
  assert.deepEqual(parseUiAction("[UI action] Go\nContext: not json"), { message: "Go\nContext: not json", details: [] })
  assert.equal(parseUiAction("plain message"), null)
  assert.equal(withoutUiAction("[UI action] Go\nContext: 3"), "Go")
  assert.equal(withoutUiAction("plain"), "plain")
})

test("long values are cut and at most six shown", () => {
  const form = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`f${index}`, "x".repeat(100 + index)]))
  const details = parseUiAction(uiActionMessage("Save", form, undefined))?.details ?? []
  assert.equal(details.length, 6)
  assert.equal(details[0]?.value.length, 80)
  assert.ok(details[0]?.value.endsWith("…"))
})
