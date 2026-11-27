import { appendMentionContext, parseMentions } from "../shared/mentions.ts"

const MAX_ITEM_CHARS = 6_000
const MAX_TOTAL_CHARS = 16_000

export interface MentionHost {
  readFile(path: string): string | undefined
  readMcpResource(prefix: string, uri: string): Promise<{ label: string; text: string } | null>
  describeProject(name: string): string | null
  readChatExcerpt(sessionId: string): Promise<{ title: string; text: string } | null>
}

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max)}\n… [truncated ${value.length - max} chars]` : value

/**
 * Resolves `@file:`, `@mcp:`, `@project:`, and `@chat:` mentions in a user message into bounded
 * `<dex_context>` blocks so the model gets referenced context immediately without extra tool turns.
 */
export async function resolveMentions(text: string, host: MentionHost): Promise<string> {
  const mentions = parseMentions(text)
  if (mentions.length === 0) return text

  const resolved = await Promise.all(
    mentions.map(async (mention): Promise<{ label: string; content: string } | null> => {
      try {
        switch (mention.kind) {
          case "file": {
            const content = host.readFile(mention.value)
            if (content === undefined) return null
            const label = mention.value.replace(/^\/workspace\//, "")
            return { label: `File: ${label}`, content: clip(content, MAX_ITEM_CHARS) }
          }
          case "mcp": {
            const sep = mention.value.indexOf(":")
            if (sep <= 0) return null
            const prefix = mention.value.slice(0, sep)
            const uri = mention.value.slice(sep + 1)
            if (!uri) return null
            const resource = await host.readMcpResource(prefix, uri)
            if (!resource) return null
            return { label: `MCP ${resource.label}`, content: clip(resource.text, MAX_ITEM_CHARS) }
          }
          case "project": {
            const desc = host.describeProject(mention.value)
            if (!desc) return null
            return { label: `Project: ${mention.value}`, content: clip(desc, MAX_ITEM_CHARS) }
          }
          case "chat": {
            const excerpt = await host.readChatExcerpt(mention.value)
            if (!excerpt) return null
            return { label: `Chat: ${excerpt.title}`, content: clip(excerpt.text, MAX_ITEM_CHARS) }
          }
        }
      } catch {
        return null
      }
    })
  )

  const blocks: Array<{ label: string; content: string }> = []
  let total = 0
  for (const item of resolved) {
    if (!item || !item.content.trim()) continue
    const remaining = MAX_TOTAL_CHARS - total
    if (remaining <= 200) break
    const content = clip(item.content, remaining)
    total += content.length
    blocks.push({ label: item.label, content })
  }
  return appendMentionContext(text, blocks)
}
