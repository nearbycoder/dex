import { createContext } from "react"
import type { UiOperationResult } from "~/shared/access"

/** Runs an app operation for the chat's generated UI: a Query's live data, or a button's Mutation (DexAgent.runUiOperation). */
export type RunUiOperation = (name: string, args: unknown, options: { query: boolean; confirmed?: boolean }) => Promise<UiOperationResult>

export const ChatOperationsContext = createContext<RunUiOperation | null>(null)
