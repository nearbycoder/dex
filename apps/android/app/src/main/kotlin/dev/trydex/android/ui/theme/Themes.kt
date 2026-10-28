package dev.trydex.android.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance

/**
 * One of Dex's color themes: an accent for each mode, and the darker selection shade that white text sits on (the
 * same ten as the iOS app's). Everything else (surfaces, text) is a neutral gray, so only the accent changes.
 */
@Immutable
data class AppTheme(
    val id: String,
    val name: String,
    val accentLight: Color,
    val accentDark: Color,
    val selectionLight: Color,
    val selectionDark: Color,
) {
    fun accent(dark: Boolean) = if (dark) accentDark else accentLight
    fun selection(dark: Boolean) = if (dark) selectionDark else selectionLight
}

object AppThemes {
    val Emerald = AppTheme("emerald", "Emerald", Color(0xFF059669), Color(0xFF34D399), Color(0xFF059669), Color(0xFF047857))

    val all: List<AppTheme> = listOf(
        Emerald,
        AppTheme("graphite", "Graphite", Color(0xFF3F3F46), Color(0xFFD4D4D8), Color(0xFF52525B), Color(0xFF3F3F46)),
        AppTheme("ocean", "Ocean", Color(0xFF2563EB), Color(0xFF60A5FA), Color(0xFF2563EB), Color(0xFF1D4ED8)),
        AppTheme("indigo", "Indigo", Color(0xFF4F46E5), Color(0xFF818CF8), Color(0xFF4F46E5), Color(0xFF4338CA)),
        AppTheme("violet", "Violet", Color(0xFF7C3AED), Color(0xFFA78BFA), Color(0xFF7C3AED), Color(0xFF6D28D9)),
        AppTheme("fuchsia", "Fuchsia", Color(0xFFC026D3), Color(0xFFE879F9), Color(0xFFC026D3), Color(0xFFA21CAF)),
        AppTheme("rose", "Rose", Color(0xFFE11D48), Color(0xFFFB7185), Color(0xFFE11D48), Color(0xFFBE123C)),
        AppTheme("sunset", "Sunset", Color(0xFFEA580C), Color(0xFFFB923C), Color(0xFFEA580C), Color(0xFFC2410C)),
        AppTheme("amber", "Amber", Color(0xFFB45309), Color(0xFFFBBF24), Color(0xFFB45309), Color(0xFF92400E)),
        AppTheme("teal", "Teal", Color(0xFF0D9488), Color(0xFF2DD4BF), Color(0xFF0D9488), Color(0xFF0F766E)),
    )

    val default = Emerald

    /** The theme with this id; an unknown or missing one (a newer app's, say) is the default. */
    fun byId(id: String?): AppTheme = all.firstOrNull { it.id == id } ?: default
}

/** Light, dark, or whichever the system is in. */
enum class AppearanceMode(val id: String, val label: String) {
    System("system", "System"),
    Light("light", "Light"),
    Dark("dark", "Dark");

    companion object {
        fun byId(id: String?) = entries.firstOrNull { it.id == id } ?: System
    }
}

/** WCAG contrast ratio between two colors (1 to 21). */
fun contrast(a: Color, b: Color): Float {
    val la = a.luminance() + 0.05f
    val lb = b.luminance() + 0.05f
    return if (la > lb) la / lb else lb / la
}

/** [color] moved toward [toward] in small steps until [against] reads on it at [ratio] (or [toward] is reached). */
private fun until(color: Color, toward: Color, against: Color, ratio: Float = 4.5f): Color {
    var t = 0f
    var c = color
    while (contrast(c, against) < ratio && t < 1f) {
        t += 0.05f
        c = lerp(color, toward, t)
    }
    return c
}

/** Text on [background]: white when it reads at 4.5:1, else a dark shade of the background's own hue. */
private fun onColor(background: Color): Color {
    if (contrast(Color.White, background) >= 4.5f) return Color.White
    val dark = lerp(background, Color.Black, 0.82f)
    return if (contrast(dark, background) >= 4.5f) dark else Color.Black
}

