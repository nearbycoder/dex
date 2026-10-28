package dev.trydex.android.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

/**
 * Colors with a meaning that the scheme doesn't carry: success, warning, info (status dots, callouts, the activity
 * row), and the code-block surface. Tuned for each mode.
 */
@Immutable
data class DexColors(
    val success: Color,
    val onSuccessContainer: Color,
    val successContainer: Color,
    val warning: Color,
    val warningContainer: Color,
    val onWarningContainer: Color,
    val info: Color,
    val infoContainer: Color,
    val onInfoContainer: Color,
    val danger: Color,
    val codeBackground: Color,
    val codeText: Color,
    val dark: Boolean,
    /** The theme's accent as chosen (Material's `primary` may be a shade darker so white text reads on it). */
    val accent: Color = Color(0xFF059669),
    /** The darker accent shade that white text sits on (a selected swatch, a highlighted row). */
    val selection: Color = Color(0xFF059669),
)

private val LightExtras = DexColors(
    success = Color(0xFF0F8A5F),
    successContainer = Color(0xFFD3F5E4),
    onSuccessContainer = Color(0xFF00391F),
    warning = Color(0xFFB45309),
    warningContainer = Color(0xFFFFE9C7),
    onWarningContainer = Color(0xFF452B00),
    info = Color(0xFF1D64D8),
    infoContainer = Color(0xFFDCE6FF),
    onInfoContainer = Color(0xFF001A43),
    danger = Color(0xFFC62828),
    codeBackground = Color(0xFF1E1E1E),
    codeText = Color(0xFFD4D4D4),
    dark = false,
)

private val DarkExtras = DexColors(
    success = Color(0xFF34D399),
    successContainer = Color(0xFF0E3B2A),
    onSuccessContainer = Color(0xFFB4F2D5),
    warning = Color(0xFFFBBF24),
    warningContainer = Color(0xFF3F2E06),
    onWarningContainer = Color(0xFFFDE68A),
    info = Color(0xFF7DB4FF),
    infoContainer = Color(0xFF15305A),
    onInfoContainer = Color(0xFFD6E4FF),
    danger = Color(0xFFFF8A80),
    codeBackground = Color(0xFF18181B),
    codeText = Color(0xFFD4D4D4),
    dark = true,
)

val LocalDexColors = staticCompositionLocalOf { LightExtras }

object DexTheme {
    val colors: DexColors @Composable get() = LocalDexColors.current
}

/** The theme in use (Settings' Appearance shows it as chosen). */
val LocalAppTheme = staticCompositionLocalOf { AppThemes.default }

/**
 * Dex's look: [theme]'s accent on neutral surfaces, in light or dark per [appearance]. With [dynamicColor] (Android
 * 12+), the wallpaper's Material You colors replace the theme's.
 */
@Composable
fun DexTheme(
    theme: AppTheme = AppThemes.default,
    appearance: AppearanceMode = AppearanceMode.System,
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val darkTheme = when (appearance) {
        AppearanceMode.System -> isSystemInDarkTheme()
        AppearanceMode.Light -> false
        AppearanceMode.Dark -> true
    }
    val dynamic = dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val scheme: ColorScheme = remember(theme, darkTheme, dynamic) {
        if (dynamic) {
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        } else {
            colorSchemeFor(theme, darkTheme)
        }
    }
    val extras = (if (darkTheme) DarkExtras else LightExtras).let {
        if (dynamic) it.copy(accent = scheme.primary, selection = scheme.primary)
        else it.copy(accent = theme.accent(darkTheme), selection = theme.selection(darkTheme))
    }
    CompositionLocalProvider(LocalDexColors provides extras, LocalAppTheme provides theme) {
        MaterialExpressiveTheme(
            colorScheme = scheme,
            motionScheme = MotionScheme.expressive(),
            typography = DexTypography,
            content = content,
        )
    }
}
