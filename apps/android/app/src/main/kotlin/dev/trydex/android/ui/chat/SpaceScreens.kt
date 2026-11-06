package dev.trydex.android.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.AppContext
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.LocalOpenInBrowser
import dev.trydex.android.ui.components.AgentAvatar
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.EmptyState
import dev.trydex.android.ui.components.ErrorText
import dev.trydex.android.ui.components.Markdown
import dev.trydex.android.ui.components.PageColumn
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.SectionCard
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.components.rememberConfirm
import dev.trydex.android.ui.library.ProfileField
import dev.trydex.android.ui.library.ProfileMissing
import dev.trydex.android.ui.library.ProfileSaveBar
import dev.trydex.android.ui.library.attempt
import dev.trydex.android.ui.library.draftSaver
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.nav.ChatList
import dev.trydex.android.ui.nav.SpaceSettings
import dev.trydex.android.ui.nav.SpaceThreads
import dev.trydex.core.client.DexApi
import dev.trydex.core.model.SpaceProfile
import dev.trydex.core.model.Spaces
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/** What the space editor edits. */
@Serializable
private data class SpaceForm(val name: String = "", val goal: String = "", val projectId: String? = null) {
    companion object {
        fun of(space: SpaceProfile) = SpaceForm(space.name, space.goal, space.projectId)
    }
}

/** What deleting a space takes with it, for its confirmation. */
fun spaceDeleteText(threads: Int) =
    "Deletes the space, its chat, and its $threads ${if (threads == 1) "thread" else "threads"} with their VMs. This can't be undone."

/** Leaves every screen of a deleted space: its chat, its threads, and its panels. */
fun AppContext.closeSpace(space: SpaceProfile, threadIds: List<String>) {
    navigator.close(SpaceSettings(space.id, space.sessionId))
    navigator.close(SpaceThreads(space.id, space.sessionId))
    navigator.close(SpaceThreads(space.id, space.sessionId, notes = true))
    (threadIds + space.sessionId).forEach { navigator.close(Chat(it)) }
}

/** An agent from before spaces says the method doesn't exist: say what to do instead. */
fun spaceError(error: Throwable, fallback: String): String =
    error.message?.takeIf { "does not exist" in it }?.let { "This Dex doesn't have spaces yet. Update it, then try again." } ?: error.message ?: fallback

/**
 * A new space ([id] null), or a space's name, goal, and project. Creating one opens its chat, where you tell the
 * coordinator what to work on.
 */
@Composable
fun SpaceEditorScreen(id: String?, nonce: Long = 0) {
    val app = LocalApp.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val confirm = rememberConfirm()
    val haptics = haptics()
    val key = id ?: "new-$nonce"
    var edited by rememberSaveable(key, stateSaver = draftSaver(SpaceForm.serializer())) { mutableStateOf<SpaceForm?>(null) }
    var saving by remember(key) { mutableStateOf(false) }
    var saved by remember(key) { mutableStateOf(false) }
    var error by remember(key) { mutableStateOf<String?>(null) }

    val current = state
    val existing = current?.space(id)
    val base = if (id == null) SpaceForm() else existing?.let(SpaceForm::of)
    val draft = edited ?: base
    val dirty = edited != null && edited != base
    val name = draft?.name?.trim().orEmpty()

    // Reads the draft when called, not when composed: the form's fields may hold on to an older copy of this.
    fun update(change: (SpaceForm) -> SpaceForm) {
        val from = edited ?: (if (id == null) SpaceForm() else repository.state.value?.space(id)?.let(SpaceForm::of)) ?: return
        edited = change(from)
        saved = false
    }

    fun save() {
        val value = draft ?: return
        if (saving || name.isEmpty()) return
        saving = true
        error = null
        scope.launch {
            attempt { repository.api.saveSpace(DexApi.spaceDraft(id, value.name, value.goal, value.projectId)) }
                .onSuccess { result ->
                    haptics.confirm()
                    if (id == null) {
                        // Its chat: tell the coordinator what to work on.
                        app.navigator.open(Chat(result.sessionId))
                    } else {
                        edited = null
                        saved = true
                    }
                }
                .onFailure {
                    haptics.reject()
                    error = spaceError(it, "Couldn't save the space.")
                }
            saving = false
        }
    }

    PaneScaffold(
        title = name.ifEmpty { if (id == null) "New space" else "Untitled" },
        subtitle = "A coordinator that runs threads of work for you",
        modifier = Modifier.testTag("space-editor"),
        bottomBar = {
            if (draft != null) {
                ProfileSaveBar(
                    label = when {
                        id == null -> "Create space"
                        saved && !dirty -> "Saved"
                        else -> "Save"
                    },
                    enabled = !saving && name.isNotEmpty() && (id == null || dirty),
                    saving = saving,
                    saved = saved && !dirty,
                    saveTag = "space-save",
                    onSave = ::save,
                    onStartChat = null,
                    onDelete = existing?.let { space ->
                        {
                            val threads = Spaces.threads(space, current.sessions)
                            confirm.ask("Delete “${space.name}”?", spaceDeleteText(threads.size)) {
                                scope.launch {
                                    attempt { repository.api.deleteSpace(space.id) }
                                        .onSuccess { app.closeSpace(space, threads.map { it.id }) }
                                        .onFailure { error = spaceError(it, "Couldn't delete the space.") }
                                }
                            }
                        }
                    },
                )
            }
        },
    ) { padding ->
        PageColumn(padding, Modifier.consumeWindowInsets(padding).imePadding()) {
            when {
                current == null -> BoneRows(5)
                draft == null -> ProfileMissing("This space no longer exists.", "Back to chats") { app.navigator.open(ChatList) }
                else -> SpaceFormFields(draft, current.projects, ::update)
            }
            error?.let { ErrorText(it, Modifier.testTag("space-error")) }
        }
    }
}

