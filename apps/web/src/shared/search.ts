export type SearchKind = "chat" | "file" | "agent" | "space" | "sidekick" | "mcp"

export interface SearchHit {
  readonly kind: SearchKind
  readonly id: string
  readonly title: string
  readonly subtitle: string
  readonly snippet?: string
  readonly route: string
  readonly updatedAt?: number
}
