package dev.trydex.android.notifications

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import androidx.core.app.NotificationCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import dev.trydex.android.testing.Harness
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.Characters
import dev.trydex.core.model.DexState
import dev.trydex.core.model.SessionMeta
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf

/** FCM data messages become the right notifications, local alerts follow sidekicks' settings, and registration. */
@RunWith(AndroidJUnit4::class)
class PushTest {
    private val context: Application = ApplicationProvider.getApplicationContext()
    private val manager get() = context.getSystemService(NotificationManager::class.java)

    @Before fun setUp() {
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        Notifier.createChannels(context)
    }

    private val sidekickPush = mapOf(
        "title" to "Atlas",
        "body" to "Morning! The release notes are due today.",
        "url" to "/chat/chat-atlas",
        "tag" to "chat-chat-atlas",
        "kind" to "sidekick",
        "sessionId" to "chat-atlas",
        "badge" to "3",
    )

    @Test fun pushDataBecomesAnAlert() {
        val alert = Alerts.fromPush(sidekickPush)!!
        assertThat(alert).isEqualTo(Alert("sidekick", "chat-chat-atlas", "Atlas", "Morning! The release notes are due today.", "dex://app/chat/chat-atlas", "chat-atlas", 3))
        // The test push, and ones from paths without a chat.
        val test = Alerts.fromPush(mapOf("title" to "Dex notifications are on", "body" to "Hi", "url" to "/notifications", "tag" to "dex-test", "kind" to "test", "sessionId" to "", "badge" to "0"))!!
        assertThat(test.link).isEqualTo("dex://app/notifications")
        assertThat(test.sessionId).isNull()
        assertThat(Alerts.fromPush(mapOf("title" to "GitHub needs you", "url" to "/mcp?x=1", "kind" to "mcp"))!!.link).isEqualTo("dex://app/mcp")
        assertThat(Alerts.fromPush(mapOf("body" to "no title"))).isNull()
    }

