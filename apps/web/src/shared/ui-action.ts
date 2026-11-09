/**
 * What pressing a button in a chat's generated UI sends to the chat: what it does in words, then the form's values and
 * the button's context as JSON, for the model. The apps show it as the words with the form's values (and a simple
 * context) as small labels rather than the raw lines.
 */
export const UI_ACTION_PREFIX = "[UI action] "
const FORM_VALUES = "Form values: "
const CONTEXT = "Context: "

/** One thing a UI action carried: a form field or a piece of the button's context. `label` may be empty. */
export interface UiActionDetail {
  readonly label: string
  readonly value: string
}

export interface UiAction {
  readonly message: string
  readonly details: ReadonlyArray<UiActionDetail>
}

export const MAX_UI_ACTION_DETAILS = 6
const MAX_DETAIL_CHARS = 80

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

export const uiActionMessage = (message: string, formState: unknown, context: unknown) => {
  const lines = [`${UI_ACTION_PREFIX}${message}`]
  if (isRecord(formState) && Object.keys(formState).length > 0) lines.push(`${FORM_VALUES}${JSON.stringify(formState)}`)
  if (context !== undefined) lines.push(`${CONTEXT}${JSON.stringify(context)}`)
  return lines.join("\n")
}

type Leaf = string | number | boolean
const isLeaf = (value: unknown): value is Leaf => typeof value === "string" || typeof value === "number" || typeof value === "boolean"

/** A value as you'd read it: a stored secret's placeholder as dots, long text cut short. */
const shown = (value: Leaf) => {
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") return String(value)
  if (/^\{\{secret:[^}]*\}\}$/.test(value)) return "••••••"
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS - 1)}…` : text
}

/** "$first_name" → "first name". */
const labelOf = (name: string) => name.replace(/^\$/, "").replace(/[_-]+/g, " ").trim()

/** The values in a form's state or a context, by field name: `{ value }` wrappers opened, nesting flattened. */
const collect = (node: unknown, name: string, into: UiActionDetail[]) => {
  const add = (value: string) => {
    const detail = { label: labelOf(name), value }
    if (value && !into.some((other) => other.label === detail.label && other.value === value)) into.push(detail)
  }
  if (isLeaf(node)) add(shown(node))
  else if (Array.isArray(node)) {
    if (node.every(isLeaf)) add(node.map(shown).filter(Boolean).join(", "))
    else for (const item of node) collect(item, name, into)
  } else if (isRecord(node)) {
    if ("value" in node) collect(node.value, name, into)
    else for (const [key, value] of Object.entries(node)) collect(value, key, into)
  }
}

/** A context worth showing: a plain value or a flat set of them. Anything nested is the UI's own bookkeeping. */
const isPlain = (value: unknown) => value === null || typeof value === "number" || typeof value === "boolean" || (typeof value === "string" && !/[{[]/.test(value))
const isReadable = (context: unknown) => isPlain(context) || (isRecord(context) && Object.values(context).every(isPlain))

const jsonLine = (line: string | undefined, prefix: string): { readonly value: unknown } | null => {
  if (!line?.startsWith(prefix)) return null
  try {
    return { value: JSON.parse(line.slice(prefix.length)) }
  } catch {
    return null
  }
}

/** A UI action's words and what it carried, or null for any other message. */
export const parseUiAction = (text: string): UiAction | null => {
  if (!text.startsWith(UI_ACTION_PREFIX)) return null
  const lines = text.slice(UI_ACTION_PREFIX.length).split("\n")
  const context = lines.length > 1 ? jsonLine(lines.at(-1), CONTEXT) : null
  if (context) lines.pop()
  const values = lines.length > 1 ? jsonLine(lines.at(-1), FORM_VALUES) : null
  if (values) lines.pop()
  const details: UiActionDetail[] = []
  if (values) collect(values.value, "", details)
  if (context && isReadable(context.value)) collect(context.value, "", details)
  return { message: lines.join("\n").trim(), details: details.slice(0, MAX_UI_ACTION_DETAILS) }
}

/** A message as one line of plain words (lists, titles): a UI action's words, anything else as it is. */
export const withoutUiAction = (text: string) => parseUiAction(text)?.message ?? text
