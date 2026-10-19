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
