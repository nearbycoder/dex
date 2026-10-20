package dev.trydex.android.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.nav.SkillList
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.DirectorySkill
import dev.trydex.core.model.Format
import dev.trydex.core.model.SkillInfo
import dev.trydex.core.model.Skills
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Text to put in the composer, replacing what's there, whenever [key] changes (an agent's or project's starter). */
@Immutable
data class Draft(val text: String, val key: Long)

/**
 * The message box: grows to a few lines, sends with the button (or Enter on a hardware keyboard), stops a run, and
 * offers skills when the text is `/` and a name.
 */
@Composable
fun Composer(
    onSend: (String) -> Unit,
    modifier: Modifier = Modifier,
    onStop: (() -> Unit)? = null,
    running: Boolean = false,
    enabled: Boolean = true,
    placeholder: String = "Ask Dex to do anything…",
    draft: Draft? = null,
    autoFocus: Boolean = false,
    state: TextFieldState = rememberTextFieldState(),
    header: (@Composable () -> Unit)? = null,
    toolbar: @Composable RowScope.() -> Unit = {},
) {
    val focus = remember { FocusRequester() }
    val haptics = haptics()
    var menuClosed by rememberSaveable { mutableStateOf(false) }
    val slash by remember { derivedStateOf { Skills.slashQuery(state.text.toString()) } }
    LaunchedEffect(slash == null) { if (slash == null) menuClosed = false }
    val menuOpen = slash != null && !menuClosed && enabled
    val menu = remember { SkillMenuState() }
    LaunchedEffect(draft?.key) {
        if (draft != null) {
            state.setTextAndPlaceCursorAtEnd(draft.text)
            focus.requestFocus()
        }
    }
    LaunchedEffect(Unit) { if (autoFocus) runCatching { focus.requestFocus() } }
    val canSend by remember(enabled) { derivedStateOf { enabled && state.text.isNotBlank() } }

    fun submit() {
        val value = state.text.toString().trim()
        if (value.isEmpty() || !enabled) return
        haptics.confirm()
        state.setTextAndPlaceCursorAtEnd("")
        onSend(value)
    }

    fun pick(name: String) {
        state.setTextAndPlaceCursorAtEnd("/$name ")
        runCatching { focus.requestFocus() }
    }

    Column(modifier.fillMaxWidth()) {
        AnimatedVisibility(menuOpen, enter = fadeIn() + expandVertically(expandFrom = Alignment.Bottom), exit = fadeOut() + shrinkVertically(shrinkTowards = Alignment.Bottom)) {
            SkillMenu(slash ?: "", menu, onPick = ::pick, onClose = { menuClosed = true }, modifier = Modifier.padding(bottom = 8.dp))
        }
        Surface(
            shape = RoundedCornerShape(28.dp),
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            modifier = Modifier.fillMaxWidth().testTag("composer"),
        ) {
            Column(Modifier.padding(top = 4.dp, bottom = 8.dp)) {
                if (header != null) Box(Modifier.padding(start = 12.dp, end = 12.dp, top = 8.dp)) { header() }
                BasicTextField(
                    state = state,
                    enabled = enabled,
                    lineLimits = TextFieldLineLimits.MultiLine(minHeightInLines = 1, maxHeightInLines = 8),
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 240.dp)
                        .focusRequester(focus)
                        .onPreviewKeyEvent { event ->
                            if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                            if (menuOpen && menu.handleKey(event.key, event.isShiftPressed, ::pick) { menuClosed = true }) return@onPreviewKeyEvent true
                            // A hardware keyboard's Enter sends; Shift+Enter is a new line. Soft keyboards keep Enter as a new line.
                            if ((event.key == Key.Enter || event.key == Key.NumPadEnter) && !event.isShiftPressed && event.nativeKeyEvent.deviceId > 0 && !event.nativeKeyEvent.isFromSoftKeyboard()) {
                                submit()
                                true
                            } else false
                        }
                        .padding(horizontal = 20.dp, vertical = 12.dp)
                        .testTag("composer-input")
                        .semantics { contentDescription = placeholder },
                    decorator = { field ->
                        Box {
                            if (state.text.isEmpty()) Text(placeholder, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            field()
                        }
                    },
                )
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    val chips = rememberScrollState()
                    Row(
                        Modifier.weight(1f).fadeEdges(chips).horizontalScroll(chips),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        content = toolbar,
                    )
                    if (running && onStop != null) {
                        FilledTonalIconButton(onClick = { haptics.tap(); onStop() }, modifier = Modifier.padding(start = 6.dp).testTag("stop")) {
                            Icon(Icons.Rounded.Stop, contentDescription = "Stop")
                        }
                    }
                    FilledIconButton(
                        onClick = ::submit,
                        enabled = canSend,
                        shape = CircleShape,
                        colors = IconButtonDefaults.filledIconButtonColors(),
                        modifier = Modifier.padding(start = 6.dp).testTag("send"),
                    ) {
                        Icon(Icons.Rounded.ArrowUpward, contentDescription = if (running) "Queue follow-up" else "Send")
                    }
                }
            }
        }
    }
}

private fun android.view.KeyEvent.isFromSoftKeyboard(): Boolean = (flags and android.view.KeyEvent.FLAG_SOFT_KEYBOARD) != 0

/** The skill menu's highlighted row, and the keys it takes before the text field does. */
class SkillMenuState {
    var active by mutableIntStateOf(0)
    var items: List<Any> = emptyList()
    var onDirectoryPick: (DirectorySkill) -> Unit = {}

