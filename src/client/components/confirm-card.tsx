import { Check, LoaderCircle, ShieldAlert, X } from "lucide-react"
import { useState } from "react"
import { useDex } from "~/client/lib/dex"

const STATUS: Record<string, string> = {
  approved: "Confirmed",
  declined: "Declined",
  expired: "Expired: ask again if you still want it",
  failed: "Confirmed, but it failed"
}

/**
 * An admin operation the chat asked for (deleting things, changing settings, agents, projects, or MCP servers).
 * Nothing happens until you confirm here; your answer goes back to the chat as a message.
 */
export function ConfirmCard({ id, summary }: { id: string; summary: string }) {
  const { state, stub } = useDex()
  const [busy, setBusy] = useState<"yes" | "no" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pending = state?.access.pending.find((candidate) => candidate.id === id)
  const status = pending?.status ?? "expired"

  const answer = async (approve: boolean) => {
    setBusy(approve ? "yes" : "no")
    setError(null)
    try {
      await stub.resolvePendingAction(id, approve)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="my-2 animate-rise rounded-xl border border-amber-900/60 bg-amber-950/25 p-3 text-sm">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-wide text-amber-300/90 uppercase">Dex wants to</p>
          <p className="mt-0.5 break-words text-zinc-100">{summary}</p>
          {status === "pending" ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void answer(true)}
                className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {busy === "yes" ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />} Confirm
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void answer(false)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                {busy === "no" ? <LoaderCircle className="size-4 animate-spin" /> : <X className="size-4" />} Decline
              </button>
            </div>
          ) : (
            <p className={`mt-1.5 text-xs ${status === "approved" ? "text-emerald-400" : status === "failed" ? "text-red-400" : "text-zinc-500"}`}>
              {STATUS[status]}
              {status === "failed" && pending?.result ? `: ${pending.result}` : ""}
            </p>
          )}
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  )
}
