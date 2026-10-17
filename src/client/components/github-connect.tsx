import { CheckCircle2, ExternalLink, KeyRound, LoaderCircle } from "lucide-react"
import { useState } from "react"
import { useDex } from "~/client/lib/dex"

const NEW_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new"

/** Paste-and-verify flow for a GitHub token that every new VM signs gh and git in with. */
export function GitHubConnect() {
  const { state, stub } = useDex()
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null)
  const github = state?.github

  const connect = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await stub.connectGitHub(token)
      if (result.ok) {
        setToken("")
        setMessage({ tone: "ok", text: `Connected as @${result.login}. New VMs sign in with it; existing ones after “Re-run setup”.` })
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
      {github?.connected && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-emerald-400">
          <CheckCircle2 className="size-4" />
          <span>
            Connected as <span className="font-medium">@{github.login}</span>
          </span>
          <button type="button" onClick={() => void stub.disconnectGitHub()} className="ml-auto text-xs text-zinc-500 hover:text-red-400">
            Disconnect
          </button>
        </div>
      )}
      <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-400">
        <li>
          Create a{" "}
          <a className="text-emerald-400 hover:underline" href={NEW_TOKEN_URL} target="_blank" rel="noreferrer">
            fine-grained token <ExternalLink className="inline size-3" />
          </a>{" "}
          for the repos Dex should work on, with Contents and Pull requests set to Read and write.
        </li>
        <li>Paste it here. Dex checks it with GitHub and stores it encrypted.</li>
      </ol>
      <p className="text-xs text-zinc-500">
        Each chat's VM signs the GitHub CLI and git in with it, so projects can clone private repos and agents can push and open PRs. Anything
        on a VM can use the token, so give it only the repos and permissions you need.
      </p>
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
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={github?.connected ? "Replace with a new token" : "github_pat_…"}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pr-3 pl-9 text-base focus:border-emerald-600 focus:outline-none md:text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !token.trim()}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          {busy && <LoaderCircle className="size-4 animate-spin" />}
          {github?.connected ? "Replace" : "Connect"}
        </button>
      </form>
      {message && <p className={`text-sm ${message.tone === "error" ? "text-red-400" : "text-emerald-400"}`}>{message.text}</p>}
    </div>
  )
}
