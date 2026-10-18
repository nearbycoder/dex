import { createFileRoute } from "@tanstack/react-router"
import { Check, Clock, LogOut, ShieldOff, Smartphone, Trash2, UserRound, Vibrate } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { BoatConnect } from "~/client/components/boat-connect"
import { ClineConnect } from "~/client/components/cline-connect"
import { GitHubConnect } from "~/client/components/github-connect"
import { InstallApp } from "~/client/components/install-app"
import { ModelPicker } from "~/client/components/model-picker"
import { RowsSkeleton, SettingsSkeleton } from "~/client/components/skeleton"
import { useCachedFetch } from "~/client/lib/cache"
import { Field, inputClass, Page, Row, Section, Switch } from "~/client/components/ui"
import { forgetSavedState, useDex } from "~/client/lib/dex"
import { hapticsEnabled, hapticsSupported, onHapticsChange, setHapticsEnabled } from "~/client/lib/haptics"
import type { ScheduledPrompt } from "~/shared/protocol"

export const Route = createFileRoute("/_app/settings")({ component: SettingsPage })

/** On/off for tap haptics, saved on this device. Hidden where there is no way to vibrate. */
function HapticsRow() {
  const [enabled, setEnabled] = useState(hapticsEnabled)
  useEffect(() => onHapticsChange(() => setEnabled(hapticsEnabled())), [])
  if (!hapticsSupported()) return null
  return (
    <Row icon={<Vibrate className="size-4" />} label="Haptic feedback" info="A light tap when you press buttons. Saved on this device.">
      <Switch checked={enabled} onChange={setHapticsEnabled} label="Haptic feedback" />
    </Row>
  )
}

function SettingsPage() {
  const { state, stub, viewer, connected } = useDex()
  const [instructions, setInstructions] = useState("")
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (state) setInstructions(state.settings.instructions)
  }, [state?.settings.instructions])

  const signOutAll = useRef<HTMLFormElement>(null)
  const listSchedules = useCallback(() => stub.listScheduledPrompts() as Promise<ScheduledPrompt[]>, [stub])
  const { data: schedules, refresh: loadSchedules } = useCachedFetch("schedules", listSchedules, connected)

  if (!state) return <SettingsSkeleton />

  return (
    <Page title="Settings">
      <Section title="This device">
        <div className="divide-y divide-zinc-800/80">
          <Row icon={<Smartphone className="size-4" />} label="Install Dex" info="Opens full screen from your Home Screen, like a native app, and can get notifications.">
            <InstallApp />
          </Row>
          <HapticsRow />
        </div>
      </Section>

      <Section title="ClinePass" info="Dex's models run on your ClinePass subscription.">
        <ClineConnect />
      </Section>

      <Section title="Cloud VMs" info="Chats run code, browsers, and servers on VMs in your boat.dev account.">
        <BoatConnect />
      </Section>

      <Section title="GitHub" info="Lets chats' VMs clone private repos, push branches, and open pull requests.">
        <GitHubConnect />
      </Section>

      <Section title="New chats" info="Defaults for chats you start. Each chat can change its model and thinking level.">
        <div className="space-y-4">
          <ModelPicker
            model={state.settings.defaultModel}
            thinking={state.settings.defaultThinking}
            onChange={({ model, thinking }) => void stub.updateSettings({ defaultModel: model, defaultThinking: thinking })}
          />
          <Field label="Custom instructions" info="Added to the system prompt of every chat.">
            <textarea
              value={instructions}
              onChange={(event) => {
                setInstructions(event.target.value)
                setSaved(false)
              }}
              rows={5}
              placeholder="e.g. I'm a TypeScript developer in Chicago. Be concise. Prefer tables for comparisons."
              className={inputClass}
            />
          </Field>
          {(instructions !== state.settings.instructions || saved) && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={instructions === state.settings.instructions}
                onClick={async () => {
                  await stub.updateSettings({ instructions })
                  setSaved(true)
                }}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:hidden"
              >
                Save instructions
              </button>
              {saved && <span className="flex items-center gap-1 text-sm text-emerald-400"><Check className="size-4" /> Saved</span>}
            </div>
          )}
        </div>
      </Section>

      <Section title="Scheduled prompts" info="Things Dex will do later. Ask Dex in any chat to schedule something.">
        {!schedules ? (
          <RowsSkeleton count={2} />
        ) : schedules.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing scheduled.</p>
        ) : (
          <ul className="divide-y divide-zinc-800/80">
            {schedules.map((schedule) => (
              <li key={schedule.id} className="flex items-start gap-3 py-2.5">
                <Clock className="mt-0.5 size-4 shrink-0 text-zinc-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm break-words text-zinc-200">{schedule.prompt}</p>
                  <p className="text-xs text-zinc-500">
                    {schedule.cron ? `${schedule.cron} · next ` : ""}
                    {new Date(schedule.when).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  title="Cancel"
                  aria-label="Cancel scheduled prompt"
                  onClick={async () => {
                    await stub.cancelScheduledPrompt(schedule.id)
                    await loadSchedules()
                  }}
                  className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section>
        <Row
          icon={viewer.avatarUrl ? <img src={viewer.avatarUrl} alt="" className="size-7 rounded-full" /> : <UserRound className="size-4" />}
          label={viewer.name}
          detail={`@${viewer.login}`}
        >
          <form method="post" action="/auth/logout" onSubmit={forgetSavedState}>
            <button type="submit" className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800">
              <LogOut className="size-4" /> Sign out
            </button>
          </form>
        </Row>
        <Row
          icon={<ShieldOff className="size-4" />}
          label="Sign out everywhere"
          info="Ends every session on every device, including this one. Use it if a device is lost or your password may have leaked."
        >
          <form
            ref={signOutAll}
            method="post"
            action="/auth/logout"
            onSubmit={async (event) => {
              event.preventDefault()
              if (!confirm("Sign out of Dex on every device, including this one?")) return
              await stub.signOutEverywhere().catch(() => undefined)
              forgetSavedState()
              signOutAll.current?.submit()
            }}
          >
            <button type="submit" className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-red-400">
              Sign out all
            </button>
          </form>
        </Row>
      </Section>
    </Page>
  )
}
