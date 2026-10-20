package dev.trydex.android.ui.library

import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.trydex.android.ui.components.InfoTip
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

// Pieces the Skills and MCP pages share.

/** A debounced search: results belong to [query]; a newer query cancels an older one, so stale answers never land. */
@Stable
internal class DebouncedSearch<T> {
    var query by mutableStateOf("")
        internal set
    var results by mutableStateOf<List<T>>(emptyList())
        internal set
    var error by mutableStateOf<String?>(null)
        internal set
    var loading by mutableStateOf(false)
        internal set
}

/** Searches once [text] has two characters or more, [delayMs] after the last change of it (or of [source]). */
@Composable
internal fun <T> rememberDebouncedSearch(text: String, delayMs: Long, source: Any? = null, fetch: suspend (String) -> List<T>): DebouncedSearch<T> {
    val search = remember { DebouncedSearch<T>() }
    val latest by rememberUpdatedState(fetch)
    val q = text.trim()
    LaunchedEffect(q, source) {
        if (q.length < 2) {
            search.query = q
            search.results = emptyList()
            search.error = null
            search.loading = false
            return@LaunchedEffect
        }
        search.loading = true
        search.error = null
        delay(delayMs)
        try {
            search.results = latest(q)
            search.error = null
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            search.results = emptyList()
            search.error = error.message ?: "The search failed."
        }
        search.query = q
        search.loading = false
    }
    return search
}

/** A rounded search field with a spinner while loading, or a clear button once there's a query. */
@Composable
internal fun LibrarySearchField(value: String, onChange: (String) -> Unit, placeholder: String, loading: Boolean, tag: String) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        placeholder = { Text(placeholder) },
        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
        trailingIcon = {
            when {
                loading -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                value.isNotEmpty() -> IconButton(onClick = { onChange("") }) { Icon(Icons.Rounded.Close, contentDescription = "Clear search") }
            }
        },
        shape = RoundedCornerShape(28.dp),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, autoCorrectEnabled = false),
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = placeholder }.testTag(tag),
    )
}

/** A form field's label with its ⓘ, and an optional always-visible hint under it. */
@Composable
internal fun FieldHeading(label: String, info: String? = null, hint: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.titleSmall)
            if (info != null) InfoTip(info, label = "About ${label.lowercase()}")
        }
        if (hint != null) Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** A small label: a source, an auth kind, "Runs on VM". */
@Composable
internal fun TagLabel(text: String, icon: ImageVector? = null, tint: Color? = null) {
    val color = tint ?: MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        Modifier.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest).padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) Icon(icon, contentDescription = null, modifier = Modifier.size(12.dp), tint = color)
        Text(text, style = MaterialTheme.typography.labelSmall, color = color, maxLines = 1)
    }
}

/** An empty list's note, in an outlined box (the web's dashed one). */
@Composable
internal fun EmptyNote(text: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        color = Color.Transparent,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 28.dp),
        )
    }
}

/** A list's heading, above its cards. */
@Composable
internal fun ListHeading(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = modifier.padding(start = 4.dp, top = 8.dp))
}

/** An icon that spins while [spinning] (refresh buttons). */
@Composable
internal fun SpinningIcon(icon: ImageVector, spinning: Boolean, contentDescription: String?, modifier: Modifier = Modifier) {
    if (spinning) {
        val angle by rememberInfiniteTransition(label = "spin").animateFloat(0f, 360f, infiniteRepeatable(tween(900)), label = "spin")
        Icon(icon, contentDescription, modifier = modifier.rotate(angle))
    } else {
        Icon(icon, contentDescription, modifier = modifier)
    }
}

/** An editor's save bar, stuck to the bottom (FormBar on the web). */
@Composable
internal fun EditorSaveBar(content: @Composable RowScope.() -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
        Column {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Row(
                Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                content = content,
            )
        }
    }
}

/** `max(1, round(size / 1024)) KB`, as skills show their size. */
internal fun kilobytes(size: Long): String = "${maxOf(1L, dev.trydex.core.model.Format.jsRound(size / 1024.0))} KB"
