package dev.trydex.android.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import androidx.compose.ui.graphics.toArgb
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.core.net.toUri
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import dev.trydex.android.AppGraph
import dev.trydex.android.MainActivity
import dev.trydex.android.R
import dev.trydex.android.data.Faces
import dev.trydex.android.ui.theme.AppThemes
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.DexState
import dev.trydex.core.model.InboxState
import dev.trydex.core.model.McpStatus
import dev.trydex.core.model.SidekickNotify
import dev.trydex.core.model.inboxState
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

/** One notification the app decided to show (the native form of the agent's PushPayload). */
data class Alert(
    val kind: String,
    val tag: String,
    val title: String,
    val body: String,
    /** Opened on tap: dex://app/chat/<id>, dex://app/machine/<key>, dex://app/mcp. */
    val link: String,
    val sessionId: String? = null,
    /** Chats with something unread, for the app icon's badge (the notification's number). */
    val badge: Int? = null,
)

/**
 * What changed between two states that's worth a notification: a reply finished (a sidekick's, as theirs), a snoozed
 * chat came back, a project VM's setup ended, an MCP server needs sign-in again. Pure, so the live socket and the
 * background check share it. Pushes from the agent become the same [Alert]s ([fromPush]).
 */
object Alerts {
    /**
     * [askedHere]: whether this device sent the chat's last message (a sidekick set to notify only when they reach out
     * stays quiet about replies to you).
     */
    fun between(before: DexState?, after: DexState, now: Long, askedHere: (String) -> Boolean = { false }): List<Alert> {
        if (before == null) return emptyList()
        val alerts = mutableListOf<Alert>()
        val previous = before.sessions.associateBy { it.id }
        val badge = after.unreadCount
        for (session in after.sessions) {
            val old = previous[session.id] ?: continue
            if (session.muted) continue
            // Agents that track unread say when a reply finished (and whether someone already saw it); older ones only
            // that the chat stopped working.
            val replied = if (session.repliedAt != null) session.repliedAt!! > (old.repliedAt ?: 0) && session.unread else old.busy && !session.busy
            if (replied) {
                val character = after.character(session.characterId)?.takeIf { it.sessionId == session.id }
                val words = session.lastReply?.takeIf { it.isNotBlank() } ?: "Done."
                if (character != null) {
                    val notify = character.notifyLevel
                    if (notify == SidekickNotify.All || (notify == SidekickNotify.Reachouts && !askedHere(session.id))) {
                        alerts += Alert("sidekick", "chat-${session.id}", character.name, words.take(180), "dex://app/chat/${session.id}", session.id, badge)
                    }
                } else {
                    alerts += Alert("reply", "chat-${session.id}", session.title.take(80), words.take(180), "dex://app/chat/${session.id}", session.id, badge)
                }
            }
            if (inboxState(old, now) == InboxState.Snoozed && inboxState(session, now) == InboxState.Inbox) {
                alerts += Alert("snooze", "chat-${session.id}", session.title.take(80), "Back from snooze.", "dex://app/chat/${session.id}", session.id)
            }
        }
        val oldVms = before.vms.associateBy { it.key }
        for (vm in after.vms) {
            val old = oldVms[vm.key] ?: continue
            if (old.setup.status != "running" || vm.setup.status == "running") continue
            val project = after.session(vm.key)?.projectId?.let(after::project)?.name ?: after.session(vm.key)?.title ?: "Your VM"
            alerts += if (vm.setup.status == "error") {
                Alert("machine", "machine-${vm.key}", "$project: VM setup failed", vm.setup.error ?: "Open the machine to see what went wrong.", "dex://app/machine/${vm.key}")
            } else {
                Alert("machine", "machine-${vm.key}", "$project is ready", "Its VM is set up.", "dex://app/machine/${vm.key}")
            }
        }
        val oldMcp = before.mcp.associateBy { it.id }
        for (server in after.mcp) {
            val old = oldMcp[server.id] ?: continue
            if (old.status != McpStatus.Authenticating && server.status == McpStatus.Authenticating) {
                alerts += Alert("mcp", "mcp-${server.id}", "${server.name} needs you to sign in again", "Its tools stop working in chats until you do.", "dex://app/mcp/${server.id}")
            }
        }
        return alerts
    }

