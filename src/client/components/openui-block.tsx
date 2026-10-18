import { type ActionEvent, BuiltinActionType, Renderer } from "@openuidev/react-lang"
import { ThemeProvider } from "@openuidev/react-ui"
import { useContext, useRef, useState } from "react"
import { ChatSecretsContext } from "~/client/lib/chat-secrets"
import { library } from "~/client/openui/library"
// Loaded with this lazy chunk rather than on every page; its layer order is fixed in styles.css.
import "@openuidev/react-ui/layered/styles/index.css"

/** Model-written UI can carry any URL; only open web pages, never `javascript:` or `data:` ones. */
const safeHttpUrl = (value: unknown) => {
  try {
    const url = new URL(String(value))
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null
  } catch {
    return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The form's values with every password field's value swapped for its `{{secret:<name>}}` placeholder, after
 * storing the value in Dex. Fields are found by name (`{ value }` or a bare string), wherever the form nests them.
 */
async function withoutSecrets(state: unknown, fields: ReadonlySet<string>, store: (field: string, value: string) => Promise<string>): Promise<unknown> {
  const walk = async (node: unknown, key?: string): Promise<unknown> => {
    if (key !== undefined && fields.has(key)) {
      const value = typeof node === "string" ? node : isRecord(node) && typeof node.value === "string" ? node.value : null
      if (value) {
        const placeholder = `{{secret:${await store(key, value)}}}`
        return typeof node === "string" ? placeholder : { ...(node as Record<string, unknown>), value: placeholder }
      }
    }
    if (Array.isArray(node)) return Promise.all(node.map((item) => walk(item)))
    if (isRecord(node)) return Object.fromEntries(await Promise.all(Object.entries(node).map(async ([name, value]) => [name, await walk(value, name)])))
    return node
  }
  return walk(state)
}

const toModelMessage = (event: ActionEvent, formState: unknown) => {
  const lines = [`[UI action] ${event.humanFriendlyMessage}`]
  if (isRecord(formState) && Object.keys(formState).length > 0) lines.push(`Form values: ${JSON.stringify(formState)}`)
  if (event.params?.context !== undefined) lines.push(`Context: ${JSON.stringify(event.params.context)}`)
  return lines.join("\n")
}

/** Renders a render_ui tool call's OpenUI Lang, live while its arguments stream in. */
export default function OpenUIBlock(props: { code: string; streaming: boolean; onSend: (message: string) => void }) {
  const storeSecret = useContext(ChatSecretsContext)
  const root = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  // Password fields' values never go into the message: Dex stores them and the chat gets placeholders.
  const submit = async (event: ActionEvent) => {
    setError(null)
    const fields = new Set([...(root.current?.querySelectorAll<HTMLInputElement>('input[type="password"][name]') ?? [])].map((input) => input.name))
    try {
      if (fields.size && !storeSecret) throw new Error("Secrets can't be kept out of the chat here, so this wasn't sent.")
      const formState = fields.size && storeSecret ? await withoutSecrets(event.formState, fields, storeSecret) : event.formState
      props.onSend(toModelMessage(event, formState))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <ThemeProvider mode="dark">
      <div ref={root} className="dex-openui my-3 w-full max-w-full overflow-hidden rounded-xl [contain:inline-size_paint]">
        <Renderer
          library={library}
          response={props.code}
          isStreaming={props.streaming}
          onAction={(event) => {
            if (event.type === BuiltinActionType.ContinueConversation) void submit(event)
            else if (event.type === BuiltinActionType.OpenUrl) {
              const url = safeHttpUrl(event.params?.url)
              if (url) window.open(url, "_blank", "noopener,noreferrer")
            }
          }}
        />
        {error && <p className="px-1 pt-2 text-xs text-red-400">{error}</p>}
      </div>
    </ThemeProvider>
  )
}
