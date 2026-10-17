import { type ActionEvent, BuiltinActionType, Renderer } from "@openuidev/react-lang"
import { ThemeProvider } from "@openuidev/react-ui"
import { library } from "~/client/openui/library"

const toModelMessage = (event: ActionEvent) => {
  const lines = [`[UI action] ${event.humanFriendlyMessage}`]
  if (event.formState && Object.keys(event.formState).length > 0) lines.push(`Form values: ${JSON.stringify(event.formState)}`)
  if (event.params?.context !== undefined) lines.push(`Context: ${JSON.stringify(event.params.context)}`)
  return lines.join("\n")
}

/** Renders a render_ui tool call's OpenUI Lang, live while its arguments stream in. */
export default function OpenUIBlock(props: { code: string; streaming: boolean; onSend: (message: string) => void }) {
  return (
    <ThemeProvider mode="dark">
      <div className="my-3 overflow-hidden rounded-xl">
        <Renderer
          library={library}
          response={props.code}
          isStreaming={props.streaming}
          onAction={(event) => {
            if (event.type === BuiltinActionType.ContinueConversation) props.onSend(toModelMessage(event))
            else if (event.type === BuiltinActionType.OpenUrl) {
              window.open(String(event.params?.url), "_blank", "noopener,noreferrer")
            }
          }}
        />
      </div>
    </ThemeProvider>
  )
}
