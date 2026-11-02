package dev.trydex.android.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import dev.trydex.android.testing.Harness
import dev.trydex.android.testing.awaitTag
import dev.trydex.android.testing.awaitText
import dev.trydex.android.ui.nav.ChatList
import dev.trydex.android.ui.nav.GeneralSettings
import dev.trydex.android.ui.nav.NewChat
import dev.trydex.android.ui.nav.SettingsHome
import dev.trydex.core.model.ModelProvider
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Command Code against the fake: its tab in the model menu, and connecting a key in Settings so its models join. */
@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w411dp-h891dp-xxhdpi")
class CommandCodeTest {
    @get:Rule val rule = createComposeRule()
    private val harness = Harness(chunkMs = 0)

    @After fun tearDown() = harness.close()

    private fun openModelMenu() {
        rule.runOnIdle { harness.links.send(listOf(ChatList, NewChat(nonce = System.nanoTime()))) }
        rule.awaitTag("new-chat-headline")
        rule.awaitTag("model-picker").performClick()
        rule.awaitTag("model-sheet")
    }

    @Test fun itsTabSaysToConnectUntilAKeyIs() {
        harness.setContent(rule)
        rule.awaitText("Weekly metrics dashboard")
        openModelMenu()
        rule.awaitTag("model-tab-commandcode").performScrollTo().performClick()
        rule.awaitTag("model-sheet-unlisted")
        rule.awaitText("Connect Command Code in Settings to see the models your plan covers.").assertIsDisplayed()
    }

    @Test fun connectingAKeyListsItsPlansModels() {
        harness.setContent(rule)
        rule.awaitText("Weekly metrics dashboard")
        rule.runOnIdle { harness.links.send(listOf(SettingsHome, GeneralSettings)) }
        rule.awaitTag("general-settings")
        rule.awaitTag("connect-commandcode-key").performScrollTo().performTextInput("cc_live_0123456789abcd")
        rule.onNodeWithTag("connect-commandcode-submit").performScrollTo().performClick()
        rule.awaitText("3 models on your plan are in the model menu.")
        rule.awaitText("cc_l…abcd")
        rule.waitUntil(10_000) { harness.graph.models.of(ModelProvider.CommandCode).size == 3 }

        openModelMenu()
        rule.awaitTag("model-tab-commandcode").performScrollTo().performClick()
        rule.awaitTag("model-commandcode/deepseek/deepseek-v4.1-flash")
        rule.awaitTag("model-commandcode/mistralai/devstral-3")
        assertThat(rule.onAllNodes(hasTestTag("model-sheet-unlisted")).fetchSemanticsNodes()).isEmpty()
    }

    @Test fun disconnectingAsksForAKeyAgain() {
        harness.fake.update { it.copy(commandcode = it.commandcode.copy(connected = true, source = "user", keyHint = "cc_a…9f2b")) }
        harness.setContent(rule)
        rule.awaitText("Weekly metrics dashboard")
        rule.runOnIdle { harness.links.send(listOf(SettingsHome, GeneralSettings)) }
        rule.awaitTag("general-settings")
        rule.awaitTag("connect-commandcode").performScrollTo()
        rule.awaitText("cc_a…9f2b")
        rule.onAllNodes(hasText("Disconnect") and hasAnyAncestor(hasTestTag("connect-commandcode")))[0].performClick()
        rule.waitUntil(10_000) { !harness.fake.state.commandcode.connected }
        rule.awaitTag("connect-commandcode-key")
        assertThat(harness.fake.calls.any { it.first == "disconnectCommandCode" }).isTrue()
    }
}
