package dev.trydex.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dev.trydex.android.notifications.PushReceiver

/**
 * Debug builds only: hands a push to the app as Firebase would, so a notification can be checked without the agent.
 *
 * adb shell am broadcast -n dev.trydex.android/.DebugPush --es kind sidekick --es title Atlas \
 *   --es body "Morning!" --es sessionId chat-atlas --es url /chat/chat-atlas --es tag chat-chat-atlas --es badge 2
 */
class DebugPush : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val extras = intent.extras ?: return
        val data = extras.keySet().associateWith { extras.getString(it).orEmpty() }
        PushReceiver.receive(context, (context.applicationContext as DexApplication).graph, data)
    }
}