    fun handleKey(key: Key, shift: Boolean, pick: (String) -> Unit, close: () -> Unit): Boolean {
        if (key == Key.Escape) {
            close()
            return true
        }
        if (items.isEmpty()) return false
        when {
            key == Key.DirectionDown -> active = (active + 1) % items.size
            key == Key.DirectionUp -> active = (active - 1 + items.size) % items.size
            (key == Key.Enter && !shift) || key == Key.Tab -> when (val item = items[minOf(active, items.lastIndex)]) {
                is SkillInfo -> pick(item.id)
                is DirectorySkill -> onDirectoryPick(item)
            }
            else -> return false
        }
        return true
    }
}

/** Skills for `/<query>`: yours first, then skills.sh's (installed on pick). */
@Composable
fun SkillMenu(query: String, menu: SkillMenuState, onPick: (String) -> Unit, onClose: () -> Unit, modifier: Modifier = Modifier) {
    val app = LocalApp.current
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val q = query.lowercase()
    val installed = Skills.matching(state?.skills.orEmpty(), q)
    val have = state?.skills.orEmpty().map { it.directoryId }.toSet()
    var results by remember { mutableStateOf<List<DirectorySkill>>(emptyList()) }
    var searchedFor by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var installing by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(q) {
        menu.active = 0
        error = null
        val term = q.trim()
        if (term.length < 2) {
            results = emptyList()
            loading = false
            return@LaunchedEffect
        }
        loading = true
        delay(250)
        runCatching { app.graph.repository.api.searchSkills(term) }
            .onSuccess { results = it; error = null }
            .onFailure { results = emptyList(); error = it.message }
        searchedFor = q
        loading = false
    }
    val directory = if (q.length >= 2) results.filter { it.id !in have }.take(5) else emptyList()
    val items: List<Any> = installed + directory
    menu.items = items
    fun install(skill: DirectorySkill) {
        if (installing != null) return
        installing = skill.id
        scope.launch {
            runCatching { app.graph.repository.api.installSkill(skill.source, skill.skillId) }
                .onSuccess { onPick(it.id) }
                .onFailure { error = it.message }
            installing = null
        }
    }
    menu.onDirectoryPick = ::install

    Surface(
        shape = RoundedCornerShape(24.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        shadowElevation = 3.dp,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = modifier.fillMaxWidth().testTag("skill-menu"),
    ) {
        LazyColumn(Modifier.heightIn(max = 320.dp).padding(vertical = 8.dp)) {
            if (installed.isNotEmpty()) item { Heading("Your skills") }
            itemsIndexed(installed, key = { _, s -> "mine-${s.id}" }) { index, skill ->
                SkillRow(
                    active = menu.active == index,
                    icon = { Icon(Icons.Outlined.AutoAwesome, contentDescription = null, tint = DexTheme.colors.success, modifier = Modifier.size(20.dp)) },
                    title = { Text("/${skill.id}", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyMedium) },
                    subtitle = skill.description.takeIf { it.isNotEmpty() },
                    onClick = { onPick(skill.id) },
                )
            }
            if (q.length >= 2) item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Heading("skills.sh")
                    if (loading) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                }
            }
            itemsIndexed(directory, key = { _, s -> "dir-${s.id}" }) { index, skill ->
                SkillRow(
                    active = menu.active == installed.size + index,
                    icon = { Icon(Icons.Outlined.Download, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp)) },
                    title = { Text(skill.name, style = MaterialTheme.typography.bodyMedium) },
                    subtitle = "${skill.source} · ${Format.installs(skill.installs)}",
                    trailing = {
                        Row(
                            Modifier.background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            if (installing == skill.id) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                            else Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                            Text("Install", style = MaterialTheme.typography.labelMedium)
                        }
                    },
                    onClick = { install(skill) },
                )
            }
            val message = when {
                q.length >= 2 && !loading && searchedFor == q && directory.isEmpty() && installed.isEmpty() && error == null -> "No skills match “$q”."
                q.length < 2 && installed.isEmpty() -> "Type to search skills.sh."
                else -> null
            }
            message?.let { item { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) } }
            error?.let { item { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) } }
            item {
                HorizontalDivider(Modifier.padding(vertical = 4.dp), color = MaterialTheme.colorScheme.outlineVariant)
                Row {
                    TextButton(onClick = { onClose(); app.navigator.open(SkillList) }, modifier = Modifier.padding(horizontal = 8.dp)) {
                        Icon(Icons.Rounded.Settings, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Manage skills", modifier = Modifier.padding(start = 8.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun Heading(text: String) {
    Text(text.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
}

@Composable
private fun SkillRow(
    active: Boolean,
    icon: @Composable () -> Unit,
    title: @Composable () -> Unit,
    subtitle: String?,
    onClick: () -> Unit,
    trailing: (@Composable () -> Unit)? = null,
) {
    Surface(
        onClick = onClick,
        color = if (active) MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.6f) else androidx.compose.ui.graphics.Color.Transparent,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp).testTag("skill-row"),
    ) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            icon()
            Column(Modifier.weight(1f)) {
                title()
                subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            trailing?.invoke()
        }
    }
}

/** Fades a horizontally scrolling row out at whichever end has more to scroll to, so a cut-off chip reads as more. */
private fun Modifier.fadeEdges(state: ScrollState, width: Dp = 24.dp) = graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
    .drawWithContent {
        drawContent()
        val fade = width.toPx()
        if (state.canScrollBackward) drawRect(Brush.horizontalGradient(listOf(Color.Transparent, Color.Black), endX = fade), blendMode = BlendMode.DstIn)
        if (state.canScrollForward) drawRect(Brush.horizontalGradient(listOf(Color.Black, Color.Transparent), startX = size.width - fade), blendMode = BlendMode.DstIn)
    }