// Neutral grays (zinc): the same for every theme, so only the accent carries color.
private val LightNeutral = lightColorScheme(
    background = Color(0xFFF9F9FA),
    onBackground = Color(0xFF18181B),
    surface = Color(0xFFF9F9FA),
    onSurface = Color(0xFF18181B),
    surfaceVariant = Color(0xFFE4E4E7),
    onSurfaceVariant = Color(0xFF52525B),
    outline = Color(0xFF71717A),
    outlineVariant = Color(0xFFD4D4D8),
    inverseSurface = Color(0xFF27272A),
    inverseOnSurface = Color(0xFFF4F4F5),
    surfaceDim = Color(0xFFDADADD),
    surfaceBright = Color(0xFFF9F9FA),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF4F4F5),
    surfaceContainer = Color(0xFFEFEFF1),
    surfaceContainerHigh = Color(0xFFE9E9EC),
    surfaceContainerHighest = Color(0xFFE4E4E7),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
    tertiary = Color(0xFF3E6374),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFC1E8FB),
    onTertiaryContainer = Color(0xFF001F29),
)

private val DarkNeutral = darkColorScheme(
    background = Color(0xFF111113),
    onBackground = Color(0xFFE4E4E7),
    surface = Color(0xFF111113),
    onSurface = Color(0xFFE4E4E7),
    surfaceVariant = Color(0xFF3F3F46),
    onSurfaceVariant = Color(0xFFC4C4CC),
    outline = Color(0xFF8A8A93),
    outlineVariant = Color(0xFF3F3F46),
    inverseSurface = Color(0xFFE4E4E7),
    inverseOnSurface = Color(0xFF27272A),
    surfaceDim = Color(0xFF111113),
    surfaceBright = Color(0xFF37373C),
    surfaceContainerLowest = Color(0xFF0B0B0D),
    surfaceContainerLow = Color(0xFF18181B),
    surfaceContainer = Color(0xFF1C1C1F),
    surfaceContainerHigh = Color(0xFF26262A),
    surfaceContainerHighest = Color(0xFF313136),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
    tertiary = Color(0xFFA5CCDF),
    onTertiary = Color(0xFF073544),
    tertiaryContainer = Color(0xFF254B5B),
    onTertiaryContainer = Color(0xFFC1E8FB),
)

/**
 * The Material scheme for [theme]: neutral surfaces, the accent as primary (in light mode darkened just enough for
 * white text on it), containers tinted from it, and secondary roles mostly gray with a hint of it.
 */
fun colorSchemeFor(theme: AppTheme, dark: Boolean): ColorScheme {
    val accent = theme.accent(dark)
    return if (dark) {
        val base = DarkNeutral
        val container = lerp(accent, base.surface, 0.7f)
        val secondaryContainer = lerp(base.surfaceVariant, accent, 0.18f)
        base.copy(
            primary = accent,
            onPrimary = onColor(accent),
            primaryContainer = container,
            onPrimaryContainer = until(lerp(accent, Color.White, 0.55f), Color.White, container),
            inversePrimary = until(accent, Color.Black, Color.White),
            secondary = lerp(Color(0xFFA1A1AA), accent, 0.25f),
            onSecondary = Color(0xFF18181B),
            secondaryContainer = secondaryContainer,
            onSecondaryContainer = until(base.onSurface, Color.White, secondaryContainer),
            surfaceTint = accent,
        )
    } else {
        val base = LightNeutral
        val primary = until(accent, Color.Black, Color.White)
        val container = lerp(accent, Color.White, 0.85f)
        val secondaryContainer = lerp(base.surfaceVariant, accent, 0.12f)
        base.copy(
            primary = primary,
            onPrimary = onColor(primary),
            primaryContainer = container,
            onPrimaryContainer = until(lerp(accent, Color.Black, 0.55f), Color.Black, container),
            inversePrimary = lerp(accent, Color.White, 0.4f),
            secondary = lerp(Color(0xFF52525B), accent, 0.2f),
            onSecondary = Color.White,
            secondaryContainer = secondaryContainer,
            onSecondaryContainer = until(base.onSurface, Color.Black, secondaryContainer),
            surfaceTint = primary,
        )
    }
}
