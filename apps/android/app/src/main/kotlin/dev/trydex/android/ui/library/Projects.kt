package dev.trydex.android.ui.library

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.CallSplit
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AddComment
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Source
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.AgentAvatar
import dev.trydex.android.ui.components.Banner
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.EmptyState
import dev.trydex.android.ui.components.ErrorText
import dev.trydex.android.ui.components.Hint
import dev.trydex.android.ui.components.InfoTip
import dev.trydex.android.ui.components.PageColumn
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.SectionCard
import dev.trydex.android.ui.components.Tone
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.components.rememberConfirm
import dev.trydex.android.ui.machine.Dropdown
import dev.trydex.android.ui.nav.GeneralSettings
import dev.trydex.android.ui.nav.NewChat
import dev.trydex.android.ui.nav.ProjectEditor
import dev.trydex.android.ui.nav.ProjectList
import dev.trydex.android.ui.nav.Tab
import dev.trydex.core.client.DexApi
import dev.trydex.core.model.DexState
import dev.trydex.core.model.ProjectImageCandidate
import dev.trydex.core.model.ProjectProfile
import dev.trydex.core.model.ProjectRepo
import dev.trydex.core.model.Repos
import dev.trydex.core.model.Vms
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

private const val NEW = "new"

/** The web's PROJECT_IMAGE_MAX_BYTES: pictures are stored inline in the project, so they stay small. */
private const val PICTURE_MAX_BYTES = 48_000

private fun blankProject() = ProjectProfile(id = "", icon = "briefcase", color = "sky")

/** Projects just created, until the synced state has them (the editor reopens on the new id at once). */
private val createdProjects = mutableMapOf<String, ProjectProfile>()

private fun ProjectProfile.comparable() = copy(createdAt = 0, updatedAt = 0)

private fun chatCount(state: DexState, projectId: String) = state.sessions.count { it.projectId == projectId }

private fun plural(count: Int, word: String) = "$count $word${if (count == 1) "" else "s"}"

/** Every project as a card: its repos, setup, and chats, with Start chat and Edit. */
@Composable
fun ProjectListScreen() {
    val app = LocalApp.current
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val selected = (app.navigator.stack(Tab.Library).getOrNull(2) as? ProjectEditor)?.id
    PaneScaffold(
        title = "Projects",
        actions = { InfoTip("Repos and a setup script. Each chat on a project gets its own VM with everything cloned into ~/work.", "About projects") },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { app.navigator.open(ProjectEditor(NEW)) },
                icon = { Icon(Icons.Rounded.Add, contentDescription = null) },
                text = { Text("New project") },
                modifier = Modifier.testTag("project-new"),
            )
        },
        modifier = Modifier.testTag("project-list"),
    ) { padding ->
        PageColumn(padding) {
            val current = state
            if (current != null && !current.github.connected) {
                Banner(
                    "Connect GitHub to clone private repos and push",
                    tone = Tone.Warning,
                    icon = Icons.Rounded.Source,
                    onClick = { app.navigator.open(GeneralSettings) },
                    action = { Icon(Icons.Rounded.ChevronRight, contentDescription = null) },
                    modifier = Modifier.testTag("project-github-banner"),
                )
            }
            when {
                current == null -> BoneRows(4)
                current.projects.isEmpty() -> EmptyState(
                    "No projects yet. Add your repos and a setup script, then start chats that are ready to work.",
                    Icons.Rounded.Source,
                    modifier = Modifier.testTag("project-empty"),
                )
                else -> ProfileGrid(current.projects) { project -> ProjectCard(project, chatCount(current, project.id), project.id == selected) }
            }
            // Room for the floating button over the last card.
            Box(Modifier.heightIn(min = 56.dp))
        }
    }
}

