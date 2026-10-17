import { ExternalLink } from "lucide-react"
import { useDex } from "~/client/lib/dex"
import { SecretConnect } from "./cline-connect"
import { InfoTip } from "./info-tip"

const NEW_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new"

/** The GitHub token every new VM signs gh and git in with. */
export function GitHubConnect() {
  const { state, stub } = useDex()
  const github = state?.github
  return (
    <SecretConnect
      connected={github?.connected ?? false}
      status={`@${github?.login}`}
      placeholder="github_pat_…"
      help={
        <>
          Create a{" "}
          <a className="inline-flex items-center gap-0.5 text-emerald-400 hover:underline" href={NEW_TOKEN_URL} target="_blank" rel="noreferrer">
            fine-grained token <ExternalLink className="size-3" />
          </a>{" "}
          with Contents and Pull requests set to Read and write.{" "}
          <InfoTip label="About the GitHub token">
            New VMs sign the GitHub CLI and git in with it, so projects clone private repos and agents can push and open PRs. Anything on a VM can use
            it, so limit it to the repos Dex needs. Existing VMs pick up a new token after “Re-run setup”.
          </InfoTip>
        </>
      }
      onConnect={async (token) => {
        const result = await stub.connectGitHub(token)
        return result.ok ? { ok: true } : result
      }}
      onDisconnect={() => stub.disconnectGitHub()}
    />
  )
}
