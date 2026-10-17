import { CheckCircle2, ExternalLink, KeyRound, LoaderCircle } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useDex } from "~/client/lib/dex"
import { InfoTip } from "./info-tip"

/**
 * A credential that is pasted once and verified: connected, it's one line with Replace and Disconnect; not
 * connected (or replacing), a short how-to and the field.
 */
export function SecretConnect(props: {
  connected: boolean
  status: ReactNode
  help: ReactNode
  placeholder: string
  onConnect: (value: string) => Promise<{ ok: true; message?: string } | { ok: false; error: string }>
  onDisconnect?: () => Promise<unknown>
}) {
  const [value, setValue] = useState("")
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null)

  const connect = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await props.onConnect(value)
      if (result.ok) {
        setValue("")
        setEditing(false)
        if (result.message) setMessage({ tone: "ok", text: result.message })
      } else {
        setMessage({ tone: "error", text: result.error })
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const showForm = !props.connected || editing
  return (
    <div className="space-y-3">
      {props.connected && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="flex min-w-0 items-center gap-2 text-emerald-400">
            <CheckCircle2 className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{props.status}</span>
          </span>
          <span className="ml-auto flex items-center gap-1">
            {!editing && (
              <button type="button" onClick={() => setEditing(true)} className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
                Replace
              </button>
            )}
            {props.onDisconnect && (
              <button type="button" onClick={() => void props.onDisconnect?.()} className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-400">
                Disconnect
              </button>
            )}
          </span>
        </div>
      )}
      {showForm && (
        <>
          <p className="text-xs leading-relaxed text-zinc-400">{props.help}</p>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void connect()
            }}
          >
            <div className="relative min-w-0 flex-1">
              <KeyRound className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-500" />
              <input
                type="password"
                autoComplete="off"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={props.placeholder}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pr-3 pl-9 text-base focus:border-emerald-600 focus:outline-none md:text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={!value.trim() || busy}
              className="flex shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {busy && <LoaderCircle className="size-4 animate-spin" />}
              {busy ? "Checking" : "Connect"}
            </button>
            {editing && (
              <button type="button" onClick={() => setEditing(false)} className="shrink-0 rounded-lg px-2 text-sm text-zinc-500 hover:text-zinc-200">
                Cancel
              </button>
            )}
          </form>
        </>
      )}
      {message && <p className={`text-xs ${message.tone === "error" ? "text-red-400" : "text-emerald-400"}`}>{message.text}</p>}
    </div>
  )
}

const link = "inline-flex items-center gap-0.5 text-emerald-400 hover:underline"

/** ClinePass: the key Dex's models run on, verified with Cline and stored encrypted. */
export function ClineConnect() {
  const { state, stub } = useDex()
  const cline = state?.cline
  return (
    <SecretConnect
      connected={cline?.connected ?? false}
      status={cline?.source === "user" ? <span className="font-mono">{cline.keyHint}</span> : "Shared deployment key"}
      placeholder={cline?.source === "user" ? "New Cline API key" : "Cline API key"}
      help={
        <>
          Generate a key at{" "}
          <a className={link} href="https://app.cline.bot" target="_blank" rel="noreferrer">
            app.cline.bot <ExternalLink className="size-3" />
          </a>{" "}
          → Settings → API Keys.{" "}
          <InfoTip label="About ClinePass keys">
            Needs a{" "}
            <a className={link} href="https://cline.bot/cline-pass" target="_blank" rel="noreferrer">
              ClinePass subscription
            </a>
            . Dex checks the key with Cline, then stores it encrypted in your agent; it's never sent to the browser.
          </InfoTip>
        </>
      }
      onConnect={async (key) => {
        const result = await stub.connectCline(key)
        return result.ok ? { ok: true, message: result.note } : result
      }}
      onDisconnect={cline?.source === "user" ? () => stub.disconnectCline() : undefined}
    />
  )
}
