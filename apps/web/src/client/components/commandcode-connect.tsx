import { ExternalLink } from "lucide-react"
import { useDex } from "~/client/lib/dex"
import { SecretConnect } from "./cline-connect"
import { InfoTip } from "./info-tip"

const link = "inline-flex items-center gap-0.5 text-emerald-400 hover:underline"

/** Command Code: the key its plan's models run on, checked with Command Code and stored encrypted. */
export function CommandCodeConnect() {
  const { state, stub } = useDex()
  const commandcode = state?.commandcode
  return (
    <SecretConnect
      connected={commandcode?.connected ?? false}
      status={<span className="font-mono">{commandcode?.keyHint}</span>}
      placeholder={commandcode?.connected ? "New Command Code API key" : "Command Code API key"}
      help={
        <>
          Create a key in{" "}
          <a className={link} href="https://commandcode.ai/studio/" target="_blank" rel="noreferrer">
            Command Code Studio <ExternalLink className="size-3" />
          </a>
          .{" "}
          <InfoTip label="About Command Code keys">
            Works with Command Code's paid plans (Goat, Pro, Max). The model menu lists only the models your plan covers,
            and refreshes that list a few times a day. Dex checks the key with Command Code, then stores it encrypted in
            your agent; it's never sent to the browser.
          </InfoTip>
        </>
      }
      onConnect={async (key) => {
        const result = await stub.connectCommandCode(key)
        return result.ok ? { ok: true, message: result.note } : result
      }}
      onDisconnect={commandcode?.connected ? () => stub.disconnectCommandCode() : undefined}
    />
  )
}
