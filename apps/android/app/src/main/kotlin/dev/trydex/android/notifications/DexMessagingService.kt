package dev.trydex.android.notifications

import android.content.Context
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dev.trydex.android.AppGraph
import dev.trydex.android.DexApplication
import dev.trydex.android.widget.WidgetStore
import dev.trydex.android.widget.WidgetSync

/**
 * Pushes from your agent over Firebase. They're data only (title, body, url, tag, kind, sessionId, badge), so the app
 * builds each notification itself: its channel, the sidekick's face, the chat it opens. Each one also refreshes the
 * home-screen widgets.
 */
class DexMessagingService : FirebaseMessagingService() {
    private val graph: AppGraph get() = (application as DexApplication).graph

    override fun onNewToken(token: String) {
        graph.push.onNewToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        PushReceiver.receive(applicationContext, graph, message.data)
    }
}

/** What a push does, apart from Firebase (so tests and the debug build can hand it data directly). */
object PushReceiver {
    fun receive(context: Context, graph: AppGraph, data: Map<String, String>) {
        // Signed out (or never signed in): a push still aimed at this device shows nothing.
        if (graph.repository.session.value == null) return
        val alert = Alerts.fromPush(data) ?: return
        // On screen right now: the agent skips these when it knows; the socket may simply not have told it yet.
        if (alert.sessionId != null && graph.repository.isShowing(alert.sessionId) && alert.kind != "test") {
            WidgetSync.refreshSoon(context)
            return
        }
        val character = alert.sessionId?.let { id -> graph.repository.state.value?.characters?.firstOrNull { it.sessionId == id } }
        // The app may not be running: the widgets' copy of their picture will do.
        val face = if (alert.kind == "sidekick" && character == null) cachedFace(context, alert.sessionId) else null
        Notifier.post(context, alert, character, face)
        WidgetSync.refreshSoon(context)
    }

    private fun cachedFace(context: Context, sessionId: String?): android.graphics.Bitmap? {
        sessionId ?: return null
        val store = WidgetStore(context)
        val sidekick = store.load()?.sidekicks?.firstOrNull { it.sessionId == sessionId } ?: return null
        return store.face(sidekick, Notifier.FACE_PX)
    }
}
