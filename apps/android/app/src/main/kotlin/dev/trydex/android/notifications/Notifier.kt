package dev.trydex.android.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import dev.trydex.android.AppGraph
import dev.trydex.android.MainActivity
import dev.trydex.android.R
import dev.trydex.core.model.DexState
import dev.trydex.core.model.InboxState
import dev.trydex.core.model.McpStatus
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
)

/**
 * What changed between two states that's worth a notification: a reply finished, a snoozed chat came back, a project
 * VM's setup ended, an MCP server needs sign-in again. Pure, so the live socket and the background check share it.
 */
object Alerts {
    fun between(before: DexState?, after: DexState, now: Long): List<Alert> {
        if (before == null) return emptyList()
        val alerts = mutableListOf<Alert>()
        val previous = before.sessions.associateBy { it.id }
        for (session in after.sessions) {
            val old = previous[session.id] ?: continue
            if (session.muted) continue
            if (old.busy && !session.busy) {
                alerts += Alert("reply", "chat-${session.id}", session.title.take(80), "Done.", "dex://app/chat/${session.id}", session.id)
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
}

/** Shows [Alerts] while the app runs, and schedules the background check for when it doesn't. */
class Notifier(private val context: Context, private val graph: AppGraph) {
    private var last: DexState? = null

    fun start() {
        graph.scope.launch {
            graph.repository.state.filterNotNull().collect { state ->
                // Only the live socket's changes count, not the device's copy shown at launch.
                if (!graph.repository.connected.value) {
                    last = state
                    return@collect
                }
                val alerts = Alerts.between(last, state, System.currentTimeMillis())
                last = state
                alerts.forEach(::show)
            }
        }
    }

    private fun show(alert: Alert) {
        val prefs = graph.preferences.prefs.value
        if (!prefs.notifications || alert.kind !in prefs.notifyKinds) return
        // Skip what you're looking at.
        if (prefs.onlyWhenAway && alert.sessionId != null && graph.repository.isShowing(alert.sessionId)) return
        post(context, alert)
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
        const val CHANNEL_REPLIES = "replies"
        const val CHANNEL_PROBLEMS = "problems"
        const val CHANNEL_ACTIVITY = "activity"

        fun createChannels(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannels(
                listOf(
                    NotificationChannel(CHANNEL_REPLIES, context.getString(R.string.notification_channel_replies), NotificationManager.IMPORTANCE_DEFAULT),
                    NotificationChannel(CHANNEL_PROBLEMS, context.getString(R.string.notification_channel_problems), NotificationManager.IMPORTANCE_HIGH),
                    NotificationChannel(CHANNEL_ACTIVITY, context.getString(R.string.notification_channel_activity), NotificationManager.IMPORTANCE_LOW),
                ),
            )
        }

        fun canPost(context: Context) =
            Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

        fun post(context: Context, alert: Alert) {
            if (!canPost(context)) return
            val open = PendingIntent.getActivity(
                context,
                alert.tag.hashCode(),
                Intent(Intent.ACTION_VIEW, alert.link.toUri(), context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val channel = when (alert.kind) {
                "error", "mcp" -> CHANNEL_PROBLEMS
                "machine", "scheduled" -> CHANNEL_ACTIVITY
                else -> CHANNEL_REPLIES
            }
            val notification = NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_stat_dex)
                .setContentTitle(alert.title)
                .setContentText(alert.body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(alert.body))
                .setContentIntent(open)
                .setAutoCancel(true)
                .setColor(0xFF10B981.toInt())
                .setGroup(alert.kind)
                .apply {
                    if (alert.sessionId != null) {
                        val mute = PendingIntent.getBroadcast(
                            context,
                            alert.tag.hashCode() + 1,
                            Intent(context, NotificationActionReceiver::class.java)
                                .setAction(NotificationActionReceiver.ACTION_MUTE)
                                .putExtra(NotificationActionReceiver.EXTRA_SESSION, alert.sessionId)
                                .putExtra(NotificationActionReceiver.EXTRA_TAG, alert.tag),
                            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                        )
                        addAction(0, "Open chat", open)
                        addAction(0, "Mute this chat", mute)
                    }
                }
                .build()
            @Suppress("MissingPermission")
            NotificationManagerCompat.from(context).notify(alert.tag, 0, notification)
        }

        /** Opening a chat clears its notifications. */
        fun clear(context: Context, sessionId: String) {
            NotificationManagerCompat.from(context).cancel("chat-$sessionId", 0)
        }
    }
}
