import { createContext } from "react"

/** Stores a value from a chat form's password field and returns the name its `{{secret:<name>}}` placeholder uses. */
export const ChatSecretsContext = createContext<((field: string, value: string) => Promise<string>) | null>(null)
