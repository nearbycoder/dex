import { createFileRoute, Link } from "@tanstack/react-router"
import { Bell, BellOff, LoaderCircle, Send, Smartphone, Trash2 } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { PageSkeleton } from "~/client/components/skeleton"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import { disablePush, enablePush, notificationPermission, pushSupport, thisDeviceId } from "~/client/lib/push"
import { NOTIFY_KINDS, type NotifyKind, type PushDevice } from "~/shared/notifications"

/** Opt-in push notifications: per device, per kind of update. */
export const Route = createFileRoute("/_app/notifications")({ component: NotificationsPage })

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 md:p-6">
      <h2 className="font-medium">{title}</h2>
      {description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-zinc-100">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-zinc-500">{description}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
      <span
        aria-hidden="true"
        className="relative h-6 w-10 shrink-0 rounded-full bg-zinc-700 transition-colors duration-200 peer-checked:bg-emerald-600 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform after:duration-200 after:ease-fluid peer-checked:after:translate-x-4"
      />
    </label>
  )
}

function NotificationsPage() {
  const { state, stub } = useDex()
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [support, setSupport] = useState<ReturnType<typeof pushSupport>>("ok")
  const [permission, setPermission] = useState<ReturnType<typeof notificationPermission>>("default")
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)

  useEffect(() => {
    setDeviceId(thisDeviceId())
    setSupport(pushSupport())
    setPermission(notificationPermission())
  }, [])

  if (!state) return <PageSkeleton variant="sections" />
  const { push } = state
  // A device the agent dropped (e.g. the browser revoked it) counts as off.
  const device = push.devices.find((candidate) => candidate.id === deviceId)
  const others = push.devices.filter((candidate) => candidate.id !== deviceId)
  const muted = state.sessions.filter((session) => session.muted)

  const run = async (name: string, work: () => Promise<void>) => {
    setBusy(name)
    setMessage(null)
    try {
      await work()
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setBusy(null)
      setPermission(notificationPermission())
    }
  }

  const turnOn = () =>
    run("on", async () => {
      const id = await enablePush(push.publicKey!, (subscription, label) =>
        stub.pushSubscribe({ endpoint: subscription.endpoint!, keys: { p256dh: subscription.keys!.p256dh!, auth: subscription.keys!.auth! } }, label)
      )
      setDeviceId(id)
      setMessage({ tone: "ok", text: "Notifications are on for this device." })
    })

  const turnOff = () =>
    run("off", async () => {
      if (device) await stub.pushUnsubscribe(device.id)
      await disablePush()
      setDeviceId(null)
    })

  const toggleKind = (target: PushDevice, kind: NotifyKind, on: boolean) =>
    void stub.pushUpdate(target.id, { kinds: on ? [...target.kinds, kind] : target.kinds.filter((other) => other !== kind) })

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pt-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-zinc-400">Know when Dex finishes, hits a problem, or needs you, even when the app is closed. Off until you turn it on, per device.</p>
        </div>

        <Section title="This device">
          {!push.configured ? (
            <p className="text-sm text-zinc-400">Push notifications aren't set up on this deployment (it needs VAPID keys).</p>
          ) : support === "needs-install" ? (
            <div className="space-y-2 text-sm text-zinc-400">
              <p>On iPhone and iPad, notifications work in the Home Screen app (iOS 16.4 or later).</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>In Safari, tap Share → Add to Home Screen.</li>
                <li>Open Dex from the Home Screen and come back here.</li>
              </ol>
            </div>
          ) : support === "unsupported" ? (
            <p className="text-sm text-zinc-400">This browser can't receive push notifications.</p>
          ) : device ? (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-sm text-emerald-400">
                <Bell className="size-4" /> On for {device.label}
              </p>
              <div className="divide-y divide-zinc-800/80">
                {NOTIFY_KINDS.map((kind) => (
                  <Switch
                    key={kind.id}
                    label={kind.label}
                    description={kind.description}
                    checked={device.kinds.includes(kind.id)}
                    onChange={(on) => toggleKind(device, kind.id, on)}
                  />
                ))}
                <Switch
                  label="Skip what I'm looking at"
                  description="No notification for a chat that's open and visible on any of your devices."
                  checked={device.onlyWhenAway}
                  onChange={(onlyWhenAway) => void stub.pushUpdate(device.id, { onlyWhenAway })}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("test", async () => {
                      const error = await stub.pushTest(device.id)
                      setMessage(error ? { tone: "error", text: error } : { tone: "ok", text: "Sent. It should arrive in a few seconds." })
                    })
                  }
                  className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                >
                  {busy === "test" ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />} Send a test
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void turnOff()}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:text-red-400 disabled:opacity-50"
                >
                  <BellOff className="size-4" /> Turn off on this device
                </button>
              </div>
              {device.error && <p className="text-xs text-amber-300">Last delivery failed: {device.error}</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">
                {permission === "denied"
                  ? "Notifications are blocked for Dex on this device. Allow them in your browser's site settings (on iPhone: Settings → Notifications → Dex), then try again."
                  : "Your device will ask for permission. You choose what to hear about next."}
              </p>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void turnOn()}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {busy === "on" ? <LoaderCircle className="size-4 animate-spin" /> : <Bell className="size-4" />} Turn on notifications
              </button>
            </div>
          )}
          {message && <p className={`mt-3 text-sm ${message.tone === "error" ? "text-red-400" : "text-emerald-400"}`}>{message.text}</p>}
        </Section>

        <Section
          title="Quick actions"
          description="On Android and desktop, notifications have buttons: Open chat, Mute this chat, and Watch machine for project VMs. iOS doesn't show notification buttons; tap to open the right page."
        >
          <p className="text-xs text-zinc-500">The app icon shows how many notifications you haven't opened yet; it clears when you open Dex.</p>
        </Section>

        {others.length > 0 && (
          <Section title="Other devices" description="Each device has its own choices. Remove one to stop notifications there.">
            <ul className="divide-y divide-zinc-800/80">
              {others.map((other) => (
                <li key={other.id} className="flex items-center gap-3 py-2.5">
                  <Smartphone className="size-4 shrink-0 text-zinc-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-200">{other.label}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {other.kinds.length} of {NOTIFY_KINDS.length} kinds · {other.lastSentAt ? `last sent ${timeAgo(other.lastSentAt)}` : "nothing sent yet"}
                      {other.error && <span className="text-amber-300"> · last delivery failed</span>}
                    </span>
                  </span>
                  <button
                    type="button"
                    title="Remove"
                    onClick={() => void stub.pushUnsubscribe(other.id)}
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {muted.length > 0 && (
          <Section title="Muted chats" description="No notifications from these. Mute or unmute any chat with the bell in its header.">
            <ul className="divide-y divide-zinc-800/80">
              {muted.map((session) => (
                <li key={session.id} className="flex items-center gap-3 py-2.5">
                  <BellOff className="size-4 shrink-0 text-zinc-500" />
                  <Link to="/chat/$sessionId" params={{ sessionId: session.id }} className="min-w-0 flex-1 truncate text-sm text-zinc-200 hover:underline">
                    {session.title}
                  </Link>
                  <button
                    type="button"
                    onClick={() => void stub.setSessionMuted(session.id, false)}
                    className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    Unmute
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  )
}