    @Test fun aSidekicksPushComesFromThem() {
        val atlas = Characters.TEMPLATES.first { it.key == "atlas" }.applyTo(CharacterProfile("atlas")).copy(sessionId = "chat-atlas")
        val alert = Alerts.fromPush(sidekickPush)!!
        val notification = Notifier.build(context, alert, atlas)
        assertThat(notification.channelId).isEqualTo(Notifier.CHANNEL_SIDEKICKS)
        assertThat(manager.getNotificationChannel(Notifier.CHANNEL_SIDEKICKS).importance).isEqualTo(NotificationManager.IMPORTANCE_HIGH)
        assertThat(notification.number).isEqualTo(3)
        assertThat(notification.getLargeIcon()).isNotNull()
        val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification)!!
        assertThat(style.messages.single().person!!.name.toString()).isEqualTo("Atlas")
        assertThat(style.messages.single().text.toString()).isEqualTo("Morning! The release notes are due today.")
        // Tapping opens their chat; Reply opens it with the keyboard up.
        assertThat(shadowOf(notification.contentIntent).savedIntent.data.toString()).isEqualTo("dex://app/chat/chat-atlas")
        val reply = notification.actions.single()
        assertThat(reply.title.toString()).isEqualTo("Reply to Atlas")
        assertThat(shadowOf(reply.actionIntent).savedIntent.data.toString()).isEqualTo("dex://app/chat/chat-atlas?compose=1")
    }

    @Test fun otherPushesAreChatsAndUpdates() {
        val alert = Alerts.fromPush(mapOf("title" to "Fix the flaky test", "body" to "All green.", "url" to "/chat/chat-tests", "tag" to "chat-chat-tests", "kind" to "reply", "sessionId" to "chat-tests", "badge" to "1"))!!
        val notification = Notifier.build(context, alert)
        assertThat(notification.channelId).isEqualTo(Notifier.CHANNEL_UPDATES)
        assertThat(notification.extras.getCharSequence(Notification.EXTRA_BIG_TEXT).toString()).isEqualTo("All green.")
        assertThat(notification.actions.map { it.title.toString() }).containsExactly("Open chat", "Mute this chat").inOrder()
        // The old channels are gone.
        assertThat(manager.notificationChannels.map { it.id }).containsExactly(Notifier.CHANNEL_SIDEKICKS, Notifier.CHANNEL_UPDATES)
    }

    @Test fun aNewerMessageReplacesTheOlderOneForTheSameChat() {
        val alert = Alerts.fromPush(sidekickPush)!!
        Notifier.post(context, alert)
        Notifier.post(context, alert.copy(body = "Still there?", badge = 4))
        Notifier.post(context, alert.copy(tag = "chat-chat-muse", sessionId = "chat-muse", title = "Muse"))
        val active = shadowOf(manager).allNotifications
        assertThat(active).hasSize(2)
        val atlas = shadowOf(manager).getNotification("chat-chat-atlas", 0)
        assertThat(NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(atlas)!!.messages.single().text.toString()).isEqualTo("Still there?")
        assertThat(atlas.number).isEqualTo(4)
        Notifier.clear(context, "chat-atlas")
        assertThat(shadowOf(manager).allNotifications).hasSize(1)
    }

    @Test fun signedOutPushesShowNothing() = Harness().use { harness ->
        PushReceiver.receive(context, harness.graph, sidekickPush)
        assertThat(shadowOf(manager).allNotifications).isEmpty()
    }

    @Test fun localAlertsFollowEachSidekicksSetting() {
        val before = DexState(
            sessions = listOf(SessionMeta("chat-a", characterId = "a", repliedAt = 1), SessionMeta("chat-b", characterId = "b"), SessionMeta("chat-c", characterId = "c"), SessionMeta("chat-x", busy = true)),
            characters = listOf(
                CharacterProfile("a", name = "Atlas", sessionId = "chat-a", notify = "reachouts"),
                CharacterProfile("b", name = "Muse", sessionId = "chat-b"),
                CharacterProfile("c", name = "Sage", sessionId = "chat-c", notify = "off"),
            ),
        )
        val after = before.copy(
            sessions = listOf(
                SessionMeta("chat-a", characterId = "a", repliedAt = 2, unread = true, lastReply = "Morning!"),
                SessionMeta("chat-b", characterId = "b", repliedAt = 2, unread = true, lastReply = "Space cats."),
                SessionMeta("chat-c", characterId = "c", repliedAt = 2, unread = true, lastReply = "Hi."),
                // An older agent: only busy → done.
                SessionMeta("chat-x", title = "Research", busy = false),
            ),
        )
        val alerts = Alerts.between(before, after, 0)
        assertThat(alerts.map { it.kind to it.title }).containsExactly("sidekick" to "Atlas", "sidekick" to "Muse", "reply" to "Research").inOrder()
        assertThat(alerts.first().body).isEqualTo("Morning!")
        assertThat(alerts.first().badge).isEqualTo(3)
        // Atlas only notifies when he reaches out: not about his answer to what you just sent.
        assertThat(Alerts.between(before, after, 0) { it == "chat-a" }.map { it.title }).doesNotContain("Atlas")
        // Seen already (on another device): no alert.
        val seen = after.copy(sessions = after.sessions.map { it.copy(unread = false) })
        assertThat(Alerts.between(before, seen, 0).map { it.title }).containsExactly("Research")
    }

    @Test fun registersWithTheAgentAndUnregistersOnSignOut() = Harness().use { harness ->
        val push = harness.graph.push
        push.start()
        harness.graph.preferences.setNotifications(true)
        harness.signIn()
        waitFor { harness.fake.calls.any { it.first == "registerNativePush" } }
        val call = harness.fake.calls.first { it.first == "registerNativePush" }.second
        assertThat(call[0]).isEqualTo(JsonPrimitive("android"))
        assertThat(call[1]).isEqualTo(JsonPrimitive("fcm-test-token-0123456789abcdef"))
        assertThat(call[2].toString()).isEqualTo("null")
        assertThat(call[3].toString()).endsWith(" · Android app\"")
        waitFor { push.state.value is PushState.Registered }
        val id = push.deviceId!!
        waitFor { harness.graph.repository.state.value?.push?.devices?.any { it.id == id } == true }
        assertThat(push.device(harness.graph.repository.state.value)!!.platform).isEqualTo("android")
        assertThat(push.registered).isTrue()

        // A new token from Firebase registers again.
        harness.pushTokens.value = "fcm-test-token-new-0123456789abcdef"
        push.onNewToken("fcm-test-token-new-0123456789abcdef")
        waitFor { harness.fake.calls.count { it.first == "registerNativePush" } >= 2 }
        // Another token is another device to the agent.
        waitFor { push.deviceId != null && push.deviceId != id }
        val renewed = push.deviceId!!

        harness.graph.repository.signOut()
        waitFor { harness.fake.calls.any { it.first == "pushUnsubscribe" } }
        assertThat(harness.fake.calls.first { it.first == "pushUnsubscribe" }.second.single()).isEqualTo(JsonPrimitive(renewed))
        waitFor { harness.pushTokens.deleted == 1 }
        assertThat(push.registered).isFalse()
    }

    @Test fun turningNotificationsOffHereUnregisters() = Harness().use { harness ->
        val push = harness.graph.push
        push.start()
        harness.graph.preferences.setNotifications(true)
        harness.signIn()
        waitFor { push.state.value is PushState.Registered }
        harness.graph.preferences.setNotifications(false)
        waitFor { harness.fake.calls.any { it.first == "pushUnsubscribe" } }
        waitFor { push.state.value == PushState.Off }
        assertThat(push.state.value).isEqualTo(PushState.Off)
    }

    @Test fun withoutFirebaseItStaysLocal() = Harness(pushTokens = dev.trydex.android.testing.FakePushTokens(available = false)).use { harness ->
        val push = harness.graph.push
        push.start()
        harness.graph.preferences.setNotifications(true)
        harness.signIn()
        waitFor { push.state.value == PushState.Unavailable }
        assertThat(harness.fake.calls.map { it.first }).doesNotContain("registerNativePush")
    }

    private fun waitFor(timeout: Long = 10_000, condition: () -> Boolean) {
        val until = System.currentTimeMillis() + timeout
        while (!condition()) {
            check(System.currentTimeMillis() < until) { "Timed out" }
            shadowOf(android.os.Looper.getMainLooper()).idle()
            Thread.sleep(20)
        }
    }
}
