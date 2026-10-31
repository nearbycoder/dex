package dev.trydex.android.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dev.trydex.android.AppGraph
import dev.trydex.android.DexApplication
import dev.trydex.android.data.LocalCache
import dev.trydex.android.widget.WidgetSync
import dev.trydex.core.client.AgentConnection
import dev.trydex.core.client.ConnectionStatus
import dev.trydex.core.client.DexApi
import dev.trydex.core.client.asRpc
import dev.trydex.core.model.DexState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File

/**
 * Runs [block] with the app's socket if it's up, else with a short-lived one of its own (for work done while the app
 * isn't open). Returns null if the agent couldn't be reached in time.
 */
suspend fun <T> withAgent(graph: AppGraph, timeoutMs: Long = 30_000, block: suspend (DexApi, DexState?) -> T): T? {
    val repository = graph.repository
    if (repository.connected.value) return block(repository.api, repository.state.value)
    val session = repository.session.value ?: return null
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val connection = AgentConnection(graph.http, session.serverUrl, session.user.id, { session.token }, scope)
    return try {
        connection.start()
        withTimeoutOrNull(timeoutMs) {
            val status = connection.status.first { it == ConnectionStatus.Connected || it is ConnectionStatus.SignedOut }
            if (status != ConnectionStatus.Connected) return@withTimeoutOrNull null
            block(DexApi(connection.asRpc()), connection.state.value)
        }
    } finally {
        connection.stop()
        scope.cancel()
    }
}

/**
 * Every 15 minutes while notifications are on and the app isn't open: connects briefly, compares the agent's state
 * with the last one this device saw, and notifies about what finished or came back since.
 */
class BackgroundCheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val graph = (applicationContext as DexApplication).graph
        val repository = graph.repository
        val user = repository.userId ?: return Result.success()
        val prefs = graph.preferences.prefs.value
        if (!prefs.notifications) return Result.success()
        // The app is open: its own socket notifies.
        if (repository.connected.value) return Result.success()
        val cache = LocalCache(File(applicationContext.filesDir, "dex-cache"))
        val before = cache.loadState(user)
        val fresh = withAgent(graph) { _, state -> state } ?: return Result.retry()
        // With push, the agent notified this device already.
        if (!graph.push.registered) {
            for (alert in Alerts.between(before, fresh, System.currentTimeMillis())) {
                if (Notifier.wantsKind(prefs.notifyKinds, alert.kind)) {
                    Notifier.post(applicationContext, alert, character = fresh.characters.firstOrNull { it.sessionId == alert.sessionId })
                }
            }
        }
        cache.saveState(user, fresh)
        WidgetSync.fromState(applicationContext, fresh)
        return Result.success()
    }

    companion object {
        const val NAME = "dex-background-check"
    }
}

/** A notification's "Mute this chat", done without opening the app. */
class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_MUTE) return
        val sessionId = intent.getStringExtra(EXTRA_SESSION) ?: return
        val tag = intent.getStringExtra(EXTRA_TAG)
        val graph = (context.applicationContext as DexApplication).graph
        val pending = goAsync()
        graph.scope.launch {
            try {
                withAgent(graph) { api, _ -> api.setSessionMuted(sessionId, true) }
                tag?.let { NotificationManagerCompat.from(context).cancel(it, 0) }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_MUTE = "dev.trydex.android.MUTE"
        const val EXTRA_SESSION = "session"
        const val EXTRA_TAG = "tag"
    }
}
