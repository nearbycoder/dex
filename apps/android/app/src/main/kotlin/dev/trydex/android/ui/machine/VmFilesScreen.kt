package dev.trydex.android.ui.machine

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Difference
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.UnfoldMore
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.Banner
import dev.trydex.android.ui.components.Bone
import dev.trydex.android.ui.components.CompactTopBar
import dev.trydex.android.ui.components.EmptyState
import dev.trydex.android.ui.components.ErrorText
import dev.trydex.android.ui.components.Highlighter
import dev.trydex.android.ui.components.Tone
import dev.trydex.android.ui.components.showBack
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.Format
import dev.trydex.core.model.VmChanges
import dev.trydex.core.model.VmDirectory
import dev.trydex.core.model.VmFile
import dev.trydex.core.model.VmFileChange
import dev.trydex.core.model.VmFiles
import dev.trydex.core.model.VmStatus
import dev.trydex.core.model.Vms
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun filesError(error: Throwable): String {
    val message = error.message.orEmpty()
    // An agent from before the Files panel has no `vmFiles` to call.
    return if ("does not exist" in message && "vmFiles" in message) "This Dex is older than the Files panel. Update it to browse VM files."
    else message.ifEmpty { "Could not load the VM files." }
}

/** What a change's letter looks like: green for new, amber for modified, red for deleted (the web's colors). */
@Composable
private fun changeColor(status: String): Color = when (status) {
    "deleted" -> MaterialTheme.colorScheme.error
    "modified" -> DexTheme.colors.warning
    else -> DexTheme.colors.success
}

/**
 * A chat VM's files (the web's Files panel): every file as a tree, the uncommitted Git changes, and a file's source or
 * its diff against HEAD. Wide panes show the list and the file side by side; narrow ones open the file over the list.
 * Looking never starts or wakes the VM.
 */
