package dev.trydex.android.ui

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
import dev.trydex.core.model.ProviderStatus
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** OpenRouter against the fake: its free models in the model menu with or without a key, and its key in Settings. */
@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w411dp-h891dp-xxhdpi")
class OpenRouterTest {
    @get:Rule val rule = createComposeRule()
    private val harness = Harness(chunkMs = 0)

    @After fun tearDown() = harness.close()

    private fun openModelMenu() {
        rule.runOnIdle { harness.links.send(listOf(ChatList, NewChat(nonce = System.nanoTime()))) }
        rule.awaitTag("new-chat-headline")
        rule.waitUntil(10_000) { harness.graph.models.find("openrouter/stealth/crouton-alpha") != null }
        rule.awaitTag("model-picker").performClick()
        rule.awaitTag("model-sheet")
    }

    private fun openSettings() {
        rule.runOnIdle { harness.links.send(listOf(SettingsHome, GeneralSettings)) }
        rule.awaitTag("general-settings")
    }

    @Test fun itsTabListsTheFreeModels() {
        harness.setContent(rule)
        rule.awaitText("Weekly metrics dashboard")
        openModelMenu()
        rule.awaitTag("model-tab-openrouter").performScrollTo().performClick()
        rule.awaitTag("model-openrouter/stealth/crouton-alpha")
        rule.awaitTag("model-openrouter/nvidia/nemotron-3.5-lightning:free")
        assertThat(rule.onAllNodes(hasText("Connect in Settings")).fetchSemanticsNodes()).isEmpty()
    }

    @Test fun withoutAKeyItsModelsStayListedUnderANudge() {
        harness.fake.update { it.copy(openrouter = ProviderStatus()) }
        harness.setContent(rule)
        rule.awaitText("Weekly metrics dashboard")
        openModelMenu()
        rule.awaitTag("model-tab-openrouter").performScrollTo().performClick()
        rule.awaitTag("model-openrouter/stealth/crouton-alpha")
        rule.awaitText("Connect in Settings").performClick()
        rule.awaitTag("general-settings")
        rule.awaitTag("connect-openrouter-key")
    }

    @Test fun connectingAndDisconnectingAKey() {
        harness.fake.update { it.copy(openrouter = ProviderStatus()) }
        harness.setContent(rule)
        rule.awaitText("Weekly metrics dashboard")
        openSettings()
        rule.awaitTag("connect-openrouter-key").performScrollTo().performTextInput("sk-or-v1-0123456789abcd")
        rule.onNodeWithTag("connect-openrouter-submit").performScrollTo().performClick()
        rule.awaitText("3 free models are in the model menu.")
        rule.awaitText("sk-o…abcd")
        assertThat(harness.fake.state.openrouter.connected).isTrue()

        rule.onAllNodes(hasText("Disconnect") and hasAnyAncestor(hasTestTag("connect-openrouter")))[0].performClick()
        rule.waitUntil(10_000) { !harness.fake.state.openrouter.connected }
        rule.awaitTag("connect-openrouter-key")
        assertThat(harness.fake.calls.any { it.first == "disconnectOpenRouter" }).isTrue()
    }
}