@Composable
private fun ProjectCard(project: ProjectProfile, chats: Int, selected: Boolean) {
    val app = LocalApp.current
    val scheme = MaterialTheme.colorScheme
    OutlinedCard(
        onClick = { app.navigator.open(ProjectEditor(project.id)) },
        shape = RoundedCornerShape(24.dp),
        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) scheme.primary else scheme.outlineVariant),
        colors = CardDefaults.outlinedCardColors(containerColor = if (selected) scheme.secondaryContainer.copy(alpha = 0.5f) else scheme.surfaceContainerLow),
        modifier = Modifier.fillMaxWidth().testTag("project-row-${project.id}"),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                AgentAvatar(project.icon, project.color, size = 40.dp, image = project.image)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(project.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(project.description.ifEmpty { "Project" }, style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                project.repos.take(4).forEach { repo ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Icon(Icons.AutoMirrored.Rounded.CallSplit, contentDescription = null, modifier = Modifier.size(14.dp), tint = scheme.outline)
                        MetaText(Repos.label(repo.url), Modifier.weight(1f, fill = false))
                        if (repo.branch.isNotEmpty()) Text(repo.branch, style = MaterialTheme.typography.bodySmall, color = scheme.outline, maxLines = 1)
                    }
                }
                if (project.repos.size > 4) Text("+${project.repos.size - 4} more", style = MaterialTheme.typography.bodySmall, color = scheme.outline)
                if (project.repos.isEmpty()) Text("No repos", style = MaterialTheme.typography.bodySmall, color = scheme.outline)
            }
            MetaText("${if (project.setupScript.isNotBlank()) "Setup script" else "No setup script"} · ${plural(chats, "chat")}")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(
                    onClick = { app.navigator.open(NewChat(projectId = project.id, nonce = System.nanoTime())) },
                    modifier = Modifier.weight(1f).testTag("project-start-${project.id}"),
                ) {
                    Icon(Icons.Rounded.AddComment, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("Start chat", modifier = Modifier.padding(start = 8.dp))
                }
                OutlinedButton(onClick = { app.navigator.open(ProjectEditor(project.id)) }) {
                    Icon(Icons.Rounded.Edit, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("Edit", modifier = Modifier.padding(start = 8.dp))
                }
            }
        }
    }
}

/** A project's editor; [id] is "new" for a project that doesn't exist yet. */
@Composable
fun ProjectEditorScreen(id: String) {
    val app = LocalApp.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val confirm = rememberConfirm()
    val haptics = haptics()
    val isNew = id == NEW

    var edited by rememberSaveable(id, stateSaver = draftSaver(ProjectProfile.serializer())) { mutableStateOf<ProjectProfile?>(null) }
    var saved by rememberSaveable(id) { mutableStateOf(id in createdProjects) }
    var saving by remember(id) { mutableStateOf(false) }
    var error by remember(id) { mutableStateOf<String?>(null) }
    // null: closed; -1: adding; else the repo being edited.
    var sheet by rememberSaveable(id) { mutableStateOf<Int?>(null) }

    val current = state
    val existing = current?.project(id) ?: createdProjects[id]
    LaunchedEffect(current?.project(id)) { if (current?.project(id) != null) createdProjects.remove(id) }
    val base = if (isNew) blankProject() else existing
    val draft = edited ?: base
    val dirty = edited != null && (base == null || edited!!.comparable() != base.comparable())

    fun update(change: (ProjectProfile) -> ProjectProfile) {
        val from = draft ?: return
        edited = change(from)
        saved = false
    }

    fun save() {
        val value = draft ?: return
        if (saving || value.name.isBlank()) return
        saving = true
        error = null
        scope.launch {
            attempt { repository.api.saveProject(DexApi.projectDraft(value)) }
                .onSuccess { result ->
                    haptics.confirm()
                    if (isNew) {
                        createdProjects[result.id] = result
                        app.navigator.replace(ProjectEditor(result.id))
                    } else {
                        edited = result
                        saved = true
                    }
                }
                .onFailure {
                    haptics.reject()
                    error = it.message ?: "Couldn't save the project."
                }
            saving = false
        }
    }

    val title = draft?.name?.takeIf { it.isNotBlank() } ?: if (isNew) "New project" else "Untitled"
    PaneScaffold(
        title = title,
        subtitle = draft?.description?.takeIf { it.isNotBlank() } ?: "What this project is",
        modifier = Modifier.testTag("project-editor"),
        bottomBar = {
            if (draft != null) {
                ProfileSaveBar(
                    label = when {
                        isNew -> "Create project"
                        saved && !dirty -> "Saved"
                        else -> "Save"
                    },
                    enabled = !saving && draft.name.isNotBlank() && (isNew || dirty),
                    saving = saving,
                    saved = saved && !dirty && !isNew,
                    saveTag = "project-save",
                    onSave = ::save,
                    onStartChat = if (isNew) null else ({ app.navigator.open(NewChat(projectId = id, nonce = System.nanoTime())) }),
                    onDelete = if (isNew) null else ({
                        confirm.ask("Delete “${draft.name}”?", "Its chats and their VMs stay.") {
                            scope.launch {
                                attempt { repository.api.deleteProject(id) }
                                    .onSuccess {
                                        createdProjects.remove(id)
                                        app.navigator.close(ProjectEditor(id))
                                    }
                                    .onFailure { error = it.message ?: "Couldn't delete the project." }
                            }
                        }
                    }),
                )
            }
        },
    ) { padding ->
        PageColumn(padding, Modifier.consumeWindowInsets(padding).imePadding()) {
            when {
                current == null -> BoneRows(6)
                draft == null -> ProfileMissing("This project no longer exists.", "Back to projects") { app.navigator.open(ProjectList) }
                else -> ProjectForm(draft, current, onChange = ::update, onRepo = { sheet = it })
            }
            error?.let { ErrorText(it, Modifier.testTag("project-error")) }
        }
    }

    val open = sheet
    if (open != null && draft != null) {
        val editing = draft.repos.getOrNull(open)
        RepoSheet(
            editing = editing,
            existing = draft.repos.map { Repos.label(it.url).lowercase() }.toSet(),
            onDismiss = { sheet = null },
            onSave = { repo ->
                update { p -> p.copy(repos = if (editing == null) p.repos + repo else p.repos.mapIndexed { i, r -> if (i == open) repo else r }) }
                sheet = null
            },
        )
    }
}