    /**
     * A push from the agent (FcmSender in apps/web/src/agent/native-push.ts sends data only, all strings: title, body,
     * url, tag, kind, sessionId, badge). Null when it isn't one.
     */
    fun fromPush(data: Map<String, String>): Alert? {
        val title = data["title"]?.takeIf { it.isNotBlank() } ?: return null
        val sessionId = data["sessionId"]?.takeIf { it.isNotBlank() }
        val kind = data["kind"]?.takeIf { it.isNotBlank() } ?: "reply"
        return Alert(
            kind = kind,
            tag = data["tag"]?.takeIf { it.isNotBlank() } ?: sessionId?.let { "chat-$it" } ?: "dex-$kind",
            title = title,
            body = data["body"].orEmpty(),
            link = linkFor(data["url"], sessionId),
            sessionId = sessionId,
            badge = data["badge"]?.toIntOrNull(),
        )
    }

    /** A path in Dex (/chat/<id>, /mcp, /notifications) as the app's own link. */
    fun linkFor(url: String?, sessionId: String? = null): String {
        val path = url?.substringBefore('?')?.substringBefore('#')?.takeIf { it.startsWith("/") }
        return when {
            path != null -> "dex://app$path"
            sessionId != null -> "dex://app/chat/$sessionId"
            else -> "dex://app"
        }
    }
}

/** Shows [Alerts] while the app runs, and schedules the background check for when it doesn't. */
class Notifier(private val context: Context, private val graph: AppGraph, private val push: () -> PushRegistrar?) {
    private var last: DexState? = null

    fun start() {
        graph.scope.launch {
            graph.repository.state.filterNotNull().collect { state ->
                // Only the live socket's changes count, not the device's copy shown at launch.
                if (!graph.repository.connected.value) {
                    last = state
                    return@collect
                }
                val alerts = Alerts.between(last, state, System.currentTimeMillis(), graph.repository::sentRecently)
                last = state
                alerts.forEach(::show)
            }
        }
    }

    private fun show(alert: Alert) {
        // With push, the agent notifies this device itself (and knows what's on screen everywhere).
        if (push()?.registered == true) return
        val prefs = graph.preferences.prefs.value
        if (!prefs.notifications || !wantsKind(prefs.notifyKinds, alert.kind)) return
        // Skip what you're looking at.
        if (prefs.onlyWhenAway && alert.sessionId != null && graph.repository.isShowing(alert.sessionId)) return
        post(context, alert, character = graph.repository.state.value?.characters?.firstOrNull { it.sessionId == alert.sessionId })
    }

    fun scheduleChecks() {
        val prefs = graph.preferences.prefs.value
        val work = WorkManager.getInstance(context)
        if (!prefs.notifications || graph.repository.session.value == null) {
            work.cancelUniqueWork(BackgroundCheckWorker.NAME)
            return
        }
        work.enqueueUniquePeriodicWork(
            BackgroundCheckWorker.NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<BackgroundCheckWorker>(15, TimeUnit.MINUTES)
                .setConstraints(androidx.work.Constraints.Builder().setRequiredNetworkType(androidx.work.NetworkType.CONNECTED).build())
                .build(),
        )
    }

