import { ExternalLink } from "lucide-react"
import { useDex } from "~/client/lib/dex"
import { SecretConnect } from "./cline-connect"
import { InfoTip } from "./info-tip"

const link = "inline-flex items-center gap-0.5 text-emerald-400 hover:underline"

/** OpenCode Go: the key its models run on, verified with OpenCode and stored encrypted. */
export function OpenCodeConnect() {
  const { state, stub } = useDex()
  const opencode = state?.opencode
  return (
    <SecretConnect
      connected={opencode?.connected ?? false}
      status={opencode?.source === "user" ? <span className="font-mono">{opencode.keyHint}</span> : "This deployment's account"}
      placeholder={opencode?.source === "user" ? "New OpenCode API key" : "OpenCode API key"}
      help={
        <>
          Copy your key from the{" "}
          <a className={link} href="https://opencode.ai/auth" target="_blank" rel="noreferrer">
            OpenCode console <ExternalLink className="size-3" />
          </a>
          .{" "}
          <InfoTip label="About OpenCode Go keys">
            Needs an{" "}
            <a className={link} href="https://opencode.ai/docs/go/" target="_blank" rel="noreferrer">
              OpenCode Go subscription
            </a>{" "}
            ($10/month, or Go Plus for higher limits). Dex checks the key with OpenCode, then stores it encrypted in your
            agent; it's never sent to the browser.
          </InfoTip>
        </>
      }
      onConnect={async (key) => {
        const result = await stub.connectOpenCode(key)
        return result.ok ? { ok: true, message: result.note } : result
      }}
      onDisconnect={opencode?.source === "user" ? () => stub.disconnectOpenCode() : undefined}
    />
  )
}
