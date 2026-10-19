import { defineAction, defineFunction } from "@openuidev/react-lang"
import { openuiChatLibrary, openuiChatPromptOptions } from "@openuidev/react-ui/genui-lib"
import { z } from "zod"
import { formatBytes, timeAgo } from "~/client/lib/format"

/** A time from an operation: milliseconds since 1970, or an ISO 8601 string. */
const time = z.union([z.number(), z.string()])
const toMs = (value: number | string) => (typeof value === "number" ? value : Date.parse(value))

/** Formatting the operations' raw values (times, sizes) for people. */
export const DEX_FUNCTIONS = [
  defineFunction({
    name: "Ago",
    description: "How long ago a time was, e.g. \"5 min. ago\" (a time in ms since 1970 or ISO 8601). For last-used, created, updated.",
    params: z.object({ time }),
    returns: z.string(),
    fn: ({ time: value }) => (Number.isFinite(toMs(value)) ? timeAgo(toMs(value)) : "")
  }),
  defineFunction({
    name: "DateTime",
    description: "A time as a short local date and time, e.g. \"Oct 19, 5:08 PM\" (ms since 1970 or ISO 8601).",
    params: z.object({ time }),
    returns: z.string(),
    fn: ({ time: value }) =>
      Number.isFinite(toMs(value)) ? new Date(toMs(value)).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""
  }),
  defineFunction({
    name: "Bytes",
    description: "A size in bytes for people, e.g. \"34.2 KB\".",
    params: z.object({ bytes: z.number() }),
    returns: z.string(),
    fn: ({ bytes }) => formatBytes(bytes)
  })
]

/**
 * Buttons that act in Dex itself, handled by the OpenUI block (src/client/components/openui-block.tsx) without a
 * message to the model.
 */
export const DEX_ACTIONS = [
  defineAction({
    name: "OpenChat",
    description: "Open a Dex chat (its id, e.g. from app_list_sessions).",
    params: z.object({ sessionId: z.string() })
  }),
  defineAction({
    name: "OpenFile",
    description: "Open a file from the agent's /workspace on the Files page (its path, e.g. from app_list_files).",
    params: z.object({ path: z.string() })
  }),
  defineAction({
    name: "OpenMachine",
    description: "Open a chat's VM on the Machine page (its vm key: the chat's id).",
    params: z.object({ vmKey: z.string() })
  }),
  defineAction({
    name: "Copy",
    description: "Copy text to the clipboard.",
    params: z.object({ text: z.string() })
  })
] as const

/**
 * The components the agent can render with the render_ui tool. After changing
 * this, run `npm run openui:spec` so the agent's prompt matches.
 */
export const library = openuiChatLibrary.extend!({ actions: { add: [...DEX_ACTIONS] }, functions: { add: DEX_FUNCTIONS } })
export const promptOptions = openuiChatPromptOptions
