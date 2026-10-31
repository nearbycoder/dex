package dev.trydex.android.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import dev.trydex.android.testing.Harness
import dev.trydex.android.testing.awaitTag
import dev.trydex.android.testing.awaitText
import dev.trydex.android.ui.nav.routesFor
import dev.trydex.fake.FakeData
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Unread chats and sidekicks, scheduled notes, Mark as unread, and each sidekick's notifications, against the fake. */
@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w411dp-h891dp-xxhdpi")
class UnreadTest {
    @get:Rule val rule = createComposeRule()
    private val harness = Harness(chunkMs = 0)

    @After fun tearDown() = harness.close()

    @Test fun unreadChatsAndSidekicksStandOut() {
        harness.setContent(rule)
        rule.awaitTag("character-atlas")
        // Atlas reached out: his words instead of his tagline, and a dot. Muse has nothing new.
        rule.onNodeWithTag("unread-chat-atlas", useUnmergedTree = true).assertIsDisplayed()
        rule.onNodeWithText(FakeData.ATLAS_CHECK_IN).assertIsDisplayed()
        rule.onNodeWithText("Your creative sparring partner").assertIsDisplayed()
        assertThat(rule.count(hasTestTag("unread-chat-muse"))).isEqualTo(0)
        rule.onNodeWithTag("unread-chat-research", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
        assertThat(rule.count(hasTestTag("unread-chat-dashboard"))).isEqualTo(0)
    }

    @Test fun openingASidekickReadsItAndShowsTheirCheckInAsANote() {
        harness.setContent(rule)
        rule.awaitTag("character-atlas").performClick()
        rule.awaitTag("scheduled-note")
        rule.onNodeWithText("⏰ Scheduled: Check in about the Android release notes due today").assertIsDisplayed()
        rule.awaitText(FakeData.ATLAS_CHECK_IN)
        // Not a message from you.
        assertThat(rule.count(hasTestTag("user-message"))).isEqualTo(1)
        rule.waitUntil(10_000) { harness.fake.state.session("chat-atlas")?.unread == false }
        assertThat(harness.graph.repository.isShowing("chat-atlas")).isTrue()
    }

    @Test fun markAsUnreadFromTheMenu() {
        harness.setContent(rule)
        rule.awaitTag("character-muse").performClick()
        rule.awaitTag("chat-options").performClick()
        rule.awaitText("Mark as unread").performClick()
        rule.waitUntil(10_000) { harness.fake.calls.any { it.first == "markSessionUnread" } }
        assertThat(harness.fake.calls.first { it.first == "markSessionUnread" }.second.toString()).isEqualTo("""["chat-muse"]""")
        // It leaves the chat, so it isn't read again at once.
        rule.awaitTag("chat-list")
        rule.waitUntil(10_000) { harness.fake.state.session("chat-muse")?.unread == true }
        rule.awaitTag("unread-chat-muse")
    }

    @Test fun theBellInTheirChatTurnsTheirNotificationsOff() {
        harness.setContent(rule)
        rule.awaitTag("character-muse").performClick()
        rule.awaitTag("character-notify").performClick()
        rule.waitUntil(10_000) { harness.fake.calls.any { it.first == "saveCharacter" } }
        val draft = harness.fake.calls.first { it.first == "saveCharacter" }.second.single().jsonObject
        assertThat(draft["notify"].toString()).isEqualTo("\"off\"")
        // Their picture and look stay as they are.
        assertThat(draft.keys).containsNoneOf("image", "look")
        rule.waitUntil(10_000) { harness.fake.state.character("muse")?.notify == "off" }
    }

    @Test fun notificationsListEachSidekick() {
        harness.setContent(rule)
        rule.awaitTag("chat-list")
        harness.links.send(routesFor("dex://app/notifications")!!)
        rule.awaitTag("sidekick-notify-atlas")
        rule.onNodeWithText("When they reach out").assertIsDisplayed()
        rule.onNodeWithTag("sidekick-notify-menu-muse").performScrollTo().performClick()
        rule.awaitTag("sidekick-notify-muse-reachouts").performClick()
        rule.waitUntil(10_000) { harness.fake.state.character("muse")?.notify == "reachouts" }
        // Sidekicks are the first kind; the agent's other devices are listed with what they are.
        rule.awaitText("Mac · Chrome")
    }

    private fun ComposeContentTestRule.count(matcher: androidx.compose.ui.test.SemanticsMatcher) =
        onAllNodes(matcher, useUnmergedTree = true).fetchSemanticsNodes().size
}
