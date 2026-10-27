import { CheckCircle2, ExternalLink, Link2, LoaderCircle } from "lucide-react"
import { useState } from "react"
import { useDex } from "~/client/lib/dex"
import { InfoTip } from "./info-tip"

const link = "inline-flex items-center gap-0.5 text-emerald-400 hover:underline"

/**
 * ChatGPT: Sign in with ChatGPT, so its models run on the user's Plus or Pro plan. OpenAI sends the browser back to a
 * 127.0.0.1 address only (it allows nothing else for open-source apps), which doesn't load; the user pastes that
 * address here and the agent finishes the sign-in.
 */
export function ChatGPTConnect() {
  const { state, stub } = useDex()
  const chatgpt = state?.chatgpt
  const [signIn, setSignIn] = useState<{ url: string; redirectUri: string } | null>(null)
  const [callback, setCallback] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setMessage(null)
    try {
      await action()
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const start = () =>
    run(async () => {
      setCallback("")
      setSignIn(await stub.startChatGPTSignIn())
    })

  const finish = () =>
    run(async () => {
      const result = await stub.finishChatGPTSignIn(callback)
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error })
        return
      }
      setSignIn(null)
      setCallback("")
      setMessage({ tone: "ok", text: "Signed in. ChatGPT's models are in the model menu." })
    })

  return (
    <div className="space-y-3">
      {chatgpt?.connected && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="flex min-w-0 items-center gap-2 text-emerald-400">
            <CheckCircle2 className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{chatgpt.keyHint ?? "Signed in"}</span>
          </span>
          <span className="ml-auto flex items-center gap-1">
            {!signIn && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void start()}
                className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                Sign in again
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSignIn(null)
                setMessage(null)
                void stub.disconnectChatGPT()
              }}
              className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
            >
              Disconnect
            </button>
          </span>
        </div>
      )}
      {!chatgpt?.connected && !signIn && (
        <>
          <p className="text-xs leading-relaxed text-zinc-400">
            Use your ChatGPT Plus or Pro plan for GPT models.{" "}
            <InfoTip label="About Sign in with ChatGPT">
              Uses OpenAI's{" "}
              <a className={link} href="https://developers.openai.com/siwc/token-sharing-open-source" target="_blank" rel="noreferrer">
                Sign in with ChatGPT
              </a>{" "}
              plan sharing. Plus plans share their 5-hour limit with every app signed in this way. Dex stores the tokens
              encrypted in your agent; they're never sent to the browser.
            </InfoTip>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void start()}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            Sign in with ChatGPT
          </button>
        </>
      )}
      {signIn && (
        <div className="space-y-3">
          <ol className="list-decimal space-y-2 pl-5 text-xs leading-relaxed text-zinc-400">
            <li>
              <a className={link} href={signIn.url} target="_blank" rel="noreferrer">
                Open the ChatGPT sign-in page <ExternalLink className="size-3" />
              </a>{" "}
              and approve Dex.
            </li>
            <li>
              The tab then shows a page that can't be reached, at an address starting with{" "}
              <span className="font-mono text-zinc-300">{signIn.redirectUri}</span>. That's expected: copy the whole
              address from the address bar and paste it here.
            </li>
          </ol>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void finish()
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Link2 className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-500" />
              <input
                type="url"
                autoComplete="off"
                spellCheck={false}
                value={callback}
                onChange={(event) => setCallback(event.target.value)}
                placeholder={`${signIn.redirectUri}?code=…`}
                aria-label="Address the browser landed on"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pr-3 pl-9 text-base focus:border-emerald-600 focus:outline-none md:text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={!callback.trim() || busy}
              className="flex shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {busy && <LoaderCircle className="size-4 animate-spin" />}
              {busy ? "Checking" : "Connect"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSignIn(null)
                setMessage(null)
              }}
              className="shrink-0 rounded-lg px-2 text-sm text-zinc-500 hover:text-zinc-200"
            >
              Cancel
            </button>
          </form>
        </div>
      )}
      {message && <p className={`text-xs ${message.tone === "error" ? "text-red-400" : "text-emerald-400"}`}>{message.text}</p>}
    </div>
  )
}