@Composable
fun VmFilesScreen(key: String) {
    val app = LocalApp.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val connected by repository.connected.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val current = state
    val vm = current?.vms?.firstOrNull { it.key == key }
    val running = vm?.running == true
    val label = current?.let { Vms.label(it, key) }

    var folder by rememberSaveable(key) { mutableStateOf(VmFiles.HOME) }
    var pathInput by rememberSaveable(key) { mutableStateOf(VmFiles.HOME) }
    var tab by rememberSaveable(key) { mutableIntStateOf(0) }
    var selected by rememberSaveable(key) { mutableStateOf<String?>(null) }
    var diff by rememberSaveable(key) { mutableStateOf(false) }
    var expanded by rememberSaveable(key, folder) { mutableStateOf(listOf<String>()) }
    var revision by remember(key) { mutableIntStateOf(0) }
    val directories = remember(key, folder) { mutableStateMapOf<String, VmDirectory>() }
    var root by remember(key, folder) { mutableStateOf<VmDirectory?>(null) }
    var changes by remember(key, folder) { mutableStateOf<VmChanges?>(null) }
    var changesError by remember(key, folder) { mutableStateOf<String?>(null) }
    var error by remember(key) { mutableStateOf<String?>(null) }
    var file by remember(key) { mutableStateOf<VmFile?>(null) }
    var fileError by remember(key) { mutableStateOf<String?>(null) }
    var pending by remember(key) { mutableIntStateOf(0) }
    var starting by remember(key) { mutableStateOf(false) }

    suspend fun loadDirectory(path: String, offset: Int = 0) {
        pending++
        runCatching { repository.api.vmDirectory(key, path, offset) }
            .onSuccess { result ->
                if (result == null) return@onSuccess
                val before = directories[result.path]
                directories[result.path] = if (offset > 0 && before != null) result.copy(entries = before.entries + result.entries) else result
                error = null
            }
            .onFailure { error = filesError(it) }
        pending--
    }

    LaunchedEffect(key, connected) {
        if (connected && vm != null) runCatching { repository.api.vmRefresh(key) }
    }
    // Refresh when the chat's agent finishes a turn: it may have changed files.
    val busy = current?.session(key)?.busy == true
    var wasBusy by remember(key) { mutableStateOf(busy) }
    LaunchedEffect(busy) {
        if (wasBusy && !busy) revision++
        wasBusy = busy
    }

    LaunchedEffect(key, folder, revision, connected, running) {
        if (!connected || !running) return@LaunchedEffect
        // Independent requests: one failing mustn't hide the other view.
        launch {
            pending++
            runCatching { repository.api.vmDirectory(key, folder) }
                .onSuccess { result ->
                    if (result != null) {
                        root = result
                        pathInput = result.path
                        directories[result.path] = result
                        error = null
                    }
                }
                .onFailure { error = filesError(it) }
            pending--
        }
        launch {
            runCatching { repository.api.vmChanges(key, folder) }
                .onSuccess { changes = it; changesError = null }
                .onFailure { changes = null; changesError = filesError(it) }
        }
        // Folders you've opened refresh too, so new and deleted files show up.
        for (path in expanded) launch { loadDirectory(path) }
    }

    LaunchedEffect(selected, revision, connected, running) {
        file = null
        fileError = null
        val path = selected ?: return@LaunchedEffect
        if (!connected || !running) return@LaunchedEffect
        runCatching { repository.api.vmFile(key, path) }
            .onSuccess { file = it }
            .onFailure { fileError = filesError(it) }
    }

    fun navigate(path: String) {
        folder = path
        pathInput = path
        selected = null
    }

    fun select(path: String, changed: Boolean) {
        selected = path
        diff = changed
    }

    fun toggle(path: String) {
        if (path in expanded) {
            expanded = expanded - path
        } else {
            expanded = expanded + path
            if (path !in directories) scope.launch { loadDirectory(path) }
        }
    }

    val changed = remember(changes) { changes?.changes.orEmpty().associateBy { it.path } }

    BoxWithConstraints(Modifier.fillMaxSize().testTag("vm-files")) {
        val split = maxWidth >= 600.dp
        val listWidth = if (maxWidth >= 900.dp) 340.dp else 280.dp
        val inFile = !split && selected != null
        BackHandler(enabled = inFile) { selected = null }
        Scaffold(
            topBar = {
                CompactTopBar(
                    back = inFile || showBack(),
                    onBack = if (inFile) ({ selected = null }) else null,
                    title = {
                        Column {
                            Text(
                                if (inFile) VmFiles.name(selected!!) else "Files",
                                maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium,
                                fontFamily = if (inFile) FontFamily.Monospace else null,
                            )
                            Text(
                                label?.title ?: "Session VM",
                                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                    },
                    actions = {
                        if (running) IconButton(onClick = { revision++ }, enabled = connected && pending == 0, modifier = Modifier.testTag("files-refresh")) {
                            if (pending > 0) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            else Icon(Icons.Rounded.Refresh, contentDescription = "Refresh files")
                        }
                        if (!showBack()) IconButton(onClick = { app.navigator.back() }, modifier = Modifier.testTag("files-close")) {
                            Icon(Icons.Rounded.Close, contentDescription = "Close files")
                        }
                    },
                )
            },
            contentWindowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom),
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                when {
                    current == null -> FilesSkeleton(tree = true)
                    vm == null || !running -> NotRunning(vm?.status ?: VmStatus.None, starting, connected, error) {
                        starting = true
                        error = null
                        scope.launch {
                            runCatching { repository.api.vmStart(key) }.onFailure { error = it.message }
                            starting = false
                        }
                    }
                    else -> {
                        val list = @Composable { modifier: Modifier ->
                            Column(modifier) {
                                PathBar(pathInput, root, onInput = { pathInput = it }, onGo = { if (pathInput.isNotBlank()) navigate(pathInput.trim()) }, onUp = { root?.let { navigate(it.parent) } })
                                if (!connected) Text("Reconnecting… files may be out of date.", style = MaterialTheme.typography.bodySmall, color = DexTheme.colors.warning, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
                                error?.let { message ->
                                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                        ErrorText(message, Modifier.weight(1f))
                                        TextButton(onClick = { revision++ }) { Text("Retry") }
                                    }
                                }
                                val count = changes?.let { "${it.changes.size}${if (it.truncated) "+" else ""}" }
                                SecondaryTabRow(selectedTabIndex = tab) {
                                    Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("All files") }, modifier = Modifier.testTag("files-tab-all"))
                                    Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text(if (count != null) "Changes $count" else "Changes") }, modifier = Modifier.testTag("files-tab-changes"))
                                }
                                if (tab == 0) {
                                    val rootDir = root
                                    if (rootDir == null) FilesSkeleton(tree = true)
                                    else FileTree(rootDir, directories, expanded, changed, selected, pending > 0, onToggle = ::toggle, onSelect = { select(it, false) }) { dir ->
                                        scope.launch { loadDirectory(dir.path, dir.next ?: 0) }
                                    }
                                } else {
                                    ChangeList(changes, changesError, root?.path ?: folder, selected) { select(it, true) }
                                }
                            }
                        }
                        val detail = @Composable { modifier: Modifier ->
                            Box(modifier) {
                                val path = selected
                                if (path == null) EmptyState("Select a file to inspect it.", Icons.Outlined.Code, Modifier.align(Alignment.Center))
                                else FileDetail(path, file?.takeIf { it.path == path }, fileError, diff, showName = split) { diff = it }
                            }
                        }
                        if (split) {
                            Row(Modifier.fillMaxSize()) {
                                list(Modifier.width(listWidth).fillMaxHeight())
                                VerticalDivider()
                                detail(Modifier.weight(1f).fillMaxHeight())
                            }
                        } else if (inFile) {
                            detail(Modifier.fillMaxSize())
                        } else {
                            list(Modifier.fillMaxSize())
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NotRunning(status: VmStatus, starting: Boolean, connected: Boolean, error: String?, onStart: () -> Unit) {
    val booting = starting || status == VmStatus.Starting
    EmptyState(
        if (booting) "The VM is starting…" else "Start this chat's VM to browse its files.",
        Icons.Outlined.FolderOpen,
        Modifier.testTag("files-stopped"),
    ) {
        if (booting) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
        else FilledTonalButton(onClick = onStart, enabled = connected, modifier = Modifier.testTag("files-start")) {
            Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("Start VM", modifier = Modifier.padding(start = 8.dp))
        }
        error?.let { ErrorText(it) }
    }
}

/** Up a folder, and the folder's path to edit (Go opens it). */
@Composable
private fun PathBar(value: String, root: VmDirectory?, onInput: (String) -> Unit, onGo: () -> Unit, onUp: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 12.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onUp, enabled = root != null && root.path != root.parent, modifier = Modifier.testTag("files-up")) {
            Icon(Icons.Rounded.ArrowUpward, contentDescription = "Parent folder")
        }
        OutlinedTextField(
            value = value,
            onValueChange = onInput,
            singleLine = true,
            textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go, autoCorrectEnabled = false),
            keyboardActions = KeyboardActions(onGo = { onGo() }),
            shape = MaterialTheme.shapes.medium,
            modifier = Modifier.weight(1f).heightIn(min = 48.dp).semantics { contentDescription = "VM folder path" }.testTag("files-path"),
        )
    }
}

