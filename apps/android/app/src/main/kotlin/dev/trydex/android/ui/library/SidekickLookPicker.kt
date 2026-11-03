package dev.trydex.android.ui.library

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
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.trydex.android.ui.components.Hint
import dev.trydex.android.ui.components.SidekickFace
import dev.trydex.core.model.Catalogs
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.Characters
import dev.trydex.core.model.SidekickLook
import dev.trydex.core.model.SidekickLooks
import kotlin.random.Random

/**
 * Picks a sidekick's look (the web's SidekickLookPicker): a ready-made one, Shuffle, a photo instead, or their own mix
 * of body, eyes, mouth, extra, and colors, each option drawn on the current look so you see what you'd get.
 */
@Composable
fun SidekickLookPicker(draft: CharacterProfile, onChange: ((CharacterProfile) -> CharacterProfile) -> Unit) {
    val look = draft.look?.let(SidekickLooks::clean)
    // Customizing a photo or an emoji starts from the first ready-made look.
    val current = look ?: Characters.PRESETS.first().look
    // A part changed: their picture is drawn again from the look when they're saved.
    fun set(change: (SidekickLook) -> SidekickLook) = onChange { it.copy(look = change(current), image = null, avatar = "") }

    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Characters.PRESETS.forEach { preset ->
                val on = look == preset.look && draft.color == preset.color
                LookTile(preset.look, preset.color, 52.dp, on, "Look: ${preset.name}", Modifier.testTag("character-look-${preset.key}")) {
                    onChange { preset.applyTo(it) }
                }
            }
        }

        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(
                onClick = {
                    val color = Catalogs.AGENT_COLORS.keys.toList()[Random.nextInt(Catalogs.AGENT_COLORS.size)]
                    onChange { it.copy(look = SidekickLooks.random(), color = color, image = null, avatar = "") }
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
                val option = @Composable { part: String, value: String, preview: SidekickLook ->
                    LookTile(
                        preview, draft.color, 44.dp, look != null && preview == current, "$part: ${SidekickLooks.label(value)}",
                        Modifier.testTag("look-${part.lowercase()}-$value"),
                    ) { set { preview } }
                }
                PartRow("Body") { SidekickLooks.BODIES.forEach { option("Body", it, current.copy(body = it)) } }
                PartRow("Eyes") { SidekickLooks.EYES.forEach { option("Eyes", it, current.copy(eyes = it)) } }
                PartRow("Mouth") { SidekickLooks.MOUTHS.forEach { option("Mouth", it, current.copy(mouth = it)) } }
                PartRow("Extra") { SidekickLooks.EXTRAS.forEach { option("Extra", it, current.copy(extra = it)) } }
                PartRow("Body color") {
                    SidekickLooks.SKINS.forEach { (skin, hex) ->
                        Swatch(Color(android.graphics.Color.parseColor(hex)), null, look != null && current.skin == skin, "Body color $skin") { set { it.copy(skin = skin) } }
                    }
                }
                PartRow("Background") {
                    Catalogs.AGENT_COLORS.forEach { (key, pair) ->
                        Swatch(Color(pair.first), Color(pair.second), key == draft.color, "Background $key") { onChange { it.copy(color = key) } }
                    }
                }
                PartRow("Cheeks") {
                    listOf(true, false).forEach { blush ->
                        FilterChip(
                            selected = look != null && current.blush == blush,
                            onClick = { set { it.copy(blush = blush) } },
                            label = { Text(if (blush) "Rosy" else "Plain") },
                            modifier = Modifier.testTag("look-cheeks-${if (blush) "rosy" else "plain"}"),
                        )
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

/** A look to pick, drawn; the picked one has a ring. */
@Composable
private fun LookTile(look: SidekickLook, color: String, size: Dp, on: Boolean, label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Hint(label.substringAfter(": ")) {
        Box(
            Modifier.size(size + 8.dp).then(if (on) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, CircleShape) else Modifier).padding(4.dp),
            contentAlignment = Alignment.Center,
        ) {
            Surface(
                onClick = onClick,
                shape = CircleShape,
                color = Color.Transparent,
                modifier = modifier.size(size).semantics {
                    contentDescription = label
                    selected = on
                },
            ) { SidekickFace(look, color, size) }
        }
    }
}

/** A color to pick: a disc, with the dot of its foreground for backgrounds. */
@Composable
private fun Swatch(fill: Color, dot: Color?, on: Boolean, label: String, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).then(if (on) Modifier.border(2.dp, MaterialTheme.colorScheme.onSurface, CircleShape) else Modifier).padding(5.dp),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            onClick = onClick,
            shape = CircleShape,
            color = fill,
            modifier = Modifier.size(34.dp).semantics {
                contentDescription = label
                selected = on
                role = Role.RadioButton
            },
        ) {
            if (dot != null) Box(contentAlignment = Alignment.Center) { Box(Modifier.size(12.dp).background(dot, CircleShape)) }
        }
    }
}
