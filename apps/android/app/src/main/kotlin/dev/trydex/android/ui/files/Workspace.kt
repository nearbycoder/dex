package dev.trydex.android.ui.files

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.NoteAdd
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.LocalOpenInBrowser
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.CompactTopBar
import dev.trydex.android.ui.components.InfoTip
import dev.trydex.android.ui.components.Markdown
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.rememberConfirm
import dev.trydex.android.ui.nav.Tab
import dev.trydex.android.ui.nav.WorkspaceFile
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.WebAudio
import dev.trydex.core.model.Format
import dev.trydex.core.model.WorkspaceFileContent
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import dev.trydex.core.model.WorkspaceFile as FileEntry

/** Bumps when files change (a save, a delete, a command), so the list reloads. */
private object WorkspaceChanges {
    val version = MutableStateFlow(0)
    fun changed() {
        version.value++
    }
}

/** A path as the workspace names it: relative paths are under /workspace. */
fun workspacePath(path: String) = if (path.startsWith("/")) path else "/workspace/$path"

/** Files that open in a preview: Markdown and HTML. */
fun previewKind(path: String): String? = when {
    Regex("\\.(md|markdown)$", RegexOption.IGNORE_CASE).containsMatchIn(path) -> "markdown"
    Regex("\\.html?$", RegexOption.IGNORE_CASE).containsMatchIn(path) -> "html"
    else -> null
}

private class TerminalEntry(val command: String, val output: String, val exitCode: Int)

