import { CheckCircle2, ExternalLink, Monitor } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import { SecretConnect } from "./cline-connect"
import { InfoTip } from "./info-tip"

const link = "inline-flex items-center gap-0.5 text-emerald-400 hover:underline"

/** Shown once after the OAuth round trip (`/settings?boat=connected` or `?boat_error=…`), then cleared from the URL. */
function useBoatConnectResult() {
  const [result, setResult] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get("boat_error")
    if (params.get("boat") === "connected") {
      const text = "boat.dev is connected. New VMs run on your boat.dev account."
      setResult({ tone: "ok", text })
      toast.success(text)
    } else if (error) {
      setResult({ tone: "error", text: error })
      toast.error(error)
    } else {
      return
    }
    params.delete("boat")
    params.delete("boat_error")
    const query = params.toString()
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`)
  }, [])
  return result
}

const apiKeyHelp = (
  <>
    Create an API key in your{" "}
    <a className={link} href="https://boat.dev" target="_blank" rel="noreferrer">
      boat.dev <ExternalLink className="size-3" />
    </a>{" "}
    account.{" "}
    <InfoTip label="About boat.dev keys">
      Chats' VMs run on this account, so boat.dev bills it for the time they run (they stop after a few idle minutes). Dex checks the key, then
      stores it encrypted in your agent; it's never sent to the browser. To switch accounts, delete your VMs first: they live in the account that
      made them.
    </InfoTip>
  </>
)

/**
 * boat.dev: the account chats' VMs run (and bill) on. With a boat.dev OAuth app configured (`BOAT_CLIENT_ID`),
 * one button connects it ("Sign in with boat.dev"); pasting an API key stays available too.
 */
export function BoatConnect() {
  const { state, stub } = useDex()
  const boat = state?.boat
  const result = useBoatConnectResult()
  const [useKey, setUseKey] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)
  const oauth = boat?.oauthAvailable ?? false

  const message =
    (disconnectError && <p className="mt-3 text-xs text-red-400">{disconnectError}</p>) ||
    (result && <p className={`mt-3 text-xs ${result.tone === "error" ? "text-red-400" : "text-emerald-400"}`}>{result.text}</p>)

  const disconnect = async () => {
    setDisconnectError(null)
    const outcome = await stub.disconnectBoat()
    if (!outcome.ok) {
      setDisconnectError(outcome.error)
      toast.error(outcome.error)
    } else {
      toast.success("Disconnected boat.dev")
    }
    return outcome
  }

  if (!oauth || useKey || (boat?.connected && (boat.source === "server" || boat.via !== "oauth"))) {
    return (
      <div>
        <SecretConnect
          connected={boat?.connected ?? false}
          status={boat?.source === "user" ? <span className="font-mono">{boat.keyHint}</span> : "This deployment's account"}
          placeholder={boat?.source === "user" ? "New boat.dev API key" : "boat.dev API key"}
          help={apiKeyHelp}
          onConnect={async (key) => {
            const outcome = await stub.connectBoat(key)
            return outcome.ok ? { ok: true } : outcome
          }}
          onDisconnect={boat?.source === "user" ? disconnect : undefined}
        />
        {oauth && (!boat?.connected || boat.source === "server") && (
          <div className="mt-3">
            {useKey ? (
              <button type="button" onClick={() => setUseKey(false)} className="text-xs text-zinc-500 hover:text-zinc-200">
                Sign in with boat.dev instead
              </button>
            ) : (
              <a href="/auth/boat/connect" className="text-xs text-emerald-400 hover:underline">
                Sign in with your own boat.dev account instead
              </a>
            )}
          </div>
        )}
        {message}
      </div>
    )
  }

  if (boat?.connected) {
    return (
      <div>
        {boat.expired && (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2.5 text-xs text-amber-200">
            <span className="min-w-0 flex-1">
              boat.dev stopped accepting this connection{boat.expiredAt ? ` ${timeAgo(boat.expiredAt)}` : ""} (revoked or expired). Reconnect to
              resume starting and controlling VMs.
              {boat.expiredReason && <span className="mt-1 block text-amber-200/60">{boat.expiredReason}.</span>}
            </span>
            <a href="/auth/boat/connect" className="shrink-0 rounded-md bg-amber-500/90 px-2.5 py-1 font-medium text-zinc-950 hover:bg-amber-400">
              Reconnect
            </a>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="flex min-w-0 items-center gap-2 text-emerald-400">
            <CheckCircle2 className="size-4 shrink-0" />
            <span className="truncate">{boat.account ?? boat.keyHint ?? "boat.dev account"}</span>
            <span className="text-xs text-zinc-500">via boat.dev</span>
            <InfoTip label="About boat.dev sign-in">
              Tokens rotate automatically every hour inside your agent, so nothing needs reconnecting. Disconnecting revokes Dex's refresh token at
              boat.dev.
            </InfoTip>
          </span>
          <span className="ml-auto flex items-center gap-1">
            <a href="/auth/boat/connect" className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
              Reconnect
            </a>
            <button
              type="button"
              onClick={() => void disconnect()}
              className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
            >
              Disconnect
            </button>
          </span>
        </div>
        {message}
      </div>
    )
  }

  return (
    <div>
      <a
        href="/auth/boat/connect"
        className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
      >
        <Monitor className="size-4" /> Sign in with boat.dev
      </a>
      <p className="mt-2 flex items-center gap-1 text-xs text-zinc-500">
        Connect your boat.dev account with one click—no API key to copy.
        <InfoTip label="About Sign in with boat.dev">
          boat.dev asks you to approve sandbox, exec, file, port, desktop, and snapshot access for Dex. Tokens are stored encrypted in your agent
          and rotate automatically. Disconnecting revokes Dex's access at boat.dev.
        </InfoTip>
      </p>
      <button type="button" onClick={() => setUseKey(true)} className="mt-2 text-xs text-zinc-500 hover:text-zinc-200">
        Use an API key instead
      </button>
      {message}
    </div>
  )
}
