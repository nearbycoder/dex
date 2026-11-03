package dev.trydex.android.ui

import android.os.Looper
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import dev.trydex.android.data.AppPrefs
import dev.trydex.android.testing.Harness
import dev.trydex.android.testing.awaitTag
import dev.trydex.android.testing.awaitText
import dev.trydex.android.ui.nav.ChatList
import dev.trydex.android.ui.nav.NewChat
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The model menu's release dates: New badges, the Newest list in sections, and its "released within" filter. */
@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w411dp-h891dp-xxhdpi")
class ModelPickerTest {
    @get:Rule val rule = createComposeRule()
    private val harness = Harness(chunkMs = 0)

    @After fun tearDown() = harness.close()

    /** Waits for the saved preferences (DataStore answers on the main looper, which the compose rule doesn't run). */
    private fun awaitPrefs(check: (AppPrefs) -> Boolean) = rule.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idle()
        check(harness.graph.preferences.prefs.value)
    }

    private fun openModelMenu() {
        harness.setContent(rule)
        rule.awaitText("Weekly metrics dashboard")
        rule.runOnIdle { harness.links.send(listOf(ChatList, NewChat(nonce = System.nanoTime()))) }
        rule.awaitTag("new-chat-headline")
        // The fake's catalog (with release dates) replaces the built-in list once fetched.
        rule.waitUntil(10_000) { harness.graph.models.find("cline-pass/crouton-alpha") != null }
        awaitPrefs { !it.modelsNewest }
        rule.awaitTag("model-picker").performClick()
        rule.awaitTag("model-sheet")
    }

    private fun inRow(id: String, text: String, substring: Boolean = false) =
        rule.onAllNodes(hasText(text, substring = substring) and hasAnyAncestor(hasTestTag("model-$id")), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()

    @Test fun searchFindsNewModels() {
        openModelMenu()
        rule.onAllNodes(hasText("Search models")).onFirst().performTextInput("new")
        rule.awaitTag("model-cline-pass/crouton-alpha")
        rule.waitForIdle()
        assertThat(inRow("cline-pass/crouton-alpha", "New")).isTrue()
        // A model from before the last two weeks doesn't match.
        assertThat(rule.onAllNodes(hasTestTag("model-cline-pass/kimi-k3")).fetchSemanticsNodes()).isEmpty()
    }

    @Test fun newestListsByReleaseAndFilters() {
        openModelMenu()
        rule.awaitTag("model-newest").performClick()
        rule.awaitText("THIS WEEK")
        awaitPrefs { it.modelsNewest }
        // Each row says its subscription; the maker is left to the logo.
        assertThat(inRow("cline-pass/crouton-alpha", "Cline", substring = true)).isTrue()
        rule.awaitTag("model-within-7").performScrollTo().performClick()
        rule.waitForIdle()
        assertThat(rule.onAllNodes(hasText("THIS MONTH")).fetchSemanticsNodes()).isEmpty()
        // ChatGPT's newest is 9 days old.
        rule.awaitTag("model-tab-chatgpt").performScrollTo().performClick()
        rule.awaitText("Nothing new in that time.")
        // Off again, so other tests (which share the device's preferences) start from the default.
        rule.awaitTag("model-newest").performClick()
        awaitPrefs { !it.modelsNewest }
    }
}
