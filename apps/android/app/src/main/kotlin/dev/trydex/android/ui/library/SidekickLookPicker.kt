package dev.trydex.android.ui.library

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Casino
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.trydex.android.ui.components.Hint
import dev.trydex.android.ui.components.SidekickArt
import dev.trydex.core.model.Catalogs
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.Characters
import dev.trydex.core.model.SidekickLooks
import dev.trydex.core.model.SidekickPreset
import kotlin.random.Random

/**
 * Picks a sidekick's look (the web's SidekickLookPicker): a ready-made BoopFace, a plain color, Shuffle, or a photo
 * instead, and their accent. Finishes beyond the ready-made ones are picked on the web, which can draw them.
 */
@Composable
fun SidekickLookPicker(draft: CharacterProfile, onChange: ((CharacterProfile) -> CharacterProfile) -> Unit) {
    val look = draft.look?.let(SidekickLooks::clean)
    // A color on a photo or an emoji starts from the first ready-made look.
    val current = look ?: Characters.PRESETS.first().look
    // A plain color: the finish goes (explicitly, so the agent drops it too), and the picture is drawn here on saving.
    fun color(skin: String) = { it: CharacterProfile -> it.copy(look = current.copy(skin = skin, finish = null), image = null, avatar = "") }

    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Characters.PRESETS.forEach { preset ->
                PresetTile(preset, on = look == preset.look, Modifier.testTag("character-look-${preset.key}")) { onChange { preset.applyTo(it) } }
            }
        }

        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(
                onClick = {
                    // A ready-made face or a plain color, as often as each.
                    if (Random.nextBoolean()) onChange { Characters.PRESETS.random().applyTo(it) }
                    else {
                        val accent = Catalogs.AGENT_COLORS.keys.random()
                        onChange { color(SidekickLooks.SKINS.keys.random())(it).copy(color = accent) }
                    }
                },
                modifier = Modifier.testTag("character-look-shuffle"),
            ) {
                Icon(Icons.Rounded.Casino, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("Shuffle", modifier = Modifier.padding(start = 8.dp))
            }
            // A photo replaces the look; removing it goes back to a look.
            CharacterPicture(draft.image?.takeIf { look == null }) { image ->
                onChange { if (image != null) it.copy(image = image, look = null) else it.copy(image = null, look = current) }
            }
        }

        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surfaceContainerLow,
            modifier = Modifier.border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(16.dp)).testTag("character-look-parts"),
        ) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                PartRow("Color") {
                    SidekickLooks.SKINS.forEach { (skin, hex) ->
                        Swatch(
                            Color(android.graphics.Color.parseColor(hex)), null, look != null && look.finish == null && look.skin == skin, "Color $skin",
                            Modifier.testTag("look-color-$skin"),
                        ) { onChange(color(skin)) }
                    }
                }
                PartRow("Accent") {
                    Catalogs.AGENT_COLORS.forEach { (key, pair) ->
                        Swatch(Color(pair.first), Color(pair.second), key == draft.color, "Accent $key", Modifier.testTag("look-accent-$key")) { onChange { it.copy(color = key) } }
                    }
                }
            }
        }
    }
}

@Composable
private fun PartRow(label: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            content()
        }
    }
}

/** A ready-made look to pick, its BoopFace whole; the picked one has a ring. */
@Composable
private fun PresetTile(preset: SidekickPreset, on: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    val picture = remember(preset.key) { SidekickArt.picture(preset.dataUrl)?.asImageBitmap() }
    Hint(preset.name) {
        Box(
            Modifier.size(60.dp).then(if (on) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, shape) else Modifier).padding(4.dp),
            contentAlignment = Alignment.Center,
        ) {
            Surface(
                onClick = onClick,
                shape = shape,
                color = Color.Transparent,
                modifier = modifier.size(52.dp).semantics {
                    contentDescription = "Look: ${preset.name}"
                    selected = on
                },
            ) {
                if (picture != null) Image(picture, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.padding(2.dp))
            }
        }
    }
}

/** A color to pick: a disc, with the dot of its foreground for accents. */
@Composable
private fun Swatch(fill: Color, dot: Color?, on: Boolean, label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).then(if (on) Modifier.border(2.dp, MaterialTheme.colorScheme.onSurface, CircleShape) else Modifier).padding(5.dp),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            onClick = onClick,
            shape = CircleShape,
            color = fill,
            modifier = modifier.size(34.dp).semantics {
                contentDescription = label
                selected = on
                role = Role.RadioButton
            },
        ) {
            if (dot != null) Box(contentAlignment = Alignment.Center) { Box(Modifier.size(12.dp).background(dot, CircleShape)) }
        }
    }
}
