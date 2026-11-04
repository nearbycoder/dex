package dev.trydex.android.ui

import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import dev.trydex.android.testing.Harness
import dev.trydex.android.testing.awaitTag
import dev.trydex.android.testing.awaitText
import dev.trydex.android.ui.nav.SettingsHome
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Usage one tap away: the meter in the Chats bar, and the live line on Settings' Usage row. */
@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w411dp-h891dp-xxhdpi")
class UsageMeterTest {
    @get:Rule val rule = createComposeRule()
    private val harness = Harness(chunkMs = 0)

    @After fun tearDown() = harness.close()

    @Test fun theBarsMeterOpensUsage() {
        harness.setContent(rule)
        rule.awaitText("Weekly metrics dashboard")
        rule.waitUntil(10_000) {
            rule.onAllNodes(hasContentDescription("Usage, OpenCode Go Month 84% used"), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
        rule.awaitTag("usage-meter").performClick()
        rule.awaitTag("usage")
    }

    @Test fun settingsSaysWhatsMostUsed() {
        harness.setContent(rule)
        rule.awaitText("Weekly metrics dashboard")
        rule.waitUntil(10_000) { harness.graph.usage.glance.value != null }
        val fetched = harness.fake.calls.count { it.first == "usageGlance" }
        rule.runOnIdle { harness.links.send(listOf(SettingsHome)) }
        rule.awaitText("OpenCode Go · Month · 84%")
        // The bar's copy: Settings doesn't ask again.
        assertThat(harness.fake.calls.count { it.first == "usageGlance" }).isEqualTo(fetched)
    }

    @Test fun anOlderAgentGetsThePlainIcon() {
        harness.fake.missing = setOf("usageGlance")
        harness.setContent(rule)
        rule.awaitText("Weekly metrics dashboard")
        rule.waitUntil(10_000) { harness.fake.calls.any { it.first == "usageGlance" } }
        rule.waitForIdle()
        assertThat(rule.onAllNodes(hasContentDescription("Usage"), useUnmergedTree = true).fetchSemanticsNodes()).isNotEmpty()
        rule.runOnIdle { harness.links.send(listOf(SettingsHome)) }
        rule.awaitText("Tokens, cost, and VM time")
    }
}
