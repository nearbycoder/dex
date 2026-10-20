package dev.trydex.android.ui.library

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.CallSplit
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.ForkRight
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.LocalOpenInBrowser
import dev.trydex.android.ui.components.Banner
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.Tone
import dev.trydex.android.ui.nav.GeneralSettings
import dev.trydex.core.model.Format
import dev.trydex.core.model.GitHubAccess
import dev.trydex.core.model.GitHubRepo
import dev.trydex.core.model.ProjectRepo
import dev.trydex.core.model.Repos
import kotlinx.coroutines.delay
import java.time.Instant

/** `owner/` dim, then the repo name in bold. */
@Composable
private fun ownerAndName(fullName: String): AnnotatedString {
    val owner = fullName.substringBefore('/')
    val name = fullName.substringAfter('/')
    val dim = MaterialTheme.colorScheme.onSurfaceVariant
    return buildAnnotatedString {
        withStyle(SpanStyle(color = dim)) { append("$owner/") }
        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(name) }
    }
}

/** A GitHub owner's avatar on a rounded tile, with their initial showing until (or if) the picture loads. */
@Composable
fun RepoAvatar(owner: String, size: Dp = 36.dp, url: String? = null, round: Boolean = false) {
    val shape = if (round) CircleShape else RoundedCornerShape(size * 0.28f)
    Box(
        Modifier.size(size).clip(shape).background(MaterialTheme.colorScheme.surfaceContainerHighest),
        contentAlignment = Alignment.Center,
    ) {
        Text(owner.take(1).uppercase(), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        AsyncImage(
            model = url?.takeIf { it.isNotEmpty() } ?: Repos.ownerAvatar(owner),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(size),
        )
    }
}

@Composable
private fun LinkTile(size: Dp = 36.dp) {
    Box(
        Modifier.size(size).clip(RoundedCornerShape(size * 0.28f)).background(MaterialTheme.colorScheme.surfaceContainerHighest),
        contentAlignment = Alignment.Center,
    ) { Icon(Icons.Rounded.Link, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(size * 0.5f)) }
}

/** A repo in the project editor: who and what, its branch and folder. Tap to edit it, × to remove it. */
@Composable
fun RepoCard(repo: ProjectRepo, onEdit: () -> Unit, onRemove: () -> Unit, modifier: Modifier = Modifier) {
    val label = Repos.label(repo.url)
    val github = Repos.isGitHubLabel(label)
    OutlinedCard(onClick = onEdit, shape = RoundedCornerShape(18.dp), modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 12.dp, top = 10.dp, bottom = 10.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (github) RepoAvatar(label.substringBefore('/')) else LinkTile()
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (github) Text(ownerAndName(label), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                else Text(label, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.AutoMirrored.Rounded.CallSplit, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.outline)
                    MetaText(repo.branch.ifEmpty { "default branch" }, Modifier.weight(1f, fill = false))
                    MetaText("~/work/${repo.dir.ifEmpty { Repos.dirName(repo.url) }}", Modifier.weight(1f, fill = false), mono = true)
                }
            }
            Icon(Icons.Rounded.Edit, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.outline)
            IconButton(onClick = onRemove, modifier = Modifier.testTag("repo-remove")) {
                Icon(Icons.Rounded.Close, contentDescription = "Remove $label")
            }
        }
    }
}

private class Configure(val repo: GitHubRepo?, val url: String)

/**
 * Adds or edits one of a project's repos, in two steps: pick a repo (your GitHub repos, a GitHub search, or a git
 * URL), then its branch and folder. [existing] holds the labels already added, lowercased.
 */
@Composable
fun RepoSheet(editing: ProjectRepo?, existing: Set<String>, onDismiss: () -> Unit, onSave: (ProjectRepo) -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var step by remember { mutableStateOf(editing?.let { Configure(null, it.url) }) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, modifier = Modifier.testTag("repo-sheet")) {
        Column(Modifier.fillMaxHeight(0.94f).navigationBarsPadding().imePadding()) {
            val configure = step
            if (configure == null) {
                PickRepo(existing, onClose = onDismiss) { step = it }
            } else {
                ConfigureRepo(configure, editing, onBack = { step = null }, onClose = onDismiss, onSave = onSave)
            }
        }
    }
}

@Composable
private fun SheetHeader(title: String, onBack: (() -> Unit)?, onClose: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back") }
        else Spacer(Modifier.size(16.dp))
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, contentDescription = "Close") }
    }
}

