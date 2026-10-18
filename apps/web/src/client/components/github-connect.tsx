import { CheckCircle2, ExternalLink } from "lucide-react"
import { useEffect, useState } from "react"
import { useDex } from "~/client/lib/dex"
import { SecretConnect } from "./cline-connect"
import { GitHubMark } from "./github-mark"
import { InfoTip } from "./info-tip"

const NEW_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new"

/** Shown once after the OAuth round trip (`/settings?github=connected` or `?github_error=…`), then cleared from the URL. */
function useConnectResult() {
  const [result, setResult] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get("github_error")
    if (params.get("github") === "connected") setResult({ tone: "ok", text: "GitHub is connected. New VMs sign in with it." })
    else if (error) setResult({ tone: "error", text: error })
    else return
    params.delete("github")
    params.delete("github_error")
    const query = params.toString()
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`)
  }, [])
  return result
}

const tokenHelp = (
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
)

/**
 * GitHub for chats' VMs. With a GitHub OAuth app configured, one button connects it ("Connect with GitHub");
 * a pasted fine-grained token stays available for access limited to chosen repos.
 */
export function GitHubConnect() {
  const { state, stub } = useDex()
  const github = state?.github
  const result = useConnectResult()
  const [useToken, setUseToken] = useState(false)
  const oauth = github?.oauthAvailable ?? false

  const message = result && <p className={`mt-3 text-xs ${result.tone === "error" ? "text-red-400" : "text-emerald-400"}`}>{result.text}</p>

  if (!oauth || useToken || (github?.connected && github.via === "token")) {
    return (
      <div>
        <SecretConnect
          connected={github?.connected ?? false}
          status={`@${github?.login}${github?.via === "token" ? " · token" : ""}`}
          placeholder="github_pat_…"
          help={tokenHelp}
          onConnect={async (token) => {
            const outcome = await stub.connectGitHub(token)
            return outcome.ok ? { ok: true } : outcome
          }}
          onDisconnect={() => stub.disconnectGitHub()}
        />
        {oauth && !github?.connected && (
          <button type="button" onClick={() => setUseToken(false)} className="mt-3 text-xs text-zinc-500 hover:text-zinc-200">
            Connect with GitHub instead
          </button>
        )}
        {message}
      </div>
    )
  }

  if (github?.connected) {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="flex min-w-0 items-center gap-2 text-emerald-400">
            <CheckCircle2 className="size-4 shrink-0" />
            <span className="truncate">@{github.login}</span>
            <span className="text-xs text-zinc-500">via GitHub</span>
          </span>
          <span className="ml-auto flex items-center gap-1">
            <a href="/auth/github/connect" className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
              Reconnect
            </a>
            <button
              type="button"
              onClick={() => void stub.disconnectGitHub()}
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
        href="/auth/github/connect"
        className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
      >
        <GitHubMark /> Connect with GitHub
      </a>
      <p className="mt-2 flex items-center gap-1 text-xs text-zinc-500">
        Gives chats' VMs access to your repos (clone, push, pull requests).
        <InfoTip label="About GitHub access">
          GitHub asks you to approve repo and workflow access for Dex. The token is stored encrypted in your agent; new VMs sign the GitHub CLI and
          git in with it. It can reach every repo you can, so for access limited to chosen repos, use a fine-grained token instead. Disconnecting
          revokes it at GitHub.
        </InfoTip>
      </p>
      <button type="button" onClick={() => setUseToken(true)} className="mt-2 text-xs text-zinc-500 hover:text-zinc-200">
        Use a fine-grained token instead
      </button>
      {message}
    </div>
  )
}