@Composable
private fun ProjectForm(draft: ProjectProfile, state: DexState, onChange: ((ProjectProfile) -> ProjectProfile) -> Unit, onRepo: (Int) -> Unit) {
    val app = LocalApp.current
    SectionCard {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            AgentAvatar(draft.icon, draft.color, size = 56.dp, image = draft.image)
            OutlinedTextField(
                value = draft.name,
                onValueChange = { v -> onChange { it.copy(name = v.take(60)) } },
                label = { Text("Name") },
                placeholder = { Text("Dex") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                modifier = Modifier.weight(1f).testTag("project-name"),
            )
        }
        OutlinedTextField(
            value = draft.description,
            onValueChange = { v -> onChange { it.copy(description = v.take(200)) } },
            label = { Text("Description") },
            placeholder = { Text("Agent harness on Cloudflare") },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.fillMaxWidth().testTag("project-description"),
        )
    }

    SectionCard {
        ProfileField(
            "Repositories",
            "Cloned into ~/work/<folder> on each chat's VM. Add your GitHub repos (private and org ones included), any public repo, or a git URL.",
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                draft.repos.forEachIndexed { index, repo ->
                    if (repo.url.isNotBlank()) {
                        RepoCard(
                            repo,
                            onEdit = { onRepo(index) },
                            onRemove = { onChange { p -> p.copy(repos = p.repos.filterIndexed { i, _ -> i != index }) } },
                        )
                    }
                }
                OutlinedButton(
                    onClick = { onRepo(-1) },
                    shape = RoundedCornerShape(18.dp),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("project-add-repo"),
                ) {
                    Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("Add repository", modifier = Modifier.padding(start = 8.dp))
                }
                GitHubNote(state)
            }
        }
    }

    SectionCard {
        ProfileField(
            "Setup script",
            "Bash, run once in ~/work after cloning each new VM, with `set -e`. It can run for up to 30 minutes; its log is ~/work/.dex/setup.log. Changes apply to new VMs; on an existing one, use “Re-run setup” on its Machine page.",
        ) {
            OutlinedTextField(
                value = draft.setupScript,
                onValueChange = { v -> onChange { it.copy(setupScript = v.take(20_000)) } },
                placeholder = { Text("cd my-app\nnpm ci\ncp .env.example .env", style = MonoStyle) },
                textStyle = MonoStyle,
                minLines = 6,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Setup script" }.testTag("project-setup"),
            )
        }
        ProfileField("Notes for Dex", "Architecture, conventions, how to run and test. Added to the system prompt of this project's chats.") {
            OutlinedTextField(
                value = draft.instructions,
                onValueChange = { v -> onChange { it.copy(instructions = v.take(20_000)) } },
                placeholder = { Text("TypeScript monorepo. Run `npm test` before committing.\nPRs go against main.") },
                minLines = 5,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Notes for Dex" }.testTag("project-notes"),
            )
        }
        ProfileField("Starter prompt", "Prefilled when you pick the project.") {
            OutlinedTextField(
                value = draft.starter,
                onValueChange = { v -> onChange { it.copy(starter = v.take(2_000)) } },
                placeholder = { Text("In my-app, ") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Starter prompt" }.testTag("project-starter"),
            )
        }
        ProfileField("VM size", "For this project's chats.") {
            val options = listOf("Default (${state.settings.vmSize})") + Vms.SIZES.map { it.second }
            val value = Vms.SIZES.firstOrNull { it.first == draft.vmSize }?.second ?: options.first()
            Dropdown("VM size", value, options, Modifier.fillMaxWidth()) { index ->
                onChange { it.copy(vmSize = if (index == 0) null else Vms.SIZES[index - 1].first) }
            }
        }
    }

    SectionCard {
        ProfileField("Picture", "A favicon or logo from the project's repo, shown instead of the icon.") {
            ProjectPicture(draft) { image -> onChange { it.copy(image = image) } }
        }
        ProfileField("Icon") { ProfileIconGrid(draft.icon) { key -> onChange { it.copy(icon = key) } } }
        ProfileField("Color") { ProfileColorPicker(draft.color) { key -> onChange { it.copy(color = key) } } }
    }
}

