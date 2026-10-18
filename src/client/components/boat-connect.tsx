import { ExternalLink } from "lucide-react"
import { useDex } from "~/client/lib/dex"
import { SecretConnect } from "./cline-connect"
import { InfoTip } from "./info-tip"

const link = "inline-flex items-center gap-0.5 text-emerald-400 hover:underline"

/** boat.dev: the account chats' VMs run (and bill) on. Each person connects their own; the owner can use the deployment's. */
export function BoatConnect() {
  const { state, stub } = useDex()
  const boat = state?.boat
  return (
    <SecretConnect
      connected={boat?.connected ?? false}
      status={boat?.source === "user" ? <span className="font-mono">{boat.keyHint}</span> : "This deployment's account"}
      placeholder={boat?.source === "user" ? "New boat.dev API key" : "boat.dev API key"}
      help={
        <>
          Create an API key in your{" "}
          <a className={link} href="https://boat.dev" target="_blank" rel="noreferrer">
            boat.dev <ExternalLink className="size-3" />
          </a>{" "}
          account.{" "}
          <InfoTip label="About boat.dev keys">
            Chats' VMs run on this account, so boat.dev bills it for the time they run (they stop after a few idle minutes). Dex checks the key, then
            stores it encrypted in your agent; it's never sent to the browser. To switch accounts, delete your VMs first: they live in the account
            that made them.
          </InfoTip>
        </>
      }
      onConnect={async (key) => {
        const result = await stub.connectBoat(key)
        return result.ok ? { ok: true } : result
      }}
      onDisconnect={boat?.source === "user" ? () => stub.disconnectBoat() : undefined}
    />
  )
}
