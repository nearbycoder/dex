import { CheckCircle2, ExternalLink, KeyRound, LoaderCircle } from "lucide-react"
import { useState } from "react"
import { useDex } from "~/client/lib/dex"

/** Paste-and-verify flow for a ClinePass API key. The key is checked against Cline, then encrypted in the agent. */
export function ClineConnect({ compact = false }: { compact?: boolean }) {
  const { state, stub } = useDex()
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null)
  const cline = state?.cline

  const connect = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await stub.connectCline(key)
      if (result.ok) {
        setKey("")
        setMessage({ tone: "ok", text: result.note ?? "Connected. Dex will use your ClinePass subscription." })
      } else {
        setMessage({ tone: "error", text: result.error })
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {cline?.connected && (
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle2 className="size-4" />
          {cline.source === "user" ? (
            <span>
              Connected with key <span className="font-mono">{cline.keyHint}</span>
            </span>
          ) : (
            <span>Using this deployment's shared ClinePass key</span>
          )}
        </div>
      )}
      {!compact && (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-400">
          <li>
            Subscribe to{" "}
            <a className="text-emerald-400 hover:underline" href="https://cline.bot/cline-pass" target="_blank" rel="noreferrer">
              ClinePass <ExternalLink className="inline size-3" />
            </a>
          </li>
          <li>
            Open{" "}
            <a className="text-emerald-400 hover:underline" href="https://app.cline.bot" target="_blank" rel="noreferrer">
              app.cline.bot <ExternalLink className="inline size-3" />
            </a>{" "}
            → Settings → API Keys → Generate API key
          </li>
          <li>Paste it here. Dex checks it with Cline, then stores it encrypted in your agent.</li>
        </ol>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void connect()
        }}
      >
        <div className="relative flex-1">
          <KeyRound className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-500" />
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={cline?.source === "user" ? "Replace with a new key" : "Cline API key"}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pr-3 pl-9 text-base focus:border-emerald-600 md:text-sm focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={!key.trim() || busy}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          {busy && <LoaderCircle className="size-4 animate-spin" />}
          {busy ? "Checking" : "Connect"}
        </button>
      </form>
      {message && <p className={`text-sm ${message.tone === "error" ? "text-red-400" : "text-emerald-400"}`}>{message.text}</p>}
      {cline?.source === "user" && !compact && (
        <button type="button" onClick={() => void stub.disconnectCline()} className="text-xs text-zinc-500 hover:text-red-400">
          Disconnect this key
        </button>
      )}
    </div>
  )
}
