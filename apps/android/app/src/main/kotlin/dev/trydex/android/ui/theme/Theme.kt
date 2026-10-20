package dev.trydex.android.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

/** Dex's own scheme (seeded from its emerald), used where the device has no dynamic color. */
private val DexLight = lightColorScheme(
    primary = Color(0xFF006C4C),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF89F8C7),
    onPrimaryContainer = Color(0xFF002114),
    secondary = Color(0xFF4C6358),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFCEE9DA),
    onSecondaryContainer = Color(0xFF092016),
    tertiary = Color(0xFF3E6374),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFC1E8FB),
    onTertiaryContainer = Color(0xFF001F29),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
    background = Color(0xFFF4FBF7),
    onBackground = Color(0xFF171D1A),
    surface = Color(0xFFF4FBF7),
    onSurface = Color(0xFF171D1A),
    surfaceVariant = Color(0xFFDBE5DE),
    onSurfaceVariant = Color(0xFF404943),
    outline = Color(0xFF707973),
    outlineVariant = Color(0xFFBFC9C2),
    inverseSurface = Color(0xFF2C322E),
    inverseOnSurface = Color(0xFFECF2ED),
    inversePrimary = Color(0xFF6CDBAC),
    surfaceDim = Color(0xFFD5DCD7),
    surfaceBright = Color(0xFFF4FBF7),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFEFF5F0),
    surfaceContainer = Color(0xFFE9EFEB),
    surfaceContainerHigh = Color(0xFFE3EAE5),
    surfaceContainerHighest = Color(0xFFDDE4DF),
)

private val DexDark = darkColorScheme(
    primary = Color(0xFF6CDBAC),
    onPrimary = Color(0xFF003826),
    primaryContainer = Color(0xFF005138),
    onPrimaryContainer = Color(0xFF89F8C7),
    secondary = Color(0xFFB3CCBF),
    onSecondary = Color(0xFF1F352B),
    secondaryContainer = Color(0xFF354B41),
    onSecondaryContainer = Color(0xFFCEE9DA),
    tertiary = Color(0xFFA5CCDF),
    onTertiary = Color(0xFF073544),
    tertiaryContainer = Color(0xFF254B5B),
    onTertiaryContainer = Color(0xFFC1E8FB),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
    background = Color(0xFF0E1512),
    onBackground = Color(0xFFDDE4DF),
    surface = Color(0xFF0E1512),
    onSurface = Color(0xFFDDE4DF),
    surfaceVariant = Color(0xFF404943),
    onSurfaceVariant = Color(0xFFBFC9C2),
    outline = Color(0xFF8A938D),
    outlineVariant = Color(0xFF404943),
    inverseSurface = Color(0xFFDDE4DF),
    inverseOnSurface = Color(0xFF2C322E),
    inversePrimary = Color(0xFF006C4C),
    surfaceDim = Color(0xFF0E1512),
    surfaceBright = Color(0xFF343B37),
    surfaceContainerLowest = Color(0xFF09100D),
    surfaceContainerLow = Color(0xFF171D1A),
    surfaceContainer = Color(0xFF1B211E),
    surfaceContainerHigh = Color(0xFF252B28),
    surfaceContainerHighest = Color(0xFF303633),
)

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
    codeBackground = Color(0xFF161B18),
    codeText = Color(0xFFD4D4D4),
    dark = true,
)

val LocalDexColors = staticCompositionLocalOf { LightExtras }

object DexTheme {
    val colors: DexColors @Composable get() = LocalDexColors.current
}

@Composable
fun DexTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val scheme: ColorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        darkTheme -> DexDark
        else -> DexLight
    }
    CompositionLocalProvider(LocalDexColors provides if (darkTheme) DarkExtras else LightExtras) {
        MaterialExpressiveTheme(
            colorScheme = scheme,
            motionScheme = MotionScheme.expressive(),
            typography = DexTypography,
            content = content,
        )
    }
}

