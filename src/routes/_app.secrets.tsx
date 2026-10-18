import { createFileRoute } from "@tanstack/react-router"
import { Check, KeyRound, LoaderCircle, LockKeyhole, Trash2 } from "lucide-react"
import { useState } from "react"
import { SecretsSkeleton } from "~/client/components/skeleton"
import { inputClass, Page, Section } from "~/client/components/ui"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"

export const Route = createFileRoute("/_app/secrets")({ component: SecretsPage })

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Adds a secret, or with `name` set, replaces that one's value. */
function SecretForm({ name: fixed, onDone }: { name?: string; onDone?: () => void }) {
  const { stub } = useDex()
  const [name, setName] = useState(fixed ?? "")
  const [value, setValue] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  return (
    <form
      className="space-y-2.5"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError(null)
        try {
          const savedName = await stub.saveSecret(name, value, fixed ? undefined : note)
          setValue("")
          if (!fixed) {
            setName("")
            setNote("")
          }
          setSaved(savedName)
          onDone?.()
        } catch (cause) {
          setError(errorText(cause))
        } finally {
          setBusy(false)
        }
      }}
    >
      {!fixed && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
            placeholder="MY_API_KEY"
            aria-label="Name"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            className={`${inputClass} font-mono`}
          />
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="What it's for (optional)" aria-label="Note" maxLength={200} className={inputClass} />
        </div>
      )}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <KeyRound className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-500" />
          <input
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={fixed ? `New value for ${fixed}` : "Value"}
            aria-label="Value"
            autoComplete="off"
            className={`${inputClass} pl-9`}
          />
        </div>
        <button
          type="submit"
          disabled={busy || !name || !value}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          {busy && <LoaderCircle className="size-4 animate-spin" />}
          {fixed ? "Replace" : "Save"}
        </button>
        {fixed && (
          <button type="button" onClick={onDone} className="shrink-0 rounded-lg px-2 text-sm text-zinc-500 hover:text-zinc-200">
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {saved && !error && !fixed && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-400">
          <Check className="size-3.5" /> Saved {saved}. VMs get it from their next command.
        </p>
      )}
    </form>
  )
}

function SecretRow({ name, note, updatedAt }: { name: string; note: string; updatedAt: number }) {
  const { stub } = useDex()
  const [replacing, setReplacing] = useState(false)
  return (
    <li className="px-4 py-3 md:px-5">
      <div className="flex items-center gap-3">
        <LockKeyhole className="size-4 shrink-0 text-zinc-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm text-zinc-100">{name}</p>
          <p className="truncate text-xs text-zinc-500">
            {note ? `${note} · ` : ""}updated {timeAgo(updatedAt)}
          </p>
        </div>
        {!replacing && (
          <button type="button" onClick={() => setReplacing(true)} className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
            Replace
          </button>
        )}
        <button
          type="button"
          title="Delete"
          aria-label={`Delete ${name}`}
          onClick={async () => {
            if (!confirm(`Delete ${name}? VMs stop getting it from their next command.`)) return
            await stub.removeSecret(name)
          }}
          className="shrink-0 rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      {replacing && (
        <div className="mt-2.5 pl-7">
          <SecretForm name={name} onDone={() => setReplacing(false)} />
        </div>
      )}
    </li>
  )
}

function SecretsPage() {
  const { state } = useDex()
  if (!state) return <SecretsSkeleton />
  return (
    <Page
      title="Secrets"
      info="API keys and tokens every chat's VM gets as environment variables (e.g. $MY_API_KEY), so you enter them once. Values are stored encrypted, never shown again, hidden from chats, and masked in VM output."
    >
      <Section title="Add a secret">
        <SecretForm />
      </Section>
      <Section title="Saved" flush aside={state.secrets.length ? `${state.secrets.length}` : undefined}>
        {state.secrets.length === 0 ? (
          <p className="px-4 pt-1 pb-4 text-sm text-zinc-500 md:px-5">No secrets yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-800/80 border-t border-zinc-800/80">
            {state.secrets.map((secret) => (
              <SecretRow key={secret.name} {...secret} />
            ))}
          </ul>
        )}
      </Section>
    </Page>
  )
}