/** Why private repos won't clone, if they won't. */
@Composable
private fun GitHubNote(state: DexState) {
    val app = LocalApp.current
    val open = dev.trydex.android.ui.LocalOpenInBrowser.current
    val github = state.github
    when {
        github.connected && github.expired -> Banner(
            "GitHub stopped accepting your connection, so private repos won't clone.",
            tone = Tone.Warning,
            action = {
                if (github.via == "oauth") {
                    TextButton(onClick = { app.graph.repository.session.value?.server?.trimEnd('/')?.let { open("$it/auth/github/connect") } }) { Text("Reconnect") }
                } else {
                    TextButton(onClick = { app.navigator.open(GeneralSettings) }) { Text("Replace the token") }
                }
            },
        )
        !github.connected -> Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Public repos only until you ", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { app.navigator.open(GeneralSettings) }, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 4.dp)) {
                Text("connect GitHub", style = MaterialTheme.typography.bodySmall)
            }
            Text(".", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private class Found(val repo: String, val candidates: List<ProjectImageCandidate>)

/**
 * The project's picture: a favicon or logo found in its first GitHub repo, the owner's avatar, or an image from the
 * device (downscaled to fit the web's 48 KB limit), or none to show the icon.
 */
@Composable
private fun ProjectPicture(draft: ProjectProfile, onChange: (String?) -> Unit) {
    val app = LocalApp.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val repo = draft.repos.firstNotNullOfOrNull { Repos.normalize(it.url)?.let(Repos::githubFullName) }
    var found by remember { mutableStateOf<Found?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var encoding by remember { mutableStateOf(false) }
    val latestRepo by rememberUpdatedState(repo)

    fun look(name: String) {
        loading = true
        error = null
        scope.launch {
            attempt { app.graph.repository.api.projectImageCandidates(name) }
                .onSuccess { candidates -> if (found == null || name == latestRepo) found = Found(name, candidates) }
                .onFailure { error = it.message ?: "Couldn't look in $name." }
            loading = false
        }
    }
    LaunchedEffect(repo) { if (repo != null && draft.image == null && found?.repo != repo) look(repo) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        encoding = true
        error = null
        scope.launch {
            attempt { pictureFromDevice(context, uri) }
                .onSuccess(onChange)
                .onFailure { error = it.message ?: "Couldn't read that image." }
            encoding = false
        }
    }

    val candidates = found?.takeIf { it.repo == repo }?.candidates.orEmpty()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            PictureTile("No picture: the icon below", selected = draft.image == null, onClick = { onChange(null) }, tag = "picture-none") {
                Icon(Icons.Rounded.Block, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
            }
            val image = draft.image
            if (image != null && candidates.none { it.dataUrl == image }) {
                PictureTile("Current picture", selected = true, onClick = null, tag = "picture-current") {
                    AsyncImage(model = image, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.padding(6.dp))
                }
            }
            candidates.forEach { candidate ->
                val owner = repo?.substringBefore('/') ?: ""
                PictureTile(
                    if (candidate.path == "avatar") "$owner's GitHub avatar" else candidate.path,
                    selected = draft.image == candidate.dataUrl,
                    onClick = { onChange(candidate.dataUrl) },
                    tag = "picture-${candidate.path}",
                ) {
                    val shape = if (candidate.path == "avatar") RoundedCornerShape(10.dp) else RoundedCornerShape(0.dp)
                    AsyncImage(
                        model = candidate.dataUrl, contentDescription = null, contentScale = ContentScale.Fit,
                        modifier = Modifier.padding(6.dp).clip(shape),
                    )
                }
            }
            PictureTile("Choose from device", selected = false, onClick = {
                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }, tag = "picture-device") {
                if (encoding) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else Icon(Icons.Rounded.AddPhotoAlternate, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
            }
            if (repo != null) {
                if (loading) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Text("Looking in $repo…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else if (found?.repo != repo) {
                    TextButton(onClick = { look(repo) }, modifier = Modifier.testTag("picture-find")) {
                        Icon(Icons.Rounded.Search, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Find in $repo", modifier = Modifier.padding(start = 6.dp))
                    }
                }
            }
        }
        when {
            repo == null -> Text("Add a GitHub repo to use its favicon or logo.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            found?.repo == repo && !loading -> Text(
                if (candidates.isNotEmpty()) "From $repo. Long-press a picture for its file." else "No favicon or logo found in $repo.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
    }
}

@Composable
private fun PictureTile(title: String, selected: Boolean, onClick: (() -> Unit)?, tag: String, content: @Composable () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(14.dp)
    val border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) scheme.primary else scheme.outlineVariant)
    val color = if (selected) scheme.primaryContainer.copy(alpha = 0.5f) else Color.Transparent
    val modifier = Modifier.size(52.dp).semantics { contentDescription = title }.testTag(tag)
    Hint(title) {
        if (onClick != null) {
            Surface(onClick = onClick, shape = shape, border = border, color = color, modifier = modifier) { Box(contentAlignment = Alignment.Center) { content() } }
        } else {
            Surface(shape = shape, border = border, color = color, modifier = modifier) { Box(contentAlignment = Alignment.Center) { content() } }
        }
    }
}

/** An image from the device as a small data: URL the agent accepts (PNG, else WebP, at most 48 KB). */
private suspend fun pictureFromDevice(context: Context, uri: Uri): String = withContext(Dispatchers.IO) {
    val target = 256
    val decoded: Bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
            val longest = max(info.size.width, info.size.height)
            if (longest > target) {
                val scale = target.toFloat() / longest
                decoder.setTargetSize(max(1, (info.size.width * scale).roundToInt()), max(1, (info.size.height * scale).roundToInt()))
            }
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } else {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= target) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
            ?: error("That file isn't an image Dex can read.")
    }
    @Suppress("DEPRECATION")
    val webp = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.WEBP
    for (size in listOf(target, 160, 96)) {
        val longest = max(decoded.width, decoded.height)
        val bitmap = if (longest > size) {
            val scale = size.toFloat() / longest
            Bitmap.createScaledBitmap(decoded, max(1, (decoded.width * scale).roundToInt()), max(1, (decoded.height * scale).roundToInt()), true)
        } else decoded
        val attempts = listOf(Triple(Bitmap.CompressFormat.PNG, 100, "png")) + listOf(90, 75, 60).map { Triple(webp, it, "webp") }
        for ((format, quality, type) in attempts) {
            val bytes = ByteArrayOutputStream().also { bitmap.compress(format, quality, it) }.toByteArray()
            if (bytes.size <= PICTURE_MAX_BYTES) return@withContext "data:image/$type;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
        }
    }
    error("That image is too big to use as a picture.")
}
