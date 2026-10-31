package dev.trydex.android.ui

import androidx.compose.ui.test.assertIsDisplayed
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
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Characters against the fake Dex: pinned above the chats, their conversations, their page, and making one. */
@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w411dp-h891dp-xxhdpi")
class CharactersTest {
    @get:Rule val rule = createComposeRule()
    private val harness = Harness(chunkMs = 0)

    @After fun tearDown() = harness.close()

    @Test fun pinnedAboveTheChatsWithoutTheirConversations() {
        harness.setContent(rule)
        rule.awaitTag("character-muse")
        rule.onNodeWithText("Your creative sparring partner").assertIsDisplayed()
        rule.onNodeWithTag("character-atlas").assertIsDisplayed()
        rule.onNodeWithText("Weekly metrics dashboard").assertIsDisplayed()
        // Their conversations aren't ordinary chats in the list.
        assertThat(rule.count(hasTestTag("chat-chat-muse"))).isEqualTo(0)
        assertThat(rule.count(hasTestTag("chat-chat-muse-earlier"))).isEqualTo(0)
    }

    @Test fun theirConversationShowsThemAndTheirGreeting() {
        harness.setContent(rule)
        rule.awaitTag("character-muse").performClick()
        rule.awaitTag("character-title")
        rule.awaitTag("character-greeting")
        rule.onNodeWithText("Hey you. What are we making today?", substring = true).assertIsDisplayed()
        rule.awaitText("Message Muse, or / for skills…")
        // No inbox triage for a character's conversation; Start over instead.
        assertThat(rule.count(hasTestTag("settle"))).isEqualTo(0)
        rule.onNodeWithTag("character-start-over").performClick()
        rule.awaitText("Start over with Muse?")
        rule.onNodeWithText("Start over").performClick()
        rule.waitUntil(10_000) { harness.fake.calls.any { it.first == "restartCharacter" } }
        assertThat(harness.fake.calls.first { it.first == "restartCharacter" }.second.toString()).isEqualTo("""["muse"]""")
    }

    @Test fun anEarlierConversationLinksToTheCurrentOne() {
        harness.setContent(rule)
        rule.awaitTag("character-muse")
        // From their page's list of conversations, or a link: the one from before Muse started over.
        harness.links.send(routesFor("dex://app/chat/chat-muse-earlier")!!)
        rule.awaitText("Earlier conversation", substring = true)
        rule.awaitTag("character-earlier").performClick()
        rule.awaitText("Your creative sparring partner")
        assertThat(rule.count(hasTestTag("character-earlier"))).isEqualTo(0)
    }

    @Test fun theirPageEditsMemory() {
        harness.setContent(rule)
        rule.awaitTag("character-muse").performClick()
        rule.awaitTag("character-title").performClick()
        rule.awaitTag("character-editor")
        rule.awaitText("space cats", substring = true)
        rule.onNodeWithTag("character-memory-text").performScrollTo().performTextReplacement("- Loves space cats.")
        rule.onNodeWithTag("character-memory-save").performScrollTo().performClick()
        rule.waitUntil(10_000) { harness.fake.calls.any { it.first == "saveCharacterMemory" } }
        assertThat(harness.fake.calls.first { it.first == "saveCharacterMemory" }.second.toString()).isEqualTo("""["muse","- Loves space cats."]""")
        rule.awaitText("Memory saved")
        // Their conversations: the current one and the one from before Start over.
        rule.onNodeWithTag("character-conversation-chat-muse").performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("character-conversation-chat-muse-earlier").performScrollTo().assertIsDisplayed()
    }

    @Test fun makingOneFromATemplateOpensTheirConversation() {
        harness.setContent(rule)
        rule.awaitTag("character-new").performClick()
        rule.awaitTag("character-editor")
        rule.onNodeWithTag("character-template-rex").performClick()
        rule.awaitText("Coach, hype man, accountability buddy")
        rule.onNodeWithTag("character-save").performClick()
        rule.waitUntil(10_000) { harness.fake.calls.any { it.first == "saveCharacter" } }
        val draft = harness.fake.calls.first { it.first == "saveCharacter" }.second.toString()
        assertThat(draft).contains("\"name\":\"Rex\"")
        assertThat(draft).doesNotContain("\"id\"")
        // Straight to saying hi.
        rule.awaitTag("chat-screen")
        rule.awaitText("Message Rex, or / for skills…")
        rule.awaitText("LET'S GO", substring = true)
    }

    @Test fun pickingALookSendsItAndRenamingKeepsIt() {
        harness.setContent(rule)
        rule.awaitTag("character-muse").performClick()
        rule.awaitTag("character-title").performClick()
        rule.awaitTag("character-editor")
        rule.onNodeWithTag("character-tagline").performScrollTo().performTextReplacement("My muse")
        rule.onNodeWithTag("character-save").performClick()
        rule.waitUntil(10_000) { harness.fake.calls.any { it.first == "saveCharacter" } }
        // Unchanged, the picture and look stay out of the draft so the agent keeps them.
        val renamed = harness.fake.calls.last { it.first == "saveCharacter" }.second.toString()
        assertThat(renamed).contains("\"tagline\":\"My muse\"")
        assertThat(renamed).doesNotContain("\"image\"")
        assertThat(renamed).doesNotContain("\"look\"")
        rule.awaitText("Saved")

        rule.onNodeWithTag("character-look-byte").performScrollTo().performClick()
        rule.onNodeWithTag("character-save").performClick()
        rule.waitUntil(10_000) { harness.fake.calls.count { it.first == "saveCharacter" } == 2 }
        val picked = harness.fake.calls.last { it.first == "saveCharacter" }.second.toString()
        assertThat(picked).contains("\"image\":\"data:image/png;base64,")
        assertThat(picked).contains("\"color\":\"zinc\"")
        assertThat(picked).contains("\"look\":{")
        rule.onNodeWithTag("character-look-web").performScrollTo().assertIsDisplayed()
    }

    private fun ComposeContentTestRule.count(matcher: androidx.compose.ui.test.SemanticsMatcher) =
        onAllNodes(matcher, useUnmergedTree = true).fetchSemanticsNodes().size
}
