package dev.trydex.android.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Wallpaper
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.PageColumn
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.SectionCard
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.theme.AppTheme
import dev.trydex.android.ui.theme.AppThemes
import dev.trydex.android.ui.theme.AppearanceMode
import dev.trydex.android.ui.theme.DexTheme

/**
 * How Dex looks on this device: light, dark, or the system's mode, and one of ten color themes (the iOS app has the
 * same ones). On Android 12+, the wallpaper's Material You colors are a further choice. Changes apply at once.
 */
@Composable
fun AppearanceSettingsScreen() {
    val app = LocalApp.current
    val prefs by app.graph.preferences.prefs.collectAsStateWithLifecycle()
    val haptics = haptics()
    PaneScaffold(title = "Appearance", modifier = Modifier.testTag("settings-appearance")) { padding ->
        PageColumn(padding) {
            SectionCard(title = "Mode") {
                val current = AppearanceMode.byId(prefs.appearance)
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    AppearanceMode.entries.forEachIndexed { index, mode ->
                        SegmentedButton(
                            selected = mode == current,
                            onClick = { haptics.tap(); app.graph.preferences.setAppearance(mode.id) },
                            shape = SegmentedButtonDefaults.itemShape(index, AppearanceMode.entries.size),
                            modifier = Modifier.testTag("appearance-${mode.id}"),
                        ) { Text(mode.label) }
                    }
                }
            }
            SectionCard(title = "Theme", info = "The accent color for buttons, links, and selections. Saved on this device.") {
                val chosen = if (prefs.dynamicColor) null else AppThemes.byId(prefs.theme)
                ThemeGrid(chosen) { theme ->
                    haptics.tap()
                    app.graph.preferences.setTheme(theme.id)
                }
                if (android.os.Build.VERSION.SDK_INT >= 31) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Outlined.Wallpaper, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Column(Modifier.weight(1f)) {
                            Text("Colors from your wallpaper", style = MaterialTheme.typography.bodyLarge)
                            Text("Material You, instead of a theme", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(
                            checked = prefs.dynamicColor,
                            onCheckedChange = { app.graph.preferences.setDynamicColor(it) },
                            modifier = Modifier.testTag("theme-wallpaper").semantics { contentDescription = "Colors from your wallpaper" },
                        )
                    }
                }
            }
        }
    }
}

/** The themes as swatches, as many to a row as fit (two on a narrow phone, five on a tablet). */
@Composable
private fun ThemeGrid(chosen: AppTheme?, onPick: (AppTheme) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val columns = (maxWidth / 112.dp).toInt().coerceIn(2, 5)
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            AppThemes.all.chunked(columns).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { theme -> ThemeSwatch(theme, theme == chosen, Modifier.weight(1f)) { onPick(theme) } }
                    repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** A theme's light and dark accents side by side, its name, and a check when it's the one in use. */
@Composable
private fun ThemeSwatch(theme: AppTheme, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    val dark = DexTheme.colors.dark
    Surface(
        onClick = onClick,
        shape = shape,
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = modifier
            .border(if (selected) 2.dp else 1.dp, if (selected) theme.accent(dark) else MaterialTheme.colorScheme.outlineVariant, shape)
            .testTag("theme-${theme.id}")
            .semantics {
                role = Role.RadioButton
                this.selected = selected
                contentDescription = "${theme.name} theme"
            },
    ) {
        Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.fillMaxWidth().height(40.dp).clip(RoundedCornerShape(10.dp))) {
                Row(Modifier.fillMaxSize()) {
                    Box(Modifier.weight(1f).fillMaxSize().background(theme.accentLight))
                    Box(Modifier.weight(1f).fillMaxSize().background(theme.accentDark))
                }
                if (selected) {
                    Box(
                        Modifier.align(Alignment.Center).size(24.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surface),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Rounded.Check, contentDescription = null, tint = if (dark) theme.accentDark else theme.selectionLight, modifier = Modifier.size(16.dp))
                    }
                }
            }
            Text(
                theme.name,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 2.dp),
            )
        }
    }
}
