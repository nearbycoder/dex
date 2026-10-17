import { createFileRoute } from "@tanstack/react-router"
import { Clock, Trash2 } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useState } from "react"
import { ClineConnect } from "~/client/components/cline-connect"
import { GitHubConnect } from "~/client/components/github-connect"
import { InstallApp } from "~/client/components/install-app"
import { ModelPicker } from "~/client/components/model-picker"
import { useDex } from "~/client/lib/dex"
import { hapticsEnabled, hapticsSupported, onHapticsChange, setHapticsEnabled } from "~/client/lib/haptics"
import type { ScheduledPrompt } from "~/shared/protocol"

export const Route = createFileRoute("/_app/settings")({ component: SettingsPage })

/** On/off for tap haptics, saved on this device. Hidden where there is no way to vibrate. */
function HapticsToggle() {
  const [enabled, setEnabled] = useState(hapticsEnabled)
  useEffect(() => onHapticsChange(() => setEnabled(hapticsEnabled())), [])
  if (!hapticsSupported()) return null
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 md:p-6">
      <label className="flex cursor-pointer items-center gap-4">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Haptic feedback</span>
          <span className="mt-1 block text-sm text-zinc-400">A light tap under your finger when you press buttons. Saved on this device.</span>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setHapticsEnabled(event.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="relative h-6 w-10 shrink-0 rounded-full bg-zinc-700 transition-colors duration-200 peer-checked:bg-emerald-600 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform after:duration-200 after:ease-fluid peer-checked:after:translate-x-4"
        />
      </label>
    </section>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 md:p-6">
      <h2 className="font-medium">{title}</h2>
      {description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function SettingsPage() {
  const { state, stub, viewer, connected } = useDex()
  const [instructions, setInstructions] = useState("")
  const [saved, setSaved] = useState(false)
  const [schedules, setSchedules] = useState<ScheduledPrompt[]>([])

  useEffect(() => {
    if (state) setInstructions(state.settings.instructions)
  }, [state?.settings.instructions])

  const loadSchedules = useCallback(async () => setSchedules(await stub.listScheduledPrompts()), [stub])
  useEffect(() => {
    if (connected) void loadSchedules()
  }, [connected, loadSchedules])

  if (!state) return <div className="p-8 text-sm text-zinc-500">Connecting to your agent…</div>

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pt-10">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

        <Section title="Install Dex" description="Add Dex to your Home Screen to open it full screen, like a native app.">
  <InstallApp />
</Section>

<HapticsToggle />

        <Section title="ClinePass" description="Dex runs on open-weight coding models through your ClinePass subscription.">
          <ClineConnect />
        </Section>

        <Section title="GitHub" description="Lets each chat's VM clone private repos, push branches, and open pull requests.">
          <GitHubConnect />
        </Section>

        <Section title="Defaults for new chats">
          <ModelPicker
            model={state.settings.defaultModel}
            thinking={state.settings.defaultThinking}
            onChange={({ model, thinking }) => void stub.updateSettings({ defaultModel: model, defaultThinking: thinking })}
          />
        </Section>

        <Section title="Custom instructions" description="Added to the system prompt of every chat.">
          <textarea
            value={instructions}
            onChange={(event) => {
              setInstructions(event.target.value)
              setSaved(false)
            }}
            rows={6}
            placeholder="e.g. I'm a TypeScript developer in Chicago. Be concise. Prefer tables for comparisons."
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-base focus:border-emerald-600 md:text-sm focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={instructions === state.settings.instructions}
              onClick={async () => {
                await stub.updateSettings({ instructions })
                setSaved(true)
              }}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              Save
            </button>
            {saved && <span className="text-sm text-emerald-400">Saved</span>}
          </div>
        </Section>

        <Section title="Scheduled prompts" description="Things Dex will do later. Ask Dex in chat to schedule something.">
          {schedules.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing scheduled.</p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {schedules.map((schedule) => (
                <li key={schedule.id} className="flex items-start gap-3 py-2.5">
                  <Clock className="mt-0.5 size-4 shrink-0 text-zinc-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-200">{schedule.prompt}</p>
                    <p className="text-xs text-zinc-500">
                      {schedule.cron ? `cron ${schedule.cron} · next ` : ""}
                      {new Date(schedule.when).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    title="Cancel"
                    onClick={async () => {
                      await stub.cancelScheduledPrompt(schedule.id)
                      await loadSchedules()
                    }}
                    className="p-1 text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Account">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-zinc-400">
              Signed in as <span className="text-zinc-200">{viewer.name}</span> (@{viewer.login})
            </span>
            <form method="post" action="/auth/logout">
              <button type="submit" className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800">
                Sign out
              </button>
            </form>
          </div>
        </Section>
      </div>
    </div>
  )
}
