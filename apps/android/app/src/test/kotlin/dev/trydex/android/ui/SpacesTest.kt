package dev.trydex.android.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import dev.trydex.android.testing.Harness
import dev.trydex.android.testing.awaitTag
import dev.trydex.android.testing.awaitText
import dev.trydex.android.ui.nav.routesFor
import dev.trydex.fake.FakeData
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Spaces against the fake Dex: listed above the chats, their chat with its threads and notes, and making one. */
@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w411dp-h891dp-xxhdpi")
class SpacesTest {
    @get:Rule val rule = createComposeRule()
    private val harness = Harness(chunkMs = 0)

    @After fun tearDown() = harness.close()

    @Test fun listedAboveTheChatsWithoutTheirChats() {
        harness.setContent(rule)
        rule.awaitTag("space-${FakeData.SPACE}")
        rule.onNodeWithTag("space-summary-${FakeData.SPACE}", useUnmergedTree = true).assertIsDisplayed()
        rule.onNodeWithText("1 working · 1 needs you · 1 failed").assertIsDisplayed()
        // Its coordinator and threads aren't ordinary chats in the list.
        for (id in listOf(FakeData.SPACE_CHAT, FakeData.NOTES_THREAD, FakeData.CI_THREAD, FakeData.STORE_THREAD, FakeData.ICONS_THREAD)) {
            assertThat(rule.count(hasTestTag("chat-$id"))).isEqualTo(0)
        }
    }

    @Test fun itsChatShowsThreadCardsUpdatesAndThePanel() {
        harness.setContent(rule)
        rule.awaitTag("space-${FakeData.SPACE}").performClick()
        rule.awaitTag("space-title")
        // The threads it started, live, and what they reported back as event rows rather than your words.
        rule.awaitTag("thread-card-${FakeData.CI_THREAD}")
        rule.awaitTag("space-update-${FakeData.NOTES_THREAD}")
        rule.onNodeWithText("“Write the 2.4 release notes” finished").assertIsDisplayed()
        assertThat(rule.count(hasTestTag("settle"))).isEqualTo(0)

        rule.onNodeWithTag("space-threads").performClick()
        rule.awaitTag("space-threads-panel")
        rule.awaitTag("status-needs_you")
        rule.onNodeWithTag("thread-${FakeData.STORE_THREAD}").assertIsDisplayed()
        rule.onNodeWithTag("space-tab-notes").performClick()
        rule.awaitText("Ledger")
        rule.onNodeWithTag("space-tab-threads").performClick()
        rule.awaitTag("thread-${FakeData.NOTES_THREAD}").performClick()

        // A thread knows its space, and leads back to it.
        rule.awaitTag("thread-space").performClick()
        rule.awaitTag("space-title")
    }

    @Test fun makingOneOpensItsChat() {
        harness.setContent(rule)
        rule.awaitTag("space-new").performClick()
        rule.awaitTag("space-editor")
        rule.onNodeWithTag("space-name").performTextReplacement("Docs")
        rule.onNodeWithTag("space-goal").performTextReplacement("Better docs")
        rule.onNodeWithTag("space-project-dex-web").performScrollTo().performClick()
        rule.onNodeWithTag("space-save").assertIsEnabled().performClick()
        rule.waitUntil(10_000) { harness.fake.calls.any { it.first == "saveSpace" } }
        assertThat(harness.fake.calls.first { it.first == "saveSpace" }.second.toString())
            .isEqualTo("""[{"name":"Docs","goal":"Better docs","projectId":"dex-web"}]""")
        rule.awaitTag("space-title")
        rule.awaitTag("empty-hint")
        rule.onNodeWithText("Tell Dex what to work on", substring = true).assertIsDisplayed()
    }

    @Test fun deletingAsksFirst() {
        harness.setContent(rule)
        rule.awaitTag("space-${FakeData.SPACE}")
        harness.links.send(routesFor("dex://app/chat/${FakeData.SPACE_CHAT}")!!)
        rule.awaitTag("chat-options").performClick()
        rule.awaitText("Delete space").performClick()
        rule.awaitText("Deletes the space, its chat, and its 4 threads with their VMs. This can't be undone.")
        rule.onNodeWithText("Delete").performClick()
        rule.waitUntil(10_000) { harness.fake.state.space(FakeData.SPACE) == null }
        rule.waitUntil(10_000) { rule.count(hasTestTag("space-${FakeData.SPACE}")) == 0 }
    }

    private fun ComposeContentTestRule.count(matcher: androidx.compose.ui.test.SemanticsMatcher) =
        onAllNodes(matcher, useUnmergedTree = true).fetchSemanticsNodes().size
}
