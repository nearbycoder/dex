import { createContext } from "react"
import type { UiOperationResult } from "~/shared/access"

/** Runs an app operation for a generated UI: a Query's live data, or a button's Mutation (DexAgent.runUiOperation). */
export type RunUiOperation = (name: string, args: unknown, options: { query: boolean; confirmed?: boolean }) => Promise<UiOperationResult>

/** The chat generated UIs (render_ui cards) live in: it runs their operations and keeps each card's form and filter state. */
export interface OpenUIHost {
  /** The chat's id. */
  readonly scope: string
  readonly run: RunUiOperation
  /** Saved state by card id; null until it has loaded (cards wait for it, so they open as you left them). */
  readonly states: Readonly<Record<string, unknown>> | null
  readonly saveState: (card: string, state: unknown) => void
}

export const OpenUIHostContext = createContext<OpenUIHost | null>(null)
