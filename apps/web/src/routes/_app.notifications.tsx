import { createFileRoute, Link } from "@tanstack/react-router"
import { Bell, BellOff, LoaderCircle, Send, Smartphone, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { NotificationsSkeleton } from "~/client/components/skeleton"
import { InfoTip } from "~/client/components/info-tip"
import { Page, Row, Section, Switch } from "~/client/components/ui"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import { disablePush, enablePush, notificationPermission, pushSupport, thisDeviceId } from "~/client/lib/push"
import { NOTIFY_KINDS, type NotifyKind, type PushDevice } from "~/shared/notifications"
import { NOTIFY_LABELS, NOTIFY_LEVELS, type SidekickNotify } from "~/shared/characters"
import { CharacterAvatar } from "~/client/components/agent-avatar"

/** Opt-in push notifications: per device, per kind of update. */
export const Route = createFileRoute("/_app/notifications")({ component: NotificationsPage })

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

  if (!state) return <NotificationsSkeleton />
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
    <Page
      title="Notifications"
      info={
        <>
          Know when Dex finishes, hits a problem, or needs you, even when the app is closed. Off until you turn it on, and set per device. On Android
          and desktop, notifications have quick actions (Open chat, Mute this chat, Watch machine); on iOS, tap one to open the right page. The app
          icon badge counts unread ones.
        </>
      }
    >
      <Section title="This device" aside={device && <span className="truncate">{device.label}</span>}>
        {!push.configured ? (
          <p className="text-sm text-zinc-400">This deployment has no push keys (VAPID) set up.</p>
        ) : support === "needs-install" ? (
          <p className="flex items-center gap-1 text-sm text-zinc-400">
            Add Dex to your Home Screen first.
            <InfoTip label="How to install">
              iPhone and iPad (iOS 16.4+) only deliver notifications to the Home Screen app: in Safari, tap Share → Add to Home Screen, then open Dex
              from there and come back here.
            </InfoTip>
          </p>
        ) : support === "unsupported" ? (
          <p className="text-sm text-zinc-400">This browser can't receive push notifications.</p>
        ) : device ? (
          <div>
            <div className="divide-y divide-zinc-800/80">
              {NOTIFY_KINDS.map((kind) => (
                <Row key={kind.id} label={kind.label} info={kind.description}>
                  <Switch label={kind.label} checked={device.kinds.includes(kind.id)} onChange={(on) => toggleKind(device, kind.id, on)} />
                </Row>
              ))}
              <Row label="Skip what I'm looking at" info="No notification for a chat that's open and visible on any of your devices.">
                <Switch label="Skip what I'm looking at" checked={device.onlyWhenAway} onChange={(onlyWhenAway) => void stub.pushUpdate(device.id, { onlyWhenAway })} />
              </Row>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run("test", async () => {
                    const error = await stub.pushTest(device.id)
                    setMessage(error ? { tone: "error", text: error } : { tone: "ok", text: "Sent. It should arrive in a few seconds." })
                  })
                }
                className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                {busy === "test" ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />} Send a test
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void turnOff()}
                className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-zinc-500 hover:text-red-400 disabled:opacity-50"
              >
                <BellOff className="size-4" /> Turn off
              </button>
            </div>
            {device.error && <p className="mt-2 text-xs text-amber-300">Last delivery failed: {device.error}</p>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void turnOn()}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {busy === "on" ? <LoaderCircle className="size-4 animate-spin" /> : <Bell className="size-4" />} Turn on notifications
            </button>
            {permission === "denied" && (
              <span className="flex items-center gap-1 text-xs text-amber-300">
                Blocked for this site
                <InfoTip label="How to unblock">Allow notifications for Dex in your browser's site settings (on iPhone: Settings → Notifications → Dex), then try again.</InfoTip>
              </span>
            )}
          </div>
        )}
        {message && <p className={`mt-3 text-sm ${message.tone === "error" ? "text-red-400" : "text-emerald-400"}`}>{message.text}</p>}
      </Section>

      {others.length > 0 && (
        <Section title="Other devices" info="Each device has its own choices. Remove one to stop notifications there.">
          <div className="divide-y divide-zinc-800/80">
            {others.map((other) => (
              <Row
                key={other.id}
                icon={<Smartphone className="size-4" />}
                label={`${other.label}${other.platform === "ios" ? " · iPhone app" : other.platform === "android" ? " · Android app" : ""}`}
                detail={
                  <>
                    {other.kinds.length}/{NOTIFY_KINDS.length} kinds · {other.lastSentAt ? `sent ${timeAgo(other.lastSentAt)}` : "nothing sent yet"}
                    {other.error && <span className="text-amber-300"> · last delivery failed</span>}
                  </>
                }
              >
                <button
                  type="button"
                  title="Remove"
                  aria-label={`Remove ${other.label}`}
                  onClick={() => void stub.pushUnsubscribe(other.id)}
                  className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                >
                  <Trash2 className="size-4" />
                </button>
              </Row>
            ))}
          </div>
        </Section>
      )}

      {state.characters.length > 0 && (
        <Section title="Sidekicks" info="Which of each sidekick's messages notify you. Devices also need Sidekicks turned on above.">
          <div className="divide-y divide-zinc-800/80">
            {state.characters.map((character) => (
              <Row
                key={character.id}
                icon={<CharacterAvatar character={character} size={22} />}
                label={
                  <Link to="/sidekicks/$characterId" params={{ characterId: character.id }} className="hover:underline">
                    {character.name}
                  </Link>
                }
                detail={NOTIFY_LABELS[character.notify ?? "all"].description}
              >
                <select
                  value={character.notify ?? "all"}
                  aria-label={`Notifications from ${character.name}`}
                  onChange={(event) => void stub.saveCharacter({ ...character, notify: event.target.value as SidekickNotify })}
                  className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
                >
                  {NOTIFY_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {NOTIFY_LABELS[level].label}
                    </option>
                  ))}
                </select>
              </Row>
            ))}
          </div>
        </Section>
      )}

      {muted.length > 0 && (
        <Section title="Muted chats" info="No notifications from these. Mute or unmute a chat with the bell in its header.">
          <div className="divide-y divide-zinc-800/80">
            {muted.map((session) => (
              <Row
                key={session.id}
                icon={<BellOff className="size-4" />}
                label={
                  <Link to="/chat/$sessionId" params={{ sessionId: session.id }} className="hover:underline">
                    {session.title}
                  </Link>
                }
              >
                <button
                  type="button"
                  onClick={() => void stub.setSessionMuted(session.id, false)}
                  className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  Unmute
                </button>
              </Row>
            ))}
          </div>
        </Section>
      )}
    </Page>
  )
}