/** Opens GitHub's connect flow in the browser that holds the Dex session. */
@Composable
private fun rememberConnectGitHub(): () -> Unit {
    val app = LocalApp.current
    val open = LocalOpenInBrowser.current
    return { app.graph.repository.session.value?.server?.trimEnd('/')?.let { open("$it/auth/github/connect") } }
}

@Composable
private fun ColumnScope.PickRepo(existing: Set<String>, onClose: () -> Unit, onPick: (Configure) -> Unit) {
    val app = LocalApp.current
    val api = app.graph.repository.api
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val openInBrowser = LocalOpenInBrowser.current
    val connectGitHub = rememberConnectGitHub()
    val focus = LocalFocusManager.current
    val access by produceState<GitHubAccess?>(null) { value = attempt { api.githubRepoAccess() }.getOrNull() }
    var query by rememberSaveable { mutableStateOf("") }
    var owner by rememberSaveable { mutableStateOf<String?>(null) }
    var repos by remember { mutableStateOf<List<GitHubRepo>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var urlMode by rememberSaveable { mutableStateOf(false) }
    var url by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(query, owner) {
        if (query.isNotEmpty()) delay(250)
        attempt { api.searchGitHubRepos(query.trim(), owner) }
            .onSuccess {
                repos = it
                error = null
            }
            .onFailure {
                error = it.message ?: "Couldn't search GitHub."
                repos = emptyList()
            }
    }

    SheetHeader("Add a repository", onBack = null, onClose = onClose)
    OutlinedTextField(
        value = query,
        onValueChange = { query = it },
        placeholder = { Text(owner?.let { "Search $it's repos" } ?: "Search your repos and GitHub") },
        leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
        trailingIcon = if (query.isNotEmpty()) ({ IconButton(onClick = { query = "" }) { Icon(Icons.Rounded.Close, contentDescription = "Clear") } }) else null,
        singleLine = true,
        shape = RoundedCornerShape(50),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, keyboardType = KeyboardType.Text, imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).semantics { contentDescription = "Search repositories" }.testTag("repo-search"),
    )
    val login = access?.login
    if (access?.connected == true && login != null) {
        val owners = listOf(login to "") + access!!.orgs.map { it.login to it.avatarUrl }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = owner == null, onClick = { owner = null }, label = { Text("All") })
            owners.forEach { (name, avatar) ->
                FilterChip(
                    selected = owner == name,
                    onClick = { owner = if (owner == name) null else name },
                    label = { Text(name) },
                    leadingIcon = { RepoAvatar(name, 20.dp, avatar, round = true) },
                    modifier = Modifier.testTag("repo-owner-$name"),
                )
            }
        }
    }
    val github = state?.github
    Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
        if (github != null && github.connected && github.expired) {
            Banner(
                "GitHub stopped accepting your connection, so only public repos show.",
                tone = Tone.Warning,
                action = {
                    if (github.via == "oauth") TextButton(onClick = connectGitHub) { Text("Reconnect") }
                    else TextButton(onClick = { onClose(); app.navigator.open(GeneralSettings) }) { Text("Replace the token") }
                },
            )
        } else if (github != null && !github.connected) {
            Banner(
                "Connect GitHub to see your private and org repos.",
                tone = Tone.Warning,
                action = {
                    if (github.oauthAvailable) TextButton(onClick = connectGitHub) { Text("Connect") }
                    else TextButton(onClick = { onClose(); app.navigator.open(GeneralSettings) }) { Text("Settings") }
                },
            )
        }
    }

    val list = repos
    Box(Modifier.weight(1f).fillMaxWidth()) {
        when {
            list == null -> BoneRows(5)
            error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.align(Alignment.Center).padding(24.dp))
            list.isEmpty() -> Text(
                if (query.isNotEmpty()) "No repos match “$query”." else "No repos here yet.",
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.align(Alignment.Center).padding(24.dp),
            )
            else -> {
                val mine = list.filter { it.accessible }
                val others = list.filterNot { it.accessible }
                LazyColumn(Modifier.fillMaxWidth().testTag("repo-results")) {
                    if (mine.isNotEmpty()) {
                        item(key = "mine") { GroupLabel(if (query.isNotEmpty() || owner != null) "YOUR REPOS" else "RECENTLY PUSHED") }
                        items(mine, key = { "m:" + it.fullName }) { repo -> RepoRow(repo, repo.fullName.lowercase() in existing) { onPick(Configure(repo, repo.fullName)) } }
                    }
                    if (others.isNotEmpty()) {
                        item(key = "others") { GroupLabel("PUBLIC ON GITHUB") }
                        items(others, key = { "o:" + it.fullName }) { repo -> RepoRow(repo, repo.fullName.lowercase() in existing) { onPick(Configure(repo, repo.fullName)) } }
                    }
                }
            }
        }
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    if (urlMode) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val focusRequester = remember { androidx.compose.ui.focus.FocusRequester() }
            LaunchedEffect(Unit) { focusRequester.requestFocus() }
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                placeholder = { Text("https://gitlab.com/team/app.git", style = MonoStyle) },
                textStyle = MonoStyle,
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { if (url.isNotBlank()) onPick(Configure(null, url.trim())) }),
                modifier = Modifier.weight(1f).focusRequester(focusRequester).semantics { contentDescription = "Git URL" }.testTag("repo-url"),
            )
            Button(onClick = { onPick(Configure(null, url.trim())) }, enabled = url.isNotBlank()) { Text("Next") }
        }
    } else {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { urlMode = true }, modifier = Modifier.testTag("repo-use-url")) {
                Icon(Icons.Rounded.Link, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("Use a git URL", modifier = Modifier.padding(start = 6.dp))
            }
            Spacer(Modifier.weight(1f))
            access?.manageUrl?.let { manage ->
                TextButton(onClick = { openInBrowser(manage) }) {
                    Text(if (access?.via == "oauth") "Missing an org? Grant access" else "Edit token access", maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Icon(Icons.AutoMirrored.Rounded.OpenInNew, contentDescription = null, modifier = Modifier.padding(start = 6.dp).size(16.dp))
                }
            }
        }
    }
}