/** The agent's workspace: its files, kept across chats, and a simulated shell. */
@Composable
fun WorkspaceScreen() {
    val app = LocalApp.current
    val repository = app.graph.repository
    val connected by repository.connected.collectAsStateWithLifecycle()
    val version by WorkspaceChanges.version.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var files by remember { mutableStateOf<List<FileEntry>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(false) }
    LaunchedEffect(connected, version) {
        if (connected) runCatching { repository.api.listFiles() }.onSuccess { files = it; error = null }.onFailure { error = it.message }
    }
    val selected = (app.navigator.stack(Tab.Library).lastOrNull() as? WorkspaceFile)?.path
    PaneScaffold(
        title = "Workspace",
        actions = {
            InfoTip("The agent's files, kept across chats. /workspace/MEMORY.md is its long-term memory, added to every chat. The shell below is simulated (bash, jq, curl, rg…); real programs run on a chat's VM.", "About the workspace")
            IconButton(onClick = WorkspaceChanges::changed) { Icon(Icons.Rounded.Refresh, contentDescription = "Refresh") }
            IconButton(onClick = { creating = true }, modifier = Modifier.testTag("new-file")) { Icon(Icons.Outlined.NoteAdd, contentDescription = "New file") }
        },
        bottomBar = { Terminal() },
        modifier = Modifier.testTag("workspace"),
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            val list = files
            when {
                list == null -> BoneRows(5, Modifier.padding(16.dp))
                list.isEmpty() -> Text("Empty. Files Dex creates with its tools show up here.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp))
                else -> LazyColumn(Modifier.fillMaxSize().testTag("file-list")) {
                    items(list, key = { it.path }) { file ->
                        ListItem(
                            headlineContent = { Text(file.path.removePrefix("/workspace/"), fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            supportingContent = { Text("${Format.bytes(file.size)} · ${Format.timeAgo(file.mtime)}") },
                            leadingContent = { Icon(Icons.Outlined.Description, contentDescription = null) },
                            colors = ListItemDefaults.colors(containerColor = if (file.path == selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent),
                            modifier = Modifier.testTag("file-${file.path}").clickable { app.navigator.open(WorkspaceFile(file.path)) },
                        )
                    }
                }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.align(Alignment.BottomStart).padding(16.dp)) }
        }
    }
    if (creating) {
        val path = rememberTextFieldState("notes.md")
        AlertDialog(
            onDismissRequest = { creating = false },
            title = { Text("New file path") },
            text = { OutlinedTextField(state = path, lineLimits = TextFieldLineLimits.SingleLine, textStyle = TextStyle(fontFamily = FontFamily.Monospace), modifier = Modifier.testTag("new-file-path")) },
            confirmButton = {
                TextButton(onClick = {
                    val value = path.text.toString().trim()
                    creating = false
                    if (value.isEmpty()) return@TextButton
                    scope.launch {
                        runCatching { repository.api.writeFile(value, "") }
                            .onSuccess {
                                WorkspaceChanges.changed()
                                app.navigator.open(WorkspaceFile(workspacePath(value)))
                            }
                            .onFailure { error = it.message }
                    }
                }) { Text("Create") }
            },
            dismissButton = { TextButton(onClick = { creating = false }) { Text("Cancel") } },
        )
    }
}

/** The workspace shell: history above, a command line below. */
@Composable
private fun Terminal() {
    val app = LocalApp.current
    val repository = app.graph.repository
    val connected by repository.connected.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val history = remember { mutableStateListOf<TerminalEntry>() }
    var running by remember { mutableStateOf(false) }
    var command by rememberSaveable { mutableStateOf("") }
    val scroll = rememberScrollState()
    LaunchedEffect(history.size) { scroll.animateScrollTo(scroll.maxValue) }
    Surface(color = DexTheme.colors.codeBackground, contentColor = DexTheme.colors.codeText, modifier = Modifier.fillMaxWidth().testTag("terminal")) {
        Column(Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))) {
            if (history.isNotEmpty()) {
                Column(Modifier.fillMaxWidth().heightIn(max = 256.dp).verticalScroll(scroll).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    history.forEach { entry ->
                        Text("$ ${entry.command}", fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = DexTheme.colors.success)
                        if (entry.output.isNotEmpty()) Text(entry.output, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = if (entry.exitCode == 0) DexTheme.colors.codeText else Color(0xFFFCA5A5))
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Terminal, contentDescription = null, modifier = Modifier.size(18.dp), tint = DexTheme.colors.codeText.copy(alpha = 0.6f))
                androidx.compose.foundation.text.BasicTextField(
                    value = command,
                    onValueChange = { command = it },
                    enabled = !running && connected,
                    singleLine = true,
                    textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 14.sp, color = DexTheme.colors.codeText),
                    cursorBrush = androidx.compose.ui.graphics.SolidColor(DexTheme.colors.success),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send, autoCorrectEnabled = false),
                    keyboardActions = KeyboardActions(onSend = {
                        val value = command.trim()
                        if (value.isEmpty()) return@KeyboardActions
                        running = true
                        command = ""
                        scope.launch {
                            runCatching { repository.api.runCommand(value) }
                                .onSuccess { result ->
                                    history += TerminalEntry(value, result.stdout + result.stderr, result.exitCode)
                                    while (history.size > 21) history.removeAt(0)
                                }
                                .onFailure { history += TerminalEntry(value, it.message ?: it.toString(), 1) }
                            WorkspaceChanges.changed()
                            running = false
                        }
                    }),
                    decorationBox = { field ->
                        Box(Modifier.padding(horizontal = 10.dp, vertical = 14.dp)) {
                            if (command.isEmpty()) Text(if (running) "Running…" else "Run a command (bash, jq, curl, rg…)", fontFamily = FontFamily.Monospace, fontSize = 14.sp, color = DexTheme.colors.codeText.copy(alpha = 0.5f))
                            field()
                        }
                    },
                    modifier = Modifier.weight(1f).imePadding().testTag("terminal-input"),
                )
                if (running) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = DexTheme.colors.codeText)
            }
        }
    }
}

