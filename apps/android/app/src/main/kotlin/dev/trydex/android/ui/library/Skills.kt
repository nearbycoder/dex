package dev.trydex.android.ui.library

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.LocalOpenInBrowser
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.ConfirmState
import dev.trydex.android.ui.components.EmptyState
import dev.trydex.android.ui.components.ErrorText
import dev.trydex.android.ui.components.Hint
import dev.trydex.android.ui.components.InfoTip
import dev.trydex.android.ui.components.PageColumn
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.SectionCard
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.components.rememberConfirm
import dev.trydex.android.ui.nav.SkillEditor
import dev.trydex.android.ui.nav.SkillList
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.DirectorySkill
import dev.trydex.core.model.Format
import dev.trydex.core.model.SkillDetail
import dev.trydex.core.model.SkillInfo
import dev.trydex.core.model.SkillPreview
import dev.trydex.core.model.Skills
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Locale

/** Installed skills, and skills.sh to find more. */
@Composable
fun SkillListScreen() {
    val app = LocalApp.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val confirm = rememberConfirm()
    var query by rememberSaveable { mutableStateOf("") }
    val search = rememberDebouncedSearch(query, 250) { q -> repository.api.searchSkills(q) }
    val q = query.trim()
    val searching = q.length >= 2
    val installed = remember(state?.skills) { state?.skills.orEmpty().map { it.directoryId }.toSet() }

    PaneScaffold(
        title = "Skills",
        actions = {
            InfoTip(
                "Instructions for particular tasks. Start a message with /name to use one, or let chats pick them up on their own (Auto). Skills come from other people's repos: read one before installing it.",
                "About skills",
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { app.navigator.open(SkillEditor("new")) },
                icon = { Icon(Icons.Rounded.Add, contentDescription = null) },
                text = { Text("New skill") },
                modifier = Modifier.testTag("skill-new"),
            )
        },
        modifier = Modifier.testTag("skills"),
    ) { padding ->
        PageColumn(padding) {
            LibrarySearchField(query, { query = it }, "Search skills.sh", search.loading && searching, "skill-search")
            if (searching) {
                val error = search.error
                when {
                    error != null -> ErrorText(error)
                    search.results.isNotEmpty() -> SectionCard(contentPadding = false, modifier = Modifier.testTag("skill-results")) {
                        Column {
                            search.results.forEachIndexed { index, result ->
                                if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                                key(result.id) { DirectoryRow(result, result.id in installed) }
                            }
                        }
                    }
                    !search.loading && search.query == q -> Text("No skills match “$q”.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp))
                }
            } else {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Skills.SUGGESTIONS.forEach { suggestion ->
                        SuggestionChip(onClick = { query = suggestion }, label = { Text(suggestion) }, shape = RoundedCornerShape(12.dp))
                    }
                }
            }

            ListHeading("Installed")
            val current = state
            when {
                current == null -> BoneRows(2)
                current.skills.isEmpty() -> EmptyNote("No skills yet. Search skills.sh above, or write your own.")
                else -> Column(Modifier.testTag("skill-list"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    current.skills.forEach { skill -> key(skill.id) { SkillCard(skill, confirm) } }
                }
            }
            Spacer(Modifier.height(64.dp))
        }
    }
}

/** A skills.sh result: opens to preview it from GitHub, and installs. */
@Composable
private fun DirectoryRow(result: DirectorySkill, installed: Boolean) {
    val app = LocalApp.current
    val api = app.graph.repository.api
    val openInBrowser = LocalOpenInBrowser.current
    val scope = rememberCoroutineScope()
    val haptics = haptics()
    var open by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf<SkillPreview?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showInstructions by remember { mutableStateOf(false) }
    val chevron by animateFloatAsState(if (open) 90f else 0f, label = "chevron")

    fun toggle() {
        val opening = !open
        open = opening
        if (opening && preview == null && busy != "preview") {
            busy = "preview"
            error = null
            scope.launch {
                runCatching { api.previewSkill(result.source, result.skillId) }
                    .onSuccess { preview = it }
                    .onFailure { error = it.message }
                if (busy == "preview") busy = null
            }
        }
    }

    Column(Modifier.fillMaxWidth().testTag("skill-result-${result.id}")) {
        Row(Modifier.fillMaxWidth().padding(end = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                Modifier.weight(1f).clickable(onClickLabel = if (open) "Hide preview" else "Preview", onClick = ::toggle).padding(start = 12.dp, top = 12.dp, bottom = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(20.dp).rotate(chevron))
                Column(Modifier.weight(1f)) {
                    Text(result.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(result.source, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Hint("${NumberFormat.getIntegerInstance(Locale.US).format(result.installs)} installs") {
                TagLabel(Format.installs(result.installs), Icons.Outlined.Download)
            }
            if (installed) {
                Row(Modifier.width(88.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally)) {
                    Icon(Icons.Rounded.Check, contentDescription = null, tint = DexTheme.colors.success, modifier = Modifier.size(16.dp))
                    Text("Installed", style = MaterialTheme.typography.labelLarge, color = DexTheme.colors.success)
                }
            } else {
                FilledTonalButton(
                    onClick = {
                        busy = "install"
                        error = null
                        scope.launch {
                            runCatching { api.installSkill(result.source, result.skillId) }
                                .onSuccess { haptics.confirm() }
                                .onFailure { error = it.message; haptics.reject() }
                            busy = null
                        }
                    },
                    enabled = busy != "install",
                    contentPadding = ButtonDefaults.SmallContentPadding,
                    modifier = Modifier.width(88.dp).testTag("skill-install-${result.id}"),
                ) {
                    if (busy == "install") CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    else Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                    Text("Install", modifier = Modifier.padding(start = 4.dp))
                }
            }
        }
        error?.let { ErrorText(it, Modifier.padding(start = 40.dp, end = 16.dp, bottom = 12.dp)) }
        AnimatedVisibility(open && error == null) {
            Column(Modifier.fillMaxWidth().padding(start = 40.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val loaded = preview
                if (loaded == null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Text("Reading it from GitHub…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else {
                    Text(loaded.description.ifBlank { "No description." }, style = MaterialTheme.typography.bodyMedium)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        val files = loaded.files.size
                        Text(
                            (if (files > 0) "SKILL.md + $files file${if (files == 1) "" else "s"}" else "SKILL.md") + " · " + kilobytes(loaded.size),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (loaded.url.isNotEmpty()) {
                            TextButton(onClick = { openInBrowser(loaded.url) }, contentPadding = ButtonDefaults.SmallContentPadding) { Text("GitHub ↗") }
                        }
                    }
                    if (loaded.instructions.isNotEmpty()) {
                        val instructionsChevron by animateFloatAsState(if (showInstructions) 90f else 0f, label = "instructions")
                        Row(
                            Modifier.clickable { showInstructions = !showInstructions }.padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Icon(Icons.Rounded.ChevronRight, contentDescription = null, modifier = Modifier.size(18.dp).rotate(instructionsChevron), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Instructions", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        AnimatedVisibility(showInstructions) {
                            Surface(shape = RoundedCornerShape(16.dp), color = DexTheme.colors.codeBackground, contentColor = DexTheme.colors.codeText, modifier = Modifier.fillMaxWidth()) {
                                SelectionContainer {
                                    Text(
                                        loaded.instructions,
                                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 18.sp),
                                        modifier = Modifier.heightIn(max = 288.dp).verticalScroll(rememberScrollState()).padding(12.dp),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** An installed skill: update it from GitHub, remove it, and whether chats load it on their own. */
@Composable
private fun SkillCard(skill: SkillInfo, confirm: ConfirmState) {
    val app = LocalApp.current
    val api = app.graph.repository.api
    val scope = rememberCoroutineScope()
    val haptics = haptics()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // The switch moves at once; the synced state catches up.
    var auto by remember(skill.auto) { mutableStateOf(skill.auto) }

    Card(
        onClick = { app.navigator.open(SkillEditor(skill.id)) },
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        modifier = Modifier.fillMaxWidth().testTag("skill-row-${skill.id}"),
    ) {
        Row(Modifier.padding(start = 20.dp, top = 12.dp, end = 4.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                    Text("/${skill.id}", style = MaterialTheme.typography.titleMedium.copy(fontFamily = FontFamily.Monospace), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    TagLabel(skill.source ?: "Yours")
                }
                if (skill.description.isNotBlank()) {
                    Text(skill.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            if (skill.source != null) {
                Hint("Update from GitHub") {
                    IconButton(
                        onClick = {
                            busy = true
                            error = null
                            scope.launch {
                                runCatching { api.updateSkill(skill.id) }.onFailure { error = it.message }
                                busy = false
                            }
                        },
                        enabled = !busy,
                    ) { SpinningIcon(Icons.Rounded.Refresh, busy, "Update ${skill.id}") }
                }
            }
            Hint("Remove") {
                IconButton(onClick = {
                    confirm.ask("Remove /${skill.id}? Chats stop using it.", confirm = "Remove") {
                        scope.launch { runCatching { api.removeSkill(skill.id) }.onFailure { error = it.message } }
                    }
                }, modifier = Modifier.testTag("skill-remove-${skill.id}")) {
                    Icon(Icons.Outlined.DeleteOutline, contentDescription = "Remove ${skill.id}")
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 16.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                (if (skill.files > 0) "${skill.files + 1} files" else "1 file") + " · " + kilobytes(skill.size),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.weight(1f),
            )
            Text("Auto", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            InfoTip("On: chats load it by themselves when a request matches. Off: only when you start a message with /${skill.id}.", "About auto")
            Switch(
                checked = auto,
                onCheckedChange = { on ->
                    haptics.toggle(on)
                    auto = on
                    scope.launch { runCatching { api.setSkillAuto(skill.id, on) }.onFailure { auto = skill.auto; error = it.message } }
                },
                modifier = Modifier.semantics { contentDescription = "Let chats use ${skill.id} on their own" }.testTag("skill-auto-${skill.id}"),
            )
        }
        error?.let { ErrorText(it, Modifier.padding(start = 20.dp, end = 20.dp, bottom = 16.dp)) }
    }
}

/** Writes a new skill, or reads and edits an installed one (`id` is "new" for a new one). */
@Composable
fun SkillEditorScreen(id: String) {
    val app = LocalApp.current
    val repository = app.graph.repository
    val api = repository.api
    val state by repository.state.collectAsStateWithLifecycle()
    val connected by repository.connected.collectAsStateWithLifecycle()
    val openInBrowser = LocalOpenInBrowser.current
    val scope = rememberCoroutineScope()
    val confirm = rememberConfirm()
    val haptics = haptics()
    val isNew = id == "new"

    var skill by remember(id) { mutableStateOf<SkillDetail?>(null) }
    var loaded by remember(id) { mutableStateOf(isNew) }
    var hasDraft by rememberSaveable(id) { mutableStateOf(isNew) }
    var name by rememberSaveable(id) { mutableStateOf("") }
    var description by rememberSaveable(id) { mutableStateOf("") }
    var instructions by rememberSaveable(id) { mutableStateOf("") }
    var auto by rememberSaveable(id) { mutableStateOf(true) }
    var busy by remember(id) { mutableStateOf<String?>(null) }
    var saved by remember(id) { mutableStateOf(false) }
    var error by remember(id) { mutableStateOf<String?>(null) }

    fun take(detail: SkillDetail, replaceDraft: Boolean) {
        skill = detail
        if (replaceDraft || !hasDraft) {
            name = detail.id
            description = detail.description
            instructions = detail.instructions
            auto = detail.auto
            hasDraft = true
        }
    }

    // Reloads when it changes elsewhere (updated from GitHub, edited by a chat); edits in progress are kept.
    val updatedAt = state?.skills?.firstOrNull { it.id == id }?.updatedAt
    LaunchedEffect(id, connected, updatedAt) {
        if (isNew || !connected) return@LaunchedEffect
        runCatching { api.getSkill(id) }
            .onSuccess { detail ->
                if (detail != null) take(detail, replaceDraft = false) else skill = null
                loaded = true
            }
            .onFailure { error = it.message }
    }

    fun edit(block: () -> Unit) {
        block()
        saved = false
    }

    val slug = Skills.slug(name)
    val source = skill?.source
    val title = "/" + slug.ifEmpty { if (isNew) "new-skill" else id }

    if (!isNew && loaded && skill == null) {
        PaneScaffold(title = "Skills") { padding ->
            PageColumn(padding) {
                EmptyState("This skill no longer exists.", action = {
                    TextButton(onClick = { app.navigator.open(SkillList) }) { Text("Back to skills") }
                })
            }
        }
        return
    }

    PaneScaffold(
        title = title,
        subtitle = source ?: "Start a message with this to use it.",
        actions = {
            if (source != null) {
                val path = skill?.path
                IconButton(onClick = { openInBrowser("https://github.com/$source" + (path?.let { "/tree/HEAD/$it" } ?: "")) }) {
                    Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = "Open $source on GitHub")
                }
            }
        },
        bottomBar = {
            if (hasDraft) EditorSaveBar {
                val canSave = busy == null && slug.isNotEmpty() && description.isNotBlank() && instructions.isNotBlank()
                Button(
                    onClick = {
                        busy = "save"
                        error = null
                        scope.launch {
                            runCatching { api.saveSkill(if (isNew) null else id, name, description, instructions, auto) }
                                .onSuccess { result ->
                                    take(result, replaceDraft = true)
                                    saved = true
                                    haptics.confirm()
                                    if (result.id != id) app.navigator.replace(SkillEditor(result.id))
                                }
                                .onFailure { error = it.message; haptics.reject() }
                            busy = null
                        }
                    },
                    enabled = canSave,
                    modifier = Modifier.testTag("skill-save"),
                ) {
                    when {
                        busy == "save" -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                        saved -> Icon(Icons.Rounded.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                    }
                    if (busy == "save" || saved) Spacer(Modifier.width(8.dp))
                    Text(if (isNew) "Create skill" else if (saved) "Saved" else "Save")
                }
                if (source != null) Hint("Replaces it with the latest from GitHub, edits included") {
                    OutlinedButton(
                        onClick = {
                            busy = "update"
                            error = null
                            scope.launch {
                                runCatching { api.updateSkill(id) }
                                    .onSuccess { take(it, replaceDraft = true) }
                                    .onFailure { error = it.message }
                                busy = null
                            }
                        },
                        enabled = busy == null,
                        modifier = Modifier.testTag("skill-update"),
                    ) {
                        SpinningIcon(Icons.Rounded.Refresh, busy == "update", contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Update", modifier = Modifier.padding(start = 8.dp))
                    }
                }
                Spacer(Modifier.weight(1f))
                if (!isNew) {
                    TextButton(
                        onClick = {
                            confirm.ask("Remove /$id? Chats stop using it.", confirm = "Remove") {
                                busy = "remove"
                                scope.launch {
                                    runCatching { api.removeSkill(id) }
                                        .onSuccess { app.navigator.close(SkillEditor(id)) }
                                        .onFailure { error = it.message }
                                    busy = null
                                }
                            }
                        },
                        enabled = busy == null,
                        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        modifier = Modifier.testTag("skill-remove"),
                    ) {
                        Icon(Icons.Outlined.DeleteOutline, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Remove", modifier = Modifier.padding(start = 6.dp))
                    }
                }
            }
        },
        modifier = Modifier.testTag("skill-editor"),
    ) { padding ->
        PageColumn(padding) {
            if (!hasDraft) {
                error?.let { ErrorText(it) }
                BoneRows(4)
                return@PageColumn
            }
            SectionCard {
                FieldHeading("Name", info = "What you type after / to use it: lowercase letters, digits, and dashes.")
                OutlinedTextField(
                    value = name,
                    onValueChange = { value -> edit { name = value.take(64) } },
                    singleLine = true,
                    placeholder = { Text("release-notes", fontFamily = FontFamily.Monospace) },
                    prefix = { Text("/", fontFamily = FontFamily.Monospace) },
                    textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().testTag("skill-name"),
                )
                FieldHeading("When to use it", info = "Chats decide whether a request needs this skill from this description, so say what it's for and when it applies.")
                OutlinedTextField(
                    value = description,
                    onValueChange = { value -> edit { description = value.take(1000) } },
                    minLines = 3,
                    placeholder = { Text("Writes release notes from merged pull requests. Use when asked for a changelog or release notes.") },
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().testTag("skill-description"),
                )
                FieldHeading("Instructions", info = "Markdown, given to the chat when the skill is used.")
                OutlinedTextField(
                    value = instructions,
                    onValueChange = { value -> edit { instructions = value } },
                    minLines = 12,
                    placeholder = { Text("# Release notes\n\n1. List the PRs merged since the last tag…", fontFamily = FontFamily.Monospace, fontSize = 13.sp) },
                    textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace, fontSize = 13.sp),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().testTag("skill-instructions"),
                )
            }
            SectionCard(contentPadding = false) {
                ListItem(
                    headlineContent = { Text("Auto") },
                    supportingContent = { Text("Chats load it on their own when a request matches.") },
                    trailingContent = {
                        Switch(
                            checked = auto,
                            onCheckedChange = { on -> haptics.toggle(on); edit { auto = on } },
                            modifier = Modifier.semantics { contentDescription = "Let chats use this skill on their own" }.testTag("skill-editor-auto"),
                        )
                    },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
            val files = skill?.fileList.orEmpty()
            if (files.isNotEmpty()) {
                SectionCard(
                    title = "Files",
                    info = "Come with the skill; chats read them when its instructions say to. Updating from GitHub refreshes them.",
                    contentPadding = false,
                ) {
                    Column {
                        files.forEach { file ->
                            ListItem(
                                headlineContent = {
                                    Text(file.path, style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace), maxLines = 1, overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.horizontalScroll(rememberScrollState()))
                                },
                                leadingContent = { Icon(Icons.Outlined.Description, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                                trailingContent = { Text(kilobytes(file.size), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline) },
                                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                                modifier = Modifier.padding(horizontal = 4.dp),
                            )
                        }
                    }
                }
            }
            error?.let { ErrorText(it, Modifier.testTag("skill-error")) }
            Box(Modifier.height(8.dp))
        }
    }
}