private sealed interface TreeRow {
    val key: String

    data class Entry(val entry: dev.trydex.core.model.VmFileEntry, val depth: Int) : TreeRow {
        override val key get() = entry.path
    }

    data class Loading(val parent: String, val depth: Int) : TreeRow {
        override val key get() = "loading:$parent"
    }

    data class More(val directory: VmDirectory, val depth: Int) : TreeRow {
        override val key get() = "more:${directory.path}"
    }
}

/** The folder's entries with each opened folder's inside them, folders first (as the agent sorts them). */
private fun flatten(root: VmDirectory, directories: Map<String, VmDirectory>, expanded: List<String>): List<TreeRow> {
    val rows = ArrayList<TreeRow>()
    fun add(directory: VmDirectory, depth: Int) {
        for (entry in directory.entries) {
            rows += TreeRow.Entry(entry, depth)
            if (entry.directory && entry.path in expanded) {
                val inside = directories[entry.path]
                if (inside == null) rows += TreeRow.Loading(entry.path, depth + 1) else add(inside, depth + 1)
            }
        }
        if (directory.next != null) rows += TreeRow.More(directory, depth)
    }
    add(root, 0)
    return rows
}

@Composable
private fun FileTree(
    root: VmDirectory,
    directories: Map<String, VmDirectory>,
    expanded: List<String>,
    changed: Map<String, VmFileChange>,
    selected: String?,
    pending: Boolean,
    onToggle: (String) -> Unit,
    onSelect: (String) -> Unit,
    onMore: (VmDirectory) -> Unit,
) {
    val rows = remember(root, directories.toMap(), expanded) { flatten(directories[root.path] ?: root, directories, expanded) }
    if (root.entries.isEmpty()) {
        EmptyState("This folder is empty.", Icons.Outlined.FolderOpen)
        return
    }
    LazyColumn(Modifier.fillMaxSize().testTag("files-tree")) {
        items(rows, key = { it.key }) { row ->
            when (row) {
                is TreeRow.Entry -> {
                    val entry = row.entry
                    val open = entry.directory && entry.path in expanded
                    val change = changed[entry.path]
                    // A folder with changes inside gets a dot, so you know where to look.
                    val dirty = entry.directory && changed.keys.any { it.startsWith(entry.path + "/") }
                    val on = entry.path == selected
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 40.dp)
                            .background(if (on) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)
                            .clickable(onClickLabel = if (entry.directory) (if (open) "Close folder" else "Open folder") else "Open file") {
                                if (entry.directory) onToggle(entry.path) else onSelect(entry.path)
                            }
                            .semantics { if (!entry.directory) this.selected = on }
                            .padding(start = 8.dp + 16.dp * row.depth, end = 16.dp)
                            .testTag("file-row-${entry.name}"),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (entry.directory) {
                            Icon(Icons.Rounded.ChevronRight, contentDescription = null, modifier = Modifier.size(18.dp).rotate(if (open) 90f else 0f), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            Spacer(Modifier.width(18.dp))
                        }
                        Icon(
                            when {
                                entry.link -> Icons.Outlined.Link
                                entry.directory -> if (open) Icons.Outlined.FolderOpen else Icons.Outlined.Folder
                                else -> Icons.AutoMirrored.Outlined.InsertDriveFile
                            },
                            contentDescription = null,
                            modifier = Modifier.padding(start = 2.dp, end = 8.dp).size(18.dp),
                            tint = if (entry.directory) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            entry.name,
                            style = MaterialTheme.typography.bodyMedium,
                            color = change?.let { changeColor(it.status) } ?: MaterialTheme.colorScheme.onSurface,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        when {
                            change != null -> ChangeLetter(change.status)
                            dirty -> Box(Modifier.size(6.dp).background(DexTheme.colors.warning, androidx.compose.foundation.shape.CircleShape))
                        }
                    }
                }
                is TreeRow.Loading -> Row(Modifier.fillMaxWidth().height(40.dp).padding(start = 8.dp + 16.dp * row.depth + 28.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Bone(fraction = 0.5f, height = 10.dp)
                }
                is TreeRow.More -> TextButton(
                    onClick = { onMore(row.directory) },
                    enabled = !pending,
                    modifier = Modifier.padding(start = 8.dp + 16.dp * row.depth),
                ) { Text("Load more in ${VmFiles.name(row.directory.path)}") }
            }
        }
    }
}

@Composable
private fun ChangeLetter(status: String) {
    Text(
        VmFiles.letter(status),
        fontFamily = FontFamily.Monospace,
        style = MaterialTheme.typography.labelLarge,
        color = changeColor(status),
        modifier = Modifier.padding(start = 8.dp).semantics { contentDescription = status },
    )
}

@Composable
private fun ChangeList(changes: VmChanges?, error: String?, root: String, selected: String?, onSelect: (String) -> Unit) {
    LazyColumn(Modifier.fillMaxSize().testTag("files-changes")) {
        item {
            Text(
                "Staged, unstaged, and new files · compared with HEAD",
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            )
        }
        when {
            error != null -> item { ErrorText(error, Modifier.padding(16.dp)) }
            changes == null -> item { FilesSkeleton(tree = true) }
            changes.repositories.isEmpty() -> item { EmptyState("No Git repository here. Open a repository folder to inspect changes.", Icons.Outlined.Difference) }
            changes.changes.isEmpty() -> item { EmptyState("No uncommitted changes.", Icons.Outlined.Difference) }
            else -> items(changes.changes, key = { it.path }) { change ->
                val on = change.path == selected
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 44.dp)
                        .background(if (on) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)
                        .clickable(onClickLabel = "Show the changes") { onSelect(change.path) }
                        .semantics { this.selected = on }
                        .padding(horizontal = 16.dp, vertical = 6.dp)
                        .testTag("change-row"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        change.letter,
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.labelLarge,
                        color = changeColor(change.status),
                        modifier = Modifier.width(20.dp).semantics { contentDescription = change.status },
                    )
                    Column(Modifier.weight(1f)) {
                        Text(VmFiles.relative(root, change.path), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        change.previousPath?.let {
                            Text("from ${VmFiles.relative(root, it)}", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
        if (changes?.truncated == true) item {
            Text("More changes exist. Open an individual repository to narrow the list.", style = MaterialTheme.typography.bodySmall, color = DexTheme.colors.warning, modifier = Modifier.padding(16.dp))
        }
    }
}

/** A file: its name and size, Source or Changes when it changed, and the text (or why there's none). */
@Composable
private fun FileDetail(path: String, file: VmFile?, error: String?, diff: Boolean, showName: Boolean, onDiff: (Boolean) -> Unit) {
    Column(Modifier.fillMaxSize().testTag("file-detail")) {
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                if (showName) Text(VmFiles.name(path), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(path, file?.takeIf { !it.binary || it.size > 0 }?.let { Format.bytes(it.size) }).joinToString(" · "),
                    fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
            }
            if (file?.change != null && !file.binary && file.message == null) {
                SingleChoiceSegmentedButtonRow(Modifier.padding(start = 8.dp)) {
                    SegmentedButton(
                        selected = !diff, onClick = { onDiff(false) }, shape = SegmentedButtonDefaults.itemShape(0, 2),
                        icon = {}, modifier = Modifier.testTag("file-source"),
                    ) { Icon(Icons.Outlined.Code, contentDescription = "Source", modifier = Modifier.size(18.dp)) }
                    SegmentedButton(
                        selected = diff, onClick = { onDiff(true) }, shape = SegmentedButtonDefaults.itemShape(1, 2),
                        icon = {}, modifier = Modifier.testTag("file-diff"),
                    ) { Icon(Icons.Outlined.Difference, contentDescription = "Changes", modifier = Modifier.size(18.dp)) }
                }
            }
        }
        HorizontalDivider()
        when {
            error != null -> ErrorText(error, Modifier.padding(16.dp))
            file == null -> FilesSkeleton(tree = false)
            else -> {
                if (file.truncated) Banner("Preview limited to the first 64 KB. The diff may be incomplete.", Modifier.padding(12.dp), tone = Tone.Warning)
                val language = path.substringAfterLast('/').substringAfterLast('.', "").lowercase().ifEmpty { null }
                when {
                    file.message != null -> EmptyState(file.message!!, Icons.AutoMirrored.Outlined.InsertDriveFile)
                    diff && file.change != null && (file.before != null || file.content != null) -> DiffView(file.before.orEmpty(), file.content.orEmpty(), language)
                    file.content != null -> SourceView(file.content!!, language)
                    else -> EmptyState("This file was deleted. Select Changes to see its previous content.", Icons.AutoMirrored.Outlined.InsertDriveFile)
                }
            }
        }
    }
}

private val codeStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 18.sp)

/** A file's text with line numbers, on the code background; long lines scroll sideways. */
@Composable
private fun SourceView(content: String, language: String?) {
    val lines = remember(content) { VmFiles.lines(content).mapIndexed { i, line -> VmFiles.Row.Line(VmFiles.Kind.Context, line.removeSuffix("\n").removeSuffix("\r"), i + 1, i + 1) } }
    Surface(color = DexTheme.colors.codeBackground, contentColor = DexTheme.colors.codeText, modifier = Modifier.fillMaxSize().testTag("file-source-view")) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
            CodeBlock(lines, language, diff = false)
        }
    }
}

/**
 * The file against Git HEAD as a unified diff (jsdiff's hunks, as the web shows): added lines green, removed red, both
 * line numbers in the gutter, and the unchanged stretches between hunks folded until you open them.
 */
@Composable
private fun DiffView(before: String, after: String, language: String?) {
    val rows by produceState<List<VmFiles.Row>?>(null, before, after) {
        value = withContext(Dispatchers.Default) { VmFiles.rows(before, after) }
    }
    val opened = remember(before, after) { mutableStateMapOf<Int, Boolean>() }
    Surface(color = DexTheme.colors.codeBackground, contentColor = DexTheme.colors.codeText, modifier = Modifier.fillMaxSize().testTag("file-diff-view")) {
        val all = rows
        when {
            all == null -> FilesSkeleton(tree = false)
            all.isEmpty() -> EmptyState("No changes since the last commit.", Icons.Outlined.Difference)
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
                // Consecutive lines (and gaps you opened) draw as one block; closed gaps are buttons between blocks.
                val block = ArrayList<VmFiles.Row.Line>()
                val segments = ArrayList<Any>()
                for (row in all) {
                    when (row) {
                        is VmFiles.Row.Line -> block += row
                        is VmFiles.Row.Gap -> if (opened[row.oldStart] == true) block += VmFiles.expand(row, after) else {
                            if (block.isNotEmpty()) segments.add(block.toList())
                            block.clear()
                            segments += row
                        }
                    }
                }
                if (block.isNotEmpty()) segments.add(block.toList())
                for (segment in segments) {
                    @Suppress("UNCHECKED_CAST")
                    when (segment) {
                        is VmFiles.Row.Gap -> GapRow(segment) { opened[segment.oldStart] = true }
                        else -> CodeBlock(segment as List<VmFiles.Row.Line>, language, diff = true)
                    }
                }
            }
        }
    }
}

@Composable
private fun GapRow(gap: VmFiles.Row.Gap, onOpen: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 36.dp)
            .background(Color.White.copy(alpha = 0.05f))
            .clickable(onClickLabel = "Show unchanged lines", onClick = onOpen)
            .padding(horizontal = 12.dp)
            .testTag("diff-gap"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.UnfoldMore, contentDescription = null, modifier = Modifier.size(16.dp), tint = DexTheme.colors.codeText.copy(alpha = 0.6f))
        Text(
            "${gap.count} unchanged ${if (gap.count == 1) "line" else "lines"}",
            style = MaterialTheme.typography.labelMedium, color = DexTheme.colors.codeText.copy(alpha = 0.6f),
            modifier = Modifier.padding(start = 8.dp),
        )
    }
}