@Composable
private fun GroupLabel(text: String) {
    Text(
        text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 4.dp),
    )
}

@Composable
private fun Pill(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector? = null, warning: Boolean = false) {
    val colors = dev.trydex.android.ui.theme.DexTheme.colors
    Row(
        Modifier.clip(RoundedCornerShape(50)).background(if (warning) colors.warningContainer else MaterialTheme.colorScheme.surfaceContainerHighest).padding(horizontal = 6.dp, vertical = 1.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        val tint = if (warning) colors.onWarningContainer else MaterialTheme.colorScheme.onSurfaceVariant
        if (icon != null) Icon(icon, contentDescription = null, modifier = Modifier.size(11.dp), tint = tint)
        Text(text, style = MaterialTheme.typography.labelSmall, color = tint)
    }
}

@Composable
private fun RepoRow(repo: GitHubRepo, added: Boolean, onClick: () -> Unit) {
    val now = System.currentTimeMillis()
    ListItem(
        headlineContent = {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                Text(ownerAndName(repo.fullName), maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (repo.private) Pill("Private", Icons.Rounded.Lock, warning = true)
                if (repo.fork) Icon(Icons.Rounded.ForkRight, contentDescription = "Fork", modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.outline)
                if (repo.archived) Pill("Archived")
            }
        },
        supportingContent = {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (repo.description.isNotEmpty()) Text(repo.description, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    repo.language?.let { language ->
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Box(Modifier.size(8.dp).clip(CircleShape).background(Color(Repos.LANGUAGE_COLORS[language] ?: 0xFF71717A)))
                            MetaText(language)
                        }
                    }
                    if (repo.stars > 0) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                            Icon(Icons.Rounded.Star, contentDescription = null, modifier = Modifier.size(12.dp), tint = MaterialTheme.colorScheme.outline)
                            MetaText("%,d".format(repo.stars))
                        }
                    }
                    repo.pushedAt?.let { pushed ->
                        runCatching { Instant.parse(pushed).toEpochMilli() }.getOrNull()?.let { MetaText("pushed ${Format.timeAgo(it, now)}") }
                    }
                }
            }
        },
        leadingContent = { RepoAvatar(repo.owner.ifEmpty { repo.fullName.substringBefore('/') }, 36.dp, repo.ownerAvatar) },
        trailingContent = {
            if (added) Icon(Icons.Rounded.Check, contentDescription = "Added", tint = dev.trydex.android.ui.theme.DexTheme.colors.success)
            else Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.outline)
        },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier
            .alpha(if (added) 0.5f else 1f)
            .then(if (added) Modifier else Modifier.clickable(onClick = onClick))
            .testTag("repo-${repo.fullName}"),
    )
}