    companion object {
        /** Notifications' accent: the chosen theme's (the app sets it), emerald until then. */
        @Volatile var accent: Int = AppThemes.default.accentLight.toArgb()

        const val CHANNEL_SIDEKICKS = "sidekicks"
        const val CHANNEL_UPDATES = "updates"

        /** Channels from before sidekicks; their notifications now go to [CHANNEL_UPDATES]. */
        private val OLD_CHANNELS = listOf("replies", "problems", "activity")

        /** Whether this device's own (local) notifications include [kind]; the test always shows. */
        fun wantsKind(kinds: Set<String>, kind: String) = kind in kinds || kind == "test"

        fun createChannels(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            OLD_CHANNELS.forEach { runCatching { manager.deleteNotificationChannel(it) } }
            manager.createNotificationChannels(
                listOf(
                    NotificationChannel(CHANNEL_SIDEKICKS, context.getString(R.string.notification_channel_sidekicks), NotificationManager.IMPORTANCE_HIGH).apply {
                        description = context.getString(R.string.notification_channel_sidekicks_description)
                    },
                    NotificationChannel(CHANNEL_UPDATES, context.getString(R.string.notification_channel_updates), NotificationManager.IMPORTANCE_DEFAULT).apply {
                        description = context.getString(R.string.notification_channel_updates_description)
                    },
                ),
            )
        }

        fun canPost(context: Context) =
            Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

        fun channelFor(kind: String) = if (kind == "sidekick") CHANNEL_SIDEKICKS else CHANNEL_UPDATES

        private fun openIntent(context: Context, link: String, request: Int) = PendingIntent.getActivity(
            context,
            request,
            Intent(Intent.ACTION_VIEW, link.toUri(), context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        /**
         * The notification for [alert]. A sidekick's comes from them: their face (from [character], or [face] when the
         * caller has only a cached picture) as a conversation, with "Reply to <name>" opening their chat with the
         * keyboard up.
         */
        fun build(context: Context, alert: Alert, character: CharacterProfile? = null, face: Bitmap? = null): android.app.Notification {
            val open = openIntent(context, alert.link, alert.tag.hashCode())
            val builder = NotificationCompat.Builder(context, channelFor(alert.kind))
                .setSmallIcon(R.drawable.ic_stat_dex)
                .setContentTitle(alert.title)
                .setContentText(alert.body)
                .setContentIntent(open)
                .setAutoCancel(true)
                .setColor(accent)
                .setGroup(alert.kind)
                .setCategory(if (alert.kind == "sidekick") NotificationCompat.CATEGORY_MESSAGE else NotificationCompat.CATEGORY_STATUS)
            alert.badge?.takeIf { it > 0 }?.let { builder.setNumber(it) }
            builder.setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            if (alert.kind == "sidekick") {
                val bitmap = face ?: character?.let { faceOf(it) }
                val icon = bitmap?.let { IconCompat.createWithBitmap(it) }
                val sender = Person.Builder().setName(alert.title).setIcon(icon).setKey("sidekick-${alert.sessionId ?: alert.title}").build()
                val you = Person.Builder().setName("You").build()
                builder.setLargeIcon(bitmap)
                    .setStyle(NotificationCompat.MessagingStyle(you).addMessage(alert.body, System.currentTimeMillis(), sender))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                conversationShortcut(context, alert, sender, icon)?.let { builder.setShortcutId(it) }
                if (alert.sessionId != null) {
                    builder.addAction(0, "Reply to ${alert.title}".take(40), openIntent(context, "dex://app/chat/${alert.sessionId}?compose=1", alert.tag.hashCode() + 2))
                }
            } else {
                builder.setStyle(NotificationCompat.BigTextStyle().bigText(alert.body))
                if (alert.sessionId != null && alert.kind != "test") {
                    val mute = PendingIntent.getBroadcast(
                        context,
                        alert.tag.hashCode() + 1,
                        Intent(context, NotificationActionReceiver::class.java)
                            .setAction(NotificationActionReceiver.ACTION_MUTE)
                            .putExtra(NotificationActionReceiver.EXTRA_SESSION, alert.sessionId)
                            .putExtra(NotificationActionReceiver.EXTRA_TAG, alert.tag),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    )
                    builder.addAction(0, "Open chat", open)
                    builder.addAction(0, "Mute this chat", mute)
                }
            }
            return builder.build()
        }

        /** Shows [alert], replacing an older one with the same tag (one per chat). */
        fun post(context: Context, alert: Alert, character: CharacterProfile? = null, face: Bitmap? = null) {
            if (!canPost(context)) return
            @Suppress("MissingPermission")
            NotificationManagerCompat.from(context).notify(alert.tag, 0, build(context, alert, character, face))
        }

        /** A sidekick's face for a notification, from their picture (or their initial). */
        fun faceOf(character: CharacterProfile): Bitmap =
            Faces.round(Faces.decode(Faces.dataUrlBytes(character.image)), character.color, character.face, FACE_PX)

        const val FACE_PX = 192

        /** A long-lived shortcut for the sidekick's chat, so Android shows their messages as a conversation. */
        private fun conversationShortcut(context: Context, alert: Alert, sender: Person, icon: IconCompat?): String? {
            val sessionId = alert.sessionId ?: return null
            val id = "sidekick-$sessionId"
            return runCatching {
                val shortcut = ShortcutInfoCompat.Builder(context, id)
                    .setShortLabel(alert.title.take(24))
                    .setLongLived(true)
                    .setPerson(sender)
                    .setIcon(icon ?: IconCompat.createWithResource(context, R.drawable.ic_shortcut_chat))
                    .setIntent(Intent(Intent.ACTION_VIEW, "dex://app/chat/$sessionId".toUri(), context, MainActivity::class.java))
                    .setCategories(setOf("dev.trydex.android.category.SIDEKICK"))
                    .build()
                ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
                id
            }.getOrNull()
        }

        /** Opening a chat clears its notification. */
        fun clear(context: Context, sessionId: String) {
            NotificationManagerCompat.from(context).cancel("chat-$sessionId", 0)
        }

        /** Signed out: nothing from that account stays on screen. */
        fun clearAll(context: Context) {
            NotificationManagerCompat.from(context).cancelAll()
            runCatching { ShortcutManagerCompat.removeAllDynamicShortcuts(context) }
        }
    }
}
