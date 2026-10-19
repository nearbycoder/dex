/**
 * The board: generated UIs (render_ui cards) you pinned from chats, kept as live panels on their own page.
 * The synced state carries only this summary; the programs come from `boardPins()` when it changes.
 */
export interface PinInfo {
  readonly id: string
  readonly title: string
  /** The chat it was pinned from (its @ToAssistant buttons and password fields go there); null once that's gone. */
  readonly sessionId: string | null
  readonly position: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface Pin extends PinInfo {
  /** Its OpenUI Lang program. */
  readonly code: string
}

export const MAX_PINS = 30
export const MAX_PIN_CODE = 100_000

/** Where a generated UI lives: a chat (its id) or a pin (`pin:<id>`). Saved state and operation calls are per scope. */
export const pinScope = (id: string) => `pin:${id}`
export const pinOfScope = (scope: string) => (scope.startsWith("pin:") ? scope.slice(4) : null)

/**
 * What you did with a chat's UI since your last message (its buttons run operations the model doesn't see), put in
 * front of your next message so the chat knows. The chat page shows it as a note above the message.
 */
const UI_NOTES_HEADER = "[Done in this chat's UI since my last message]"

export const withUiNotes = (notes: ReadonlyArray<string>, content: string) =>
  notes.length ? `${UI_NOTES_HEADER}\n${notes.map((note) => `- ${note}`).join("\n")}\n\n${content}` : content

export const splitUiNotes = (text: string): { notes: string[]; text: string } => {
  if (!text.startsWith(`${UI_NOTES_HEADER}\n`)) return { notes: [], text }
  const end = text.indexOf("\n\n")
  const block = end === -1 ? text : text.slice(0, end)
  return {
    notes: block.split("\n").slice(1).map((line) => line.replace(/^- /, "")),
    text: end === -1 ? "" : text.slice(end + 2)
  }
}
