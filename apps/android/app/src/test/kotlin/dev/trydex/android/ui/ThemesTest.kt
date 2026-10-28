package dev.trydex.android.ui

import com.google.common.truth.Truth.assertThat
import com.google.common.truth.Truth.assertWithMessage
import dev.trydex.android.ui.theme.AppThemes
import dev.trydex.android.ui.theme.AppearanceMode
import dev.trydex.android.ui.theme.colorSchemeFor
import dev.trydex.android.ui.theme.contrast
import org.junit.Test

/** The ten themes (the iOS app has the same) and the schemes made from them. */
class ThemesTest {
    @Test fun tenThemesEmeraldFirst() {
        assertThat(AppThemes.all).hasSize(10)
        assertThat(AppThemes.all.map { it.id }.toSet()).hasSize(10)
        assertThat(AppThemes.all.map { it.id }).containsExactly(
            "emerald", "graphite", "ocean", "indigo", "violet", "fuchsia", "rose", "sunset", "amber", "teal",
        ).inOrder()
        assertThat(AppThemes.default.id).isEqualTo("emerald")
    }

    @Test fun unknownIdsFallBackToTheDefault() {
        assertThat(AppThemes.byId(null)).isEqualTo(AppThemes.default)
        assertThat(AppThemes.byId("neon")).isEqualTo(AppThemes.default)
        assertThat(AppThemes.byId("ocean").name).isEqualTo("Ocean")
        assertThat(AppearanceMode.byId("dark")).isEqualTo(AppearanceMode.Dark)
        assertThat(AppearanceMode.byId("sepia")).isEqualTo(AppearanceMode.System)
    }

    @Test fun textReadsOnTheAccentInEveryThemeAndMode() {
        for (theme in AppThemes.all) {
            for (dark in listOf(false, true)) {
                val scheme = colorSchemeFor(theme, dark)
                val mode = if (dark) "dark" else "light"
                assertWithMessage("${theme.id} $mode onPrimary").that(contrast(scheme.onPrimary, scheme.primary)).isAtLeast(4.5f)
                assertWithMessage("${theme.id} $mode onPrimaryContainer").that(contrast(scheme.onPrimaryContainer, scheme.primaryContainer)).isAtLeast(4.5f)
                assertWithMessage("${theme.id} $mode onSecondaryContainer").that(contrast(scheme.onSecondaryContainer, scheme.secondaryContainer)).isAtLeast(4.5f)
                // Links and accent text sit on the page.
                assertWithMessage("${theme.id} $mode primary on surface").that(contrast(scheme.primary, scheme.surface)).isAtLeast(3f)
            }
        }
    }

    @Test fun surfacesAreTheSameGraysInEveryTheme() {
        for (dark in listOf(false, true)) {
            val surfaces = AppThemes.all.map { colorSchemeFor(it, dark).let { s -> listOf(s.surface, s.surfaceContainer, s.surfaceContainerHighest, s.onSurfaceVariant) } }
            assertThat(surfaces.toSet()).hasSize(1)
        }
    }
}