@Composable
private fun SpaceFormFields(draft: SpaceForm, projects: List<dev.trydex.core.model.ProjectProfile>, onChange: ((SpaceForm) -> SpaceForm) -> Unit) {
    SectionCard {
        OutlinedTextField(
            value = draft.name,
            onValueChange = { v -> onChange { it.copy(name = v.take(Spaces.MAX_NAME)) } },
            label = { Text("Name") },
            placeholder = { Text("Android launch") },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.fillMaxWidth().testTag("space-name"),
        )
    }
    SectionCard {
        ProfileField("Goal", "What the work is for; Dex keeps the threads pointed at it") {
            OutlinedTextField(
                value = draft.goal,
                onValueChange = { v -> onChange { it.copy(goal = v.take(Spaces.MAX_GOAL)) } },
                placeholder = { Text("Ship 2.4 to the Play Store this week, with release notes") },
                minLines = 3,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth().testTag("space-goal"),
            )
        }
    }
    SectionCard {
        ProfileField("Project", "Threads work in this project, each on its own VM") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = draft.projectId == null,
                    onClick = { onChange { it.copy(projectId = null) } },
                    label = { Text("None") },
                    modifier = Modifier.heightIn(min = 40.dp).testTag("space-project-none"),
                )
                projects.forEach { p ->
                    FilterChip(
                        selected = p.id == draft.projectId,
                        onClick = { onChange { it.copy(projectId = if (it.projectId == p.id) null else p.id) } },
                        label = { Text(p.name, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 180.dp)) },
                        leadingIcon = { AgentAvatar(p.icon, p.color, size = 22.dp, image = p.image) },
                        modifier = Modifier.heightIn(min = 40.dp).testTag("space-project-${p.id}"),
                    )
                }
            }
        }
    }
}

/**
 * A space's threads, by status (what needs you first), and its coordinator's notes. Beside the space's chat on wide
 * screens; tapping a thread opens it.
 */
@Composable
fun SpaceThreadsScreen(route: SpaceThreads) {
    val app = LocalApp.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val haptics = haptics()
    var notes by rememberSaveable(route) { mutableStateOf(route.notes) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            now = System.currentTimeMillis()
        }
    }
    val current = state
    val space = current?.space(route.id)
    val threads = if (current != null && space != null) Spaces.threads(space, current.sessions) else emptyList()
    PaneScaffold(title = if (notes) "Notes" else "Threads", subtitle = space?.name, modifier = Modifier.testTag("space-threads-panel")) { padding ->
        when {
            current == null -> Box(Modifier.padding(padding)) { BoneRows(6) }
            space == null -> Box(Modifier.padding(padding)) { ProfileMissing("This space no longer exists.", "Back to chats") { app.navigator.open(ChatList) } }
            else -> LazyColumn(Modifier.fillMaxSize().consumeWindowInsets(padding).testTag("space-threads-list"), contentPadding = padding) {
                item(key = "tabs") {
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                        listOf(false to "Threads · ${threads.size}", true to "Notes").forEachIndexed { index, (tab, label) ->
                            SegmentedButton(
                                selected = notes == tab,
                                onClick = { haptics.tap(); notes = tab },
                                shape = SegmentedButtonDefaults.itemShape(index, 2),
                                modifier = Modifier.testTag(if (tab) "space-tab-notes" else "space-tab-threads"),
                            ) { Text(label) }
                        }
                    }
                }
                if (notes) {
                    item(key = "notes") { SpaceNotes(space, coordinatorBusy = current.session(space.sessionId)?.busy == true) }
                } else if (threads.isEmpty()) {
                    item(key = "empty") { EmptyState("No threads yet. Tell Dex what to work on in the space's chat, and it starts them here.", Icons.Outlined.AccountTree) }
                } else {
                    for ((status, list) in Spaces.grouped(threads, current.access.pending)) {
                        item(key = "status-${status.id}") {
                            Text(
                                "${status.label} · ${list.size}",
                                style = MaterialTheme.typography.labelLarge,
                                color = threadStatusColor(status),
                                modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 16.dp, bottom = 4.dp).testTag("status-${status.id}"),
                            )
                        }
                        items(list, key = { it.id }) { thread -> ThreadRow(thread, status, now) }
                    }
                }
            }
        }
    }
}

/** The coordinator's notes, read when shown and again each time it finishes a reply. */
@Composable
private fun SpaceNotes(space: SpaceProfile, coordinatorBusy: Boolean) {
    val app = LocalApp.current
    val openUrl = LocalOpenInBrowser.current
    var text by remember(space.id) { mutableStateOf<String?>(null) }
    var error by remember(space.id) { mutableStateOf<String?>(null) }
    LaunchedEffect(space.id, coordinatorBusy) {
        if (coordinatorBusy && text != null) return@LaunchedEffect
        attempt { app.graph.repository.api.spaceNotes(space.id) }
            .onSuccess { text = it; error = null }
            .onFailure { error = spaceError(it, "Couldn't read the notes.") }
    }
    Box(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp).testTag("space-notes"), contentAlignment = Alignment.TopStart) {
        val notes = text
        when {
            error != null && notes == null -> ErrorText(error!!)
            notes == null -> BoneRows(5)
            notes.isBlank() -> EmptyState("No notes yet. Dex writes down the plan, decisions, and progress here as the work goes.", Icons.Outlined.Description)
            else -> Markdown(notes, onLink = openUrl)
        }
    }
}
