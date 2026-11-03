import { ExternalLink } from "lucide-react"
import { useDex } from "~/client/lib/dex"
import { SecretConnect } from "./cline-connect"
import { InfoTip } from "./info-tip"

const link = "inline-flex items-center gap-0.5 text-emerald-400 hover:underline"

/** OpenRouter: the key its free models run on, checked with OpenRouter and stored encrypted. */
export function OpenRouterConnect() {
  const { state, stub } = useDex()
  const openrouter = state?.openrouter
  return (
    <SecretConnect
      connected={openrouter?.connected ?? false}
      status={<span className="font-mono">{openrouter?.keyHint}</span>}
      placeholder={openrouter?.connected ? "New OpenRouter API key" : "OpenRouter API key"}
      help={
        <>
          Create a key in{" "}
          <a className={link} href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">
            OpenRouter's settings <ExternalLink className="size-3" />
          </a>
          .{" "}
          <InfoTip label="About OpenRouter">
            Dex lists only OpenRouter's free models, so a chat on one costs nothing. They're limited to a few dozen
            requests a day until the account has bought $10 of credits, and their providers may keep or train on what
            you send (OpenRouter's privacy settings decide which ones your key can use). Dex checks the key with
            OpenRouter, then stores it encrypted in your agent; it's never sent to the browser.
          </InfoTip>
        </>
      }
      onConnect={async (key) => {
        const result = await stub.connectOpenRouter(key)
        return result.ok ? { ok: true, message: result.note } : result
      }}
      onDisconnect={openrouter?.connected ? () => stub.disconnectOpenRouter() : undefined}
    />
  )
}