private val added = Color(0xFF22C55E)
private val removed = Color(0xFFEF4444)

/**
 * Numbered lines: a gutter that stays put (one number column for a file, old and new for a diff, with + and −) and the
 * text, which scrolls sideways. Each line is one text line, so a diff's line colors are painted across the whole row.
 */
@Composable
private fun CodeBlock(lines: List<VmFiles.Row.Line>, language: String?, diff: Boolean) {
    val digits = remember(lines) { (lines.maxOfOrNull { maxOf(it.oldNumber ?: 0, it.newNumber ?: 0) } ?: 1).toString().length }
    val gutter = remember(lines, diff) {
        AnnotatedString(lines.joinToString("\n") { line ->
            if (!diff) (line.newNumber?.toString() ?: "").padStart(digits)
            else {
                val sign = when (line.kind) {
                    VmFiles.Kind.Added -> "+"
                    VmFiles.Kind.Removed -> "−"
                    VmFiles.Kind.Context -> " "
                }
                "${(line.oldNumber?.toString() ?: "").padStart(digits)} ${(line.newNumber?.toString() ?: "").padStart(digits)} $sign"
            }
        })
    }
    val text = remember(lines, language) { Highlighter.highlight(lines.joinToString("\n") { it.text }, language) }
    var layout by remember(lines) { mutableStateOf<TextLayoutResult?>(null) }
    val kinds = remember(lines) { lines.map { it.kind } }
    Row(
        Modifier.fillMaxWidth().drawBehind {
            val result = layout ?: return@drawBehind
            if (!diff) return@drawBehind
            for ((i, kind) in kinds.withIndex()) {
                if (kind == VmFiles.Kind.Context || i >= result.lineCount) continue
                val top = result.getLineTop(i)
                val color = if (kind == VmFiles.Kind.Added) added else removed
                drawRect(color.copy(alpha = 0.16f), Offset(0f, top), Size(size.width, result.getLineBottom(i) - top))
                drawRect(color.copy(alpha = 0.8f), Offset(0f, top), Size(3.dp.toPx(), result.getLineBottom(i) - top))
            }
        },
    ) {
        Text(
            gutter,
            style = codeStyle,
            color = DexTheme.colors.codeText.copy(alpha = 0.4f),
            softWrap = false,
            textAlign = TextAlign.End,
            modifier = Modifier.padding(start = 12.dp, end = 12.dp).clearAndSetSemantics {},
        )
        Box(Modifier.weight(1f).horizontalScroll(rememberScrollState())) {
            SelectionContainer {
                Text(text, style = codeStyle, softWrap = false, onTextLayout = { layout = it }, modifier = Modifier.padding(end = 16.dp))
            }
        }
    }
}

/** Loading: tree rows (an icon and a name, some indented), or numbered source lines. */
@Composable
private fun FilesSkeleton(tree: Boolean) {
    val widths = listOf(0.62f, 0.75f, 0.4f, 0.55f, 0.8f)
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).testTag("files-skeleton")) {
        repeat(if (tree) 10 else 18) { i ->
            Row(
                Modifier.fillMaxWidth().height(if (tree) 40.dp else 18.dp).padding(start = if (tree && i % 3 != 0) 16.dp else 0.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Bone(width = if (tree) 18.dp else 16.dp, height = if (tree) 18.dp else 10.dp)
                Spacer(Modifier.width(if (tree) 10.dp else 12.dp))
                Bone(fraction = widths[i % widths.size], height = if (tree) 12.dp else 10.dp)
            }
        }
    }
}
