package dev.trydex.android.ui

import android.os.Looper
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import dev.trydex.android.data.AppPrefs
import dev.trydex.android.testing.Harness
import dev.trydex.android.testing.awaitTag
import dev.trydex.android.ui.nav.routesFor
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Settings → Appearance: picking a theme and a mode is kept on this device. */
@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w411dp-h891dp-xxhdpi")
class AppearanceTest {
    @get:Rule val rule = createComposeRule()
    private val harness = Harness(chunkMs = 0)

    @After fun tearDown() = harness.close()

    /** Waits for the saved preferences (DataStore answers on the main looper, which the compose rule doesn't run). */
    private fun awaitPrefs(check: (AppPrefs) -> Boolean) = rule.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idle()
        check(harness.graph.preferences.prefs.value)
    }

    @Test fun pickThemeAndMode() {
        harness.setContent(rule)
        harness.links.send(routesFor("dex://app/appearance")!!)
        rule.awaitTag("settings-appearance")
        awaitPrefs { it.theme == "emerald" }

        rule.awaitTag("theme-ocean").performScrollTo().performClick()
        awaitPrefs { it.theme == "ocean" && !it.dynamicColor }

        rule.awaitTag("appearance-dark").performClick()
        awaitPrefs { it.appearance == "dark" }
        assertThat(harness.graph.preferences.prefs.value.theme).isEqualTo("ocean")

        // Back to the defaults, so other tests (which share the device's preferences) start from them.
        rule.awaitTag("theme-emerald").performScrollTo().performClick()
        rule.awaitTag("appearance-system").performClick()
        awaitPrefs { it.theme == "emerald" && it.appearance == "system" }
    }
}
