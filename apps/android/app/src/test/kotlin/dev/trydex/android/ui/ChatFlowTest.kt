package dev.trydex.android.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import dev.trydex.android.testing.Harness
import dev.trydex.android.testing.awaitTag
import dev.trydex.android.testing.awaitText
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Chats against the fake Dex: the inbox, opening a chat, sending, generated UI, and the queue. */
@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w411dp-h891dp-xxhdpi")
class ChatFlowTest {
    @get:Rule val rule = createComposeRule()
    private val harness = Harness(chunkMs = 0)

    @After fun tearDown() = harness.close()

    @Test fun inboxShowsChatsAndGroups() {
        harness.setContent(rule)
        rule.awaitText("Weekly metrics dashboard")
        rule.onNodeWithText("Fix the flaky login test").assertIsDisplayed()
        rule.onNodeWithText("Snoozed").assertIsDisplayed()
        rule.onNodeWithText("Settled").assertIsDisplayed()
        // Snoozed and settled chats stay folded away.
        assertThat(rule.onAllNodesWithTextCount("Renew the TLS certificates")).isEqualTo(0)
    }

    @Test fun openChatSendAndGetReply() {
        harness.setContent(rule)
        rule.awaitText("Compare vector databases").performClick()
        rule.awaitTag("composer-input").performTextInput("Summarise it in one line")
        rule.onNodeWithTag("send").performClick()
        rule.awaitText("Summarise it in one line")
        // The fake answers every message; the reply streams into the transcript.
        rule.waitUntil(10_000) { harness.fake.calls.any { it.first == "sendMessage" } }
        assertThat(harness.fake.calls.last { it.first == "sendMessage" }.second.toString()).contains("Summarise it in one line")
    }

    @Test fun generatedUiRendersAndActsNatively() {
        harness.setContent(rule)
        rule.awaitText("Weekly metrics dashboard").performClick()
        rule.awaitTag("openui-card-host")
        rule.awaitTag("openui-chart")
        rule.awaitText("Explain the dip on Saturday").performClick()
        // A @ToAssistant button sends its message as a [UI action].
        rule.waitUntil(10_000) { harness.fake.calls.any { it.first == "sendMessage" && it.second.toString().contains("[UI action] ") } }
    }

    @Test fun newChatStartsWithAgent() {
        harness.setContent(rule)
        rule.awaitTag("new-chat").performClick()
        rule.awaitTag("new-chat-headline")
        rule.awaitTag("agent-data-analyst").performClick()
        rule.awaitText("What should Data Analyst do?")
        rule.onNodeWithTag("composer-input").performTextInput("Chart last week's signups")
        rule.onNodeWithTag("send").performClick()
        rule.waitUntil(10_000) { harness.fake.calls.any { it.first == "createSession" } }
        val created = harness.fake.calls.first { it.first == "createSession" }.second.toString()
        assertThat(created).contains("data-analyst")
        rule.awaitTag("chat-screen")
    }

    private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithTextCount(text: String) =
        onAllNodes(androidx.compose.ui.test.hasText(text)).fetchSemanticsNodes().size
}
