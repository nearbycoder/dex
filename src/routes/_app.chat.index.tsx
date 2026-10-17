import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { KeyRound } from "lucide-react"
import { useEffect, useState } from "react"
import { Composer } from "~/client/components/composer"
import { ModelPicker } from "~/client/components/model-picker"
import { useDex } from "~/client/lib/dex"
import { DEFAULT_MODEL_ID, DEFAULT_THINKING, type ThinkingLevel } from "~/shared/models"

export const Route = createFileRoute("/_app/chat/")({ component: NewChat })

const suggestions = [
  "Research the top 5 open-weight coding models and show a comparison table",
  "Build me a dashboard of this week's Hacker News front page by points",
  "Every weekday at 9am UTC, send me a short tech news briefing",
  "Remember that I prefer TypeScript and concise answers"
]

function NewChat() {
  const { state, stub, connected } = useDex()
  const navigate = useNavigate()
  const [choice, setChoice] = useState<{ model: string; thinking: ThinkingLevel }>({
    model: DEFAULT_MODEL_ID,
    thinking: DEFAULT_THINKING
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (state) setChoice({ model: state.settings.defaultModel, thinking: state.settings.defaultThinking })
  }, [state?.settings.defaultModel, state?.settings.defaultThinking])

  const start = async (text: string) => {
    setError(null)
    try {
      const session = await stub.createSession(choice)
      await stub.sendMessage(session.id, text)
      await navigate({ to: "/chat/$sessionId", params: { sessionId: session.id } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 pb-24">
      <div className="w-full max-w-2xl">
        <h1 className="mb-6 text-center text-3xl font-semibold tracking-tight">What should Dex do?</h1>
        {state && !state.cline.connected && (
          <Link
            to="/settings"
            className="mb-4 flex items-center gap-3 rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 hover:bg-amber-950/50"
          >
            <KeyRound className="size-4 shrink-0" />
            Connect your ClinePass key in Settings so Dex can think.
          </Link>
        )}
        <Composer
          autoFocus
          disabled={!connected}
          onSend={start}
          toolbar={<ModelPicker model={choice.model} thinking={choice.thinking} onChange={setChoice} />}
        />
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={!connected}
              onClick={() => void start(suggestion)}
              className="rounded-xl border border-zinc-800/80 px-4 py-3 text-left text-sm text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60 hover:text-zinc-200"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
