package dev.trydex.android.ui.library

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.rounded.AddComment
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.saveable.Saver
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.trydex.android.ui.components.Hint
import dev.trydex.android.ui.components.agentIcon
import dev.trydex.core.model.Catalogs
import dev.trydex.core.model.DexJson
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.KSerializer

/** Keeps an unsaved draft across rotation and process death, as JSON. */
fun <T> draftSaver(serializer: KSerializer<T>): Saver<T?, String> = Saver(
    save = { value -> value?.let { DexJson.encodeToString(serializer, it) } },
    restore = { saved -> runCatching { DexJson.decodeFromString(serializer, saved) }.getOrNull() },
)

/** runCatching that lets cancellation through (a newer search replacing an older one). */
suspend fun <T> attempt(block: suspend () -> T): Result<T> = try {
    Result.success(block())
} catch (cancelled: CancellationException) {
    throw cancelled
} catch (error: Throwable) {
    Result.failure(error)
}

/** The monospace style the editors use for scripts, branches, and paths. */
val MonoStyle @Composable get() = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace, fontSize = 13.sp)

/** A labelled control with an always-visible hint (Field on the web). */
@Composable
fun ProfileField(label: String, hint: String? = null, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
        if (hint != null) Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box(Modifier.padding(top = 2.dp)) { content() }
    }
}

/** Every agent icon as a tile; the picked one is highlighted. */
@Composable
fun ProfileIconGrid(selected: String, onPick: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Catalogs.AGENT_ICONS.forEach { key ->
            val on = key == selected
            Hint(key) {
                Surface(
                    onClick = { onPick(key) },
                    shape = RoundedCornerShape(14.dp),
                    color = if (on) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
                    border = BorderStroke(if (on) 2.dp else 1.dp, if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier.size(44.dp).semantics {
                        contentDescription = key
                        this.selected = on
                    },
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            agentIcon(key), contentDescription = null, modifier = Modifier.size(22.dp),
                            tint = if (on) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

/** Every avatar colour as a circle, its foreground as the dot inside; the picked one has a ring. */
@Composable
fun ProfileColorPicker(selected: String, onPick: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Catalogs.AGENT_COLORS.forEach { (key, pair) ->
            val on = key == selected
            Hint(key) {
                Box(
                    Modifier
                        .size(48.dp)
                        .then(if (on) Modifier.border(2.dp, MaterialTheme.colorScheme.onSurface, CircleShape) else Modifier)
                        .padding(4.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Surface(
                        onClick = { onPick(key) },
                        shape = CircleShape,
                        color = Color(pair.first),
                        modifier = Modifier.size(40.dp).semantics {
                            contentDescription = key
                            this.selected = on
                            role = Role.RadioButton
                        },
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Box(Modifier.size(14.dp).background(Color(pair.second), CircleShape))
                        }
                    }
                }
            }
        }
    }
}

/** A two-column grid of cards on wide panes, one column on phones. */
@Composable
fun <T> ProfileGrid(items: List<T>, modifier: Modifier = Modifier, card: @Composable (T) -> Unit) {
    BoxWithConstraints(modifier) {
        val columns = if (maxWidth >= 560.dp) 2 else 1
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items.chunked(columns).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    row.forEach { item -> Box(Modifier.weight(1f)) { card(item) } }
                    repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** What a save button says: a spinner while saving, a check once saved. */
@Composable
fun SaveButtonContent(label: String, saving: Boolean, saved: Boolean) {
    when {
        saving -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
        saved -> Icon(Icons.Rounded.Check, contentDescription = null, modifier = Modifier.size(18.dp))
    }
    Text(label, modifier = Modifier.padding(start = if (saving || saved) 8.dp else 0.dp))
}

/** An editor's save bar, stuck to the bottom: save, start a chat, and delete. */
@Composable
fun ProfileSaveBar(
    label: String,
    enabled: Boolean,
    saving: Boolean,
    saved: Boolean,
    saveTag: String,
    onSave: () -> Unit,
    onStartChat: (() -> Unit)?,
    onDelete: (() -> Unit)?,
) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(onClick = onSave, enabled = enabled, modifier = Modifier.widthIn(min = 112.dp).testTag(saveTag)) {
                    SaveButtonContent(label, saving, saved)
                }
                if (onStartChat != null) {
                    OutlinedButton(onClick = onStartChat) {
                        Icon(Icons.Rounded.AddComment, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Start chat", modifier = Modifier.padding(start = 8.dp))
                    }
                }
                Spacer(Modifier.weight(1f))
                if (onDelete != null) {
                    Hint("Delete") {
                        IconButton(
                            onClick = onDelete,
                            colors = IconButtonDefaults.iconButtonColors(contentColor = MaterialTheme.colorScheme.error),
                            modifier = Modifier.testTag("$saveTag-delete"),
                        ) { Icon(Icons.Outlined.DeleteOutline, contentDescription = "Delete") }
                    }
                }
            }
        }
    }
}

/** An editor whose item was deleted (here or elsewhere). */
@Composable
fun ProfileMissing(text: String, back: String, onBack: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = onBack) { Text(back) }
    }
}

/** A small dim line of text, used in cards' meta rows. */
@Composable
fun MetaText(text: String, modifier: Modifier = Modifier, mono: Boolean = false, strong: Boolean = false) {
    Text(
        text,
        style = if (mono) MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace) else MaterialTheme.typography.bodySmall,
        fontWeight = if (strong) FontWeight.Medium else null,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
        modifier = modifier,
    )
}