/** One workspace file: Markdown and HTML preview by default, everything else in a plain editor. */
@Composable
fun WorkspaceFileScreen(path: String) {
    val app = LocalApp.current
    val repository = app.graph.repository
    val connected by repository.connected.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val confirm = rememberConfirm()
    var file by remember(path) { mutableStateOf<WorkspaceFileContent?>(null) }
    var error by remember(path) { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    val draft = rememberTextFieldState()
    val kind = previewKind(path)
    var editing by rememberSaveable(path) { mutableStateOf(kind == null) }
    LaunchedEffect(path, connected) {
        if (!connected || file != null) return@LaunchedEffect
        runCatching { repository.api.readFile(path) }
            .onSuccess {
                file = it
                draft.setTextAndPlaceCursorAtEnd(it.content.orEmpty())
            }
            .onFailure { error = it.message }
    }
    val current = file
    val dirty = current?.content != null && draft.text.toString() != current.content
    Scaffold(
        topBar = {
            CompactTopBar(
                title = { Text(path, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                actions = {
                    if (current?.content != null) {
                        FilledIconButton(onClick = {
                            saving = true
                            val text = draft.text.toString()
                            scope.launch {
                                runCatching { repository.api.writeFile(path, text) }
                                    .onSuccess { file = current.copy(content = text); WorkspaceChanges.changed() }
                                    .onFailure { error = it.message }
                                saving = false
                            }
                        }, enabled = dirty && !saving, modifier = Modifier.testTag("file-save")) {
                            if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.Save, contentDescription = "Save")
                        }
                    }
                    IconButton(onClick = {
                        confirm.ask("Delete $path?") {
                            scope.launch {
                                runCatching { repository.api.deleteFile(path) }
                                    .onSuccess { WorkspaceChanges.changed(); app.navigator.back() }
                                    .onFailure { error = it.message }
                            }
                        }
                    }, modifier = Modifier.testTag("file-delete")) { Icon(Icons.Outlined.DeleteOutline, contentDescription = "Delete") }
                },
            )
        },
        contentWindowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom),
        modifier = Modifier.testTag("file-screen"),
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) }
            if (current?.content != null && kind != null) {
                SingleChoiceSegmentedButtonRow(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    SegmentedButton(selected = !editing, onClick = { editing = false }, shape = SegmentedButtonDefaults.itemShape(0, 2), icon = { Icon(Icons.Outlined.Visibility, contentDescription = null, modifier = Modifier.size(18.dp)) }) { Text("Preview") }
                    SegmentedButton(selected = editing, onClick = { editing = true }, shape = SegmentedButtonDefaults.itemShape(1, 2), icon = { Icon(Icons.Outlined.Edit, contentDescription = null, modifier = Modifier.size(18.dp)) }) { Text("Edit") }
                }
            }
            when {
                current == null && error == null -> BoneRows(8, Modifier.padding(16.dp))
                current == null -> Unit
                current.content == null -> Text("Binary file (${Format.bytes(current.size)}).", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
                !editing && kind == "markdown" -> {
                    val openInBrowser = LocalOpenInBrowser.current
                    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
                        Markdown(draft.text.toString(), modifier = Modifier.widthIn(max = 768.dp).fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp).testTag("file-preview"), onLink = openInBrowser)
                    }
                }
                !editing && kind == "html" -> HtmlPreview(draft.text.toString(), Modifier.fillMaxSize().testTag("file-preview"))
                else -> androidx.compose.foundation.text.BasicTextField(
                    state = draft,
                    textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 20.sp, color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = androidx.compose.ui.graphics.SolidColor(MaterialTheme.colorScheme.primary),
                    keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxSize().horizontalScroll(rememberScrollState()).padding(16.dp).testTag("file-editor"),
                )
            }
        }
    }
}

/**
 * Agent-written HTML, rendered where it can't reach Dex: a WebView whose page has an origin of its own (so Dex's
 * session cookie never goes with it), with no bridge to the app. Links open in the browser. Sound plays (games
 * especially): the page gets Dex's audio unlock as its first script (WebAudio), and media needs no extra gesture.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun HtmlPreview(html: String, modifier: Modifier = Modifier) {
    val openInBrowser = LocalOpenInBrowser.current
    var shown by remember { mutableStateOf(html) }
    // Reloads a moment after typing stops.
    LaunchedEffect(html) {
        delay(400)
        shown = html
    }
    AndroidView(
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.domStorageEnabled = false
                settings.mediaPlaybackRequiresUserGesture = false
                setBackgroundColor(android.graphics.Color.WHITE)
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        val url = request.url.toString()
                        if (url.startsWith("http://") || url.startsWith("https://")) openInBrowser(url)
                        return true
                    }
                }
            }
        },
        update = { view -> view.loadDataWithBaseURL("https://workspace-preview.invalid/", WebAudio.withAudioUnlock(shown), "text/html", "utf-8", null) },
        onRelease = { it.destroy() },
        modifier = modifier.background(Color.White),
    )
}