@Composable
private fun ColumnScope.ConfigureRepo(configure: Configure, editing: ProjectRepo?, onBack: () -> Unit, onClose: () -> Unit, onSave: (ProjectRepo) -> Unit) {
    val app = LocalApp.current
    val openInBrowser = LocalOpenInBrowser.current
    val repo = configure.repo
    val url = configure.url
    val fullName = repo?.fullName ?: Repos.label(url).takeIf(Repos::isGitHubLabel)
    var branch by rememberSaveable(url) { mutableStateOf(editing?.branch ?: "") }
    var dir by rememberSaveable(url) { mutableStateOf(editing?.dir ?: "") }
    var filter by rememberSaveable(url) { mutableStateOf("") }
    val branches by produceState<List<String>?>(if (fullName == null) emptyList() else null, fullName) {
        if (fullName != null) value = attempt { app.graph.repository.api.listGitHubBranches(fullName) }.getOrDefault(emptyList())
    }

    SheetHeader(if (editing != null) "Edit repository" else "Add a repository", onBack = if (editing == null) onBack else null, onClose = onClose)
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                if (fullName != null) RepoAvatar(fullName.substringBefore('/'), 44.dp, repo?.ownerAvatar) else LinkTile(44.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    if (fullName != null) Text(ownerAndName(fullName), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    else Text(url, style = MonoStyle, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    repo?.description?.takeIf { it.isNotEmpty() }?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    if (fullName != null) {
                        TextButton(onClick = { openInBrowser("https://github.com/$fullName") }, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 0.dp)) {
                            Text("View on GitHub", style = MaterialTheme.typography.labelLarge)
                            Icon(Icons.AutoMirrored.Rounded.OpenInNew, contentDescription = null, modifier = Modifier.padding(start = 4.dp).size(14.dp))
                        }
                    }
                }
            }
        }

        ProfileField("Branch") {
            if (fullName != null) {
                val list = branches
                if (list == null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Text("Loading branches…", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else {
                    BranchList(list, repo?.defaultBranch, branch, filter, onFilter = { filter = it }) { branch = it }
                }
            } else {
                OutlinedTextField(
                    value = branch,
                    onValueChange = { branch = it },
                    placeholder = { Text("Default branch", style = MonoStyle) },
                    textStyle = MonoStyle,
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Branch" },
                )
            }
        }

        ProfileField("Folder") {
            OutlinedTextField(
                value = dir,
                onValueChange = { dir = it },
                prefix = { Text("~/work/", style = MonoStyle, color = MaterialTheme.colorScheme.onSurfaceVariant) },
                placeholder = { Text(Repos.dirName(if (fullName != null) "https://github.com/$fullName" else url), style = MonoStyle) },
                supportingText = { Text("Where it's cloned on each chat's VM.") },
                textStyle = MonoStyle,
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Folder" }.testTag("repo-folder"),
            )
        }
    }
    Button(
        onClick = { onSave(ProjectRepo(fullName ?: url, branch, dir.trim())) },
        modifier = Modifier.fillMaxWidth().padding(16.dp).heightIn(min = 48.dp).testTag("repo-save"),
    ) {
        Icon(Icons.Rounded.Check, contentDescription = null, modifier = Modifier.size(18.dp))
        Text(if (editing != null) "Save" else "Add repository", modifier = Modifier.padding(start = 8.dp))
    }
}

@Composable
private fun BranchList(branches: List<String>, repoDefault: String?, branch: String, filter: String, onFilter: (String) -> Unit, onPick: (String) -> Unit) {
    val defaultBranch = branches.firstOrNull() ?: repoDefault
    val needle = filter.lowercase()
    val shown = branches.filter { if (filter.isNotEmpty()) it.lowercase().contains(needle) else it != defaultBranch }.take(100)
    Surface(
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        color = Color.Transparent,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            if (branches.size > 8) {
                OutlinedTextField(
                    value = filter,
                    onValueChange = onFilter,
                    placeholder = { Text("Filter ${branches.size} branches") },
                    leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth().padding(8.dp).semantics { contentDescription = "Filter branches" },
                )
            }
            if (filter.isEmpty()) BranchRow("Default branch", defaultBranch, branch.isEmpty()) { onPick("") }
            shown.forEach { name -> BranchRow(name, null, branch == name, mono = true) { onPick(name) } }
            if (branches.isEmpty()) {
                Text(
                    "Couldn't list branches; the default is used.", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                )
            }
        }
    }
}

@Composable
private fun BranchRow(label: String, detail: String?, selected: Boolean, mono: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 48.dp).padding(horizontal = 4.dp).testTag("branch-$label"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null, modifier = Modifier.padding(horizontal = 8.dp))
        Text(label, style = if (mono) MonoStyle else MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        detail?.let { Text("  $it", style = MonoStyle, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    }
}
