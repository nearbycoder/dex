package dev.trydex.android.ui.library

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Login
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Monitor
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.LocalOpenInBrowser
import dev.trydex.android.ui.chat.mcpStatusColor
import dev.trydex.android.ui.components.Banner
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.ConfirmState
import dev.trydex.android.ui.components.EmptyState
import dev.trydex.android.ui.components.ErrorText
import dev.trydex.android.ui.components.Hint
import dev.trydex.android.ui.components.InfoTip
import dev.trydex.android.ui.components.PageColumn
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.SectionCard
import dev.trydex.android.ui.components.StatusDot
import dev.trydex.android.ui.components.Tone
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.components.rememberConfirm
import dev.trydex.android.ui.machine.Dropdown
import dev.trydex.android.ui.nav.McpEditor
import dev.trydex.android.ui.nav.McpList
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.Catalogs
import dev.trydex.core.model.Format
import dev.trydex.core.model.MCP_VM
import dev.trydex.core.model.McpCheckReport
import dev.trydex.core.model.McpConnectResult
import dev.trydex.core.model.McpForms
import dev.trydex.core.model.McpServerInfo
import dev.trydex.core.model.McpStatus
import dev.trydex.core.model.RegistryServer
import dev.trydex.core.model.VmInfo
import dev.trydex.core.model.VmStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Locale

private fun authIcon(auth: String): ImageVector? = when (auth) {
    "headers" -> Icons.Outlined.Key
    "oauth" -> Icons.Outlined.VerifiedUser
    else -> null
}

private fun authLabel(auth: String) = Catalogs.MCP_AUTH_LABEL[auth] ?: auth

/**
 * Servers sent to sign in from the app. The provider's page opens in a Custom Tab and the result only reaches the app
 * through synced state, so the list watches each one leave `authenticating` to say how it went (the web's
 * `?connected=` / `?error=` banner).
 */
internal object McpSignIns {
    class Outcome(val id: String, val error: String?)

    /** Server id → whether it has been seen waiting for the sign-in. */
    private val waiting = mutableStateMapOf<String, Boolean>()
    var outcome by mutableStateOf<Outcome?>(null)

    fun started(id: String, authenticating: Boolean) {
        waiting[id] = authenticating
        outcome = null
    }

    fun observe(servers: List<McpServerInfo>) {
        for ((id, seen) in waiting.toMap()) {
            val server = servers.firstOrNull { it.id == id }
            when {
                server == null -> waiting.remove(id)
                server.status == McpStatus.Authenticating -> if (!seen) waiting[id] = true
                !seen -> Unit
                server.status == McpStatus.Failed || (server.status == McpStatus.Disconnected && server.error != null) -> {
                    waiting.remove(id)
                    outcome = Outcome(id, server.error ?: "it didn't connect")
                }
                server.status == McpStatus.Disconnected -> Unit
                else -> {
                    waiting.remove(id)
                    outcome = Outcome(id, null)
                }
            }
        }
    }
}

/** An editor's error carried over to the server it created (saved, but it couldn't connect). */
private object McpEditorCarry {
    private val errors = mutableMapOf<String, String>()
    fun put(id: String, error: String) { errors[id] = error }
    fun take(id: String): String? = errors.remove(id)
}

/** Opens a connect result's sign-in page, if it has one. */
private fun followConnect(result: McpConnectResult, fallbackId: String, server: McpServerInfo?, openInBrowser: (String) -> Unit): Boolean {
    val url = result.authUrl ?: return false
    if (!result.ok) return false
    McpSignIns.started(result.id ?: fallbackId, authenticating = server == null || server.status == McpStatus.Authenticating)
    openInBrowser(url)
    return true
}

/** The MCP servers: their status and tools, registry search, and popular servers to add. */
@Composable
fun McpListScreen() {
    val app = LocalApp.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val confirm = rememberConfirm()
    val servers = state?.mcp.orEmpty()
    LaunchedEffect(servers) { McpSignIns.observe(servers) }

    PaneScaffold(
        title = "MCP servers",
        actions = {
            InfoTip(
                "Remote tools for Dex. Each chat and agent picks the servers it uses; servers marked “On for new chats” attach to plain new chats.",
                "About mcp servers",
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { app.navigator.open(McpEditor("new")) },
                icon = { Icon(Icons.Rounded.Add, contentDescription = null) },
                text = { Text("Add server") },
                modifier = Modifier.testTag("mcp-add"),
            )
        },
        modifier = Modifier.testTag("mcp"),
    ) { padding ->
        PageColumn(padding) {
            McpSignIns.outcome?.let { outcome ->
                val name = servers.firstOrNull { it.id == outcome.id }?.name ?: "the server"
                Banner(
                    if (outcome.error != null) "Signing in to $name failed: ${outcome.error}" else "Signed in to $name. Its tools are loading.",
                    tone = if (outcome.error != null) Tone.Error else Tone.Success,
                    icon = if (outcome.error != null) Icons.Outlined.Cancel else Icons.Rounded.Check,
                    action = {
                        IconButton(onClick = { McpSignIns.outcome = null }, modifier = Modifier.size(32.dp)) {
                            Icon(Icons.Rounded.Close, contentDescription = "Dismiss", modifier = Modifier.size(18.dp))
                        }
                    },
                    modifier = Modifier.testTag("mcp-banner"),
                )
            }

            RegistrySearch(servers)

            val current = state
            when {
                current == null -> BoneRows(3)
                servers.isEmpty() -> EmptyNote("No MCP servers yet. Add one below or by URL.")
                else -> {
                    val mcpVm = current.vm(MCP_VM)
                    Column(Modifier.testTag("mcp-list"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        servers.forEach { server -> key(server.id) { ServerCard(server, mcpVm, confirm) } }
                    }
                }
            }

            val unused = Catalogs.MCP_TEMPLATES.filter { template -> servers.none { it.url == template.url } }
            if (current != null && unused.isNotEmpty()) {
                ListHeading("Popular servers")
                BoxWithConstraints {
                    val columns = if (maxWidth >= 360.dp) 2 else 1
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        unused.chunked(columns).forEach { row ->
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                row.forEach { template ->
                                    OutlinedCard(
                                        onClick = { app.navigator.open(McpEditor("new", template = template.id)) },
                                        shape = RoundedCornerShape(20.dp),
                                        modifier = Modifier.weight(1f).testTag("mcp-template-${template.id}"),
                                    ) {
                                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                                                Text(template.name, style = MaterialTheme.typography.titleSmall)
                                                TagLabel(authLabel(template.auth), authIcon(template.auth))
                                            }
                                            Text(template.note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                    }
                                }
                                if (row.size < columns) Box(Modifier.weight(1f))
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(64.dp))
        }
    }
}

/** A saved server: status, sign-in, reconnect, "New chats", and its tools. */
@Composable
private fun ServerCard(server: McpServerInfo, mcpVm: VmInfo?, confirm: ConfirmState) {
    val app = LocalApp.current
    val api = app.graph.repository.api
    val openInBrowser = LocalOpenInBrowser.current
    val scope = rememberCoroutineScope()
    val haptics = haptics()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showTools by remember { mutableStateOf(false) }
    var defaultOn by remember(server.defaultOn) { mutableStateOf(server.defaultOn) }
    val status = server.status
    val asleep = server.local != null && status != McpStatus.Ready && status != McpStatus.Connecting && mcpVm?.status != VmStatus.Running
    val shown = if (asleep) McpStatus.Disconnected else status

    fun connect() {
        busy = true
        error = null
        scope.launch {
            try {
                val result = api.connectMcpServer(server.id)
                if (!result.ok) error = result.error
                followConnect(result, server.id, server, openInBrowser)
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Exception) {
                error = failure.message
            }
            busy = false
        }
    }

    Card(
        onClick = { app.navigator.open(McpEditor(server.id)) },
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        modifier = Modifier.fillMaxWidth().testTag("mcp-row-${server.id}"),
    ) {
        Row(Modifier.padding(start = 20.dp, top = 12.dp, end = 4.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                    Text(server.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (server.local != null) TagLabel("Runs on VM", Icons.Outlined.Monitor)
                    else TagLabel(authLabel(server.auth), authIcon(server.auth))
                }
                Text(
                    server.local?.command ?: server.url,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (status != McpStatus.Authenticating) {
                Hint("Reconnect") {
                    IconButton(onClick = ::connect, enabled = !busy, modifier = Modifier.testTag("mcp-reconnect-${server.id}")) {
                        SpinningIcon(Icons.Rounded.Refresh, busy, "Reconnect ${server.name}")
                    }
                }
            }
            Hint("Remove") {
                IconButton(onClick = {
                    confirm.ask("Remove “${server.name}”? Chats and agents using it lose its tools, and its sign-in is forgotten.", confirm = "Remove") {
                        scope.launch { runCatching { api.deleteMcpServer(server.id) }.onFailure { error = it.message } }
                    }
                }, modifier = Modifier.testTag("mcp-remove-${server.id}")) {
                    Icon(Icons.Outlined.DeleteOutline, contentDescription = "Remove ${server.name}")
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 16.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusDot(mcpStatusColor(shown, DexTheme.colors, MaterialTheme.colorScheme), pulsing = shown.pending, label = shown.label)
            Text(
                if (asleep) "Starts when a chat uses it" else status.label,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text("New chats", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Switch(
                checked = defaultOn,
                onCheckedChange = { on ->
                    haptics.toggle(on)
                    defaultOn = on
                    scope.launch { runCatching { api.setMcpServerDefault(server.id, on) }.onFailure { defaultOn = server.defaultOn; error = it.message } }
                },
                modifier = Modifier.semantics { contentDescription = "Attach ${server.name} to new chats" }.testTag("mcp-default-${server.id}"),
            )
        }
        if (status == McpStatus.Authenticating) {
            Button(onClick = ::connect, enabled = !busy, contentPadding = ButtonDefaults.SmallContentPadding, modifier = Modifier.padding(start = 20.dp, top = 4.dp).testTag("mcp-signin-${server.id}")) {
                if (busy) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                else Icon(Icons.AutoMirrored.Outlined.Login, contentDescription = null, modifier = Modifier.size(16.dp))
                Text("Sign in", modifier = Modifier.padding(start = 6.dp))
            }
        }
        val problem = error ?: if (asleep) null else server.error
        if (problem != null && status != McpStatus.Ready) {
            Text(problem, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
        }
        if (server.tools.isNotEmpty()) {
            val chevron by animateFloatAsState(if (showTools) 90f else 0f, label = "tools")
            Row(
                Modifier.fillMaxWidth().clickable { showTools = !showTools }.padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon(Icons.Rounded.ChevronRight, contentDescription = null, modifier = Modifier.size(18.dp).rotate(chevron), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                val count = server.tools.size
                Text("$count tool${if (count == 1) "" else "s"}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(" · ${server.prefix}__…", style = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace), color = MaterialTheme.colorScheme.outline, maxLines = 1)
            }
            AnimatedVisibility(showTools) {
                Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    server.tools.forEach { tool ->
                        Column {
                            Text(tool.name, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), color = MaterialTheme.colorScheme.onSurface)
                            if (tool.description.isNotBlank()) {
                                Text(tool.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        } else {
            Spacer(Modifier.height(12.dp))
        }
    }
}

/** Finds remote servers on Smithery or the official MCP Registry, checks one, and adds it. */
@Composable
private fun RegistrySearch(servers: List<McpServerInfo>) {
    val api = LocalApp.current.graph.repository.api
    var query by rememberSaveable { mutableStateOf("") }
    var source by rememberSaveable { mutableStateOf("smithery") }
    val search = rememberDebouncedSearch(query, if (source == "registry") 450 else 250, source) { q -> api.searchMcpRegistry(q, source) }
    val q = query.trim()
    val addedUrls = remember(servers) { McpForms.addedUrls(servers) }

    LibrarySearchField(query, { query = it }, "Search for an MCP server", search.loading && q.length >= 2, "mcp-search")
    if (q.length < 2) return

    val sources = listOf("smithery" to "Smithery", "registry" to "Official registry")
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        sources.forEachIndexed { index, (id, label) ->
            SegmentedButton(
                selected = source == id,
                onClick = { source = id },
                shape = SegmentedButtonDefaults.itemShape(index, sources.size),
                modifier = Modifier.testTag("mcp-source-$id"),
            ) { Text(label) }
        }
    }
    val error = search.error
    when {
        error != null -> ErrorText(error)
        search.results.isNotEmpty() -> {
            SectionCard(contentPadding = false, modifier = Modifier.testTag("mcp-results")) {
                Column {
                    search.results.forEachIndexed { index, server ->
                        if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        key(server.source, server.name) { RegistryRow(server, addedUrls) }
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(horizontal = 4.dp)) {
                Icon(Icons.Outlined.VerifiedUser, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.outline)
                Text(
                    if (source == "smithery") "Smithery hosts these: you sign in through Smithery and requests pass through it. The official registry has publishers' own endpoints."
                    else "The registry verifies who published a server, not the server itself: open one to check it.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        search.loading -> if (source == "registry") {
            Text("Searching… the official registry can take a while for a new search.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp))
        }
        search.query == q -> Text("No remote servers named like “$q”.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp))
    }
}

/** A registry result: opens to check it (handshake, sign-in, tools, source), then adds it. */
@Composable
private fun RegistryRow(server: RegistryServer, addedUrls: Set<String>) {
    val app = LocalApp.current
    val api = app.graph.repository.api
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var report by remember { mutableStateOf<McpCheckReport?>(null) }
    var checking by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val view = McpForms.registryView(server, report, addedUrls)
    val chevron by animateFloatAsState(if (open) 90f else 0f, label = "chevron")

    fun toggle() {
        open = !open
        if (open && report == null && !checking) {
            checking = true
            error = null
            scope.launch {
                runCatching { api.checkMcpServer(server) }.onSuccess { report = it }.onFailure { error = it.message }
                checking = false
            }
        }
    }

    Column(Modifier.fillMaxWidth().testTag("mcp-result-${server.name}")) {
        Row(
            Modifier.fillMaxWidth().clickable(onClickLabel = if (open) "Hide details" else "Check it", onClick = ::toggle).padding(horizontal = 12.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(20.dp).rotate(chevron))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                    Text(server.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (server.verified == true) Icon(Icons.Outlined.VerifiedUser, contentDescription = "Verified by Smithery", tint = DexTheme.colors.success, modifier = Modifier.size(14.dp))
                    if (view.needsKey) TagLabel("API key")
                    if (server.transport == "sse") TagLabel("SSE")
                    if (server.transport == "stdio") TagLabel("Runs on VM")
                    if (server.templated) TagLabel("Needs setup")
                }
                Text(server.name, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 11.sp), color = MaterialTheme.colorScheme.outline, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            val uses = server.uses
            when {
                view.added -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(Icons.Rounded.Check, contentDescription = null, tint = DexTheme.colors.success, modifier = Modifier.size(16.dp))
                    Text("Added", style = MaterialTheme.typography.labelLarge, color = DexTheme.colors.success)
                }
                uses != null -> Hint("${NumberFormat.getIntegerInstance(Locale.US).format(uses)} people use it on Smithery") {
                    Text("${Format.installs(uses)} uses", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        AnimatedVisibility(open) {
            Column(Modifier.fillMaxWidth().padding(start = 40.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (server.description.isNotBlank()) Text(server.description, style = MaterialTheme.typography.bodyMedium)
                if (view.url.isNotEmpty()) {
                    Text(view.url, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 11.sp), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                val checked = report
                val failure = error
                when {
                    checking -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Text("Checking it: connecting, reading its sign-in and tools, looking at its source…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    failure != null -> ErrorText(failure)
                    checked != null -> CheckReport(checked)
                }
                if (checked != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        val run = server.run
                        if (run != null) {
                            Button(onClick = {
                                app.navigator.open(McpEditor("new", name = server.title, command = run.command, env = run.env.joinToString(",") { it.name }.ifEmpty { null }))
                            }, modifier = Modifier.testTag("mcp-add-vm")) {
                                Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                                Text("Add to run on a VM", modifier = Modifier.padding(start = 6.dp))
                            }
                        }
                        if (view.url.isNotEmpty() && !view.added) {
                            val add = { app.navigator.open(McpEditor("new", name = server.title, url = view.url, auth = view.auth, header = view.header)) }
                            if (view.failed) OutlinedButton(onClick = add, modifier = Modifier.testTag("mcp-add-anyway")) {
                                Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                                Text("Add anyway", modifier = Modifier.padding(start = 6.dp))
                            } else Button(onClick = add, modifier = Modifier.testTag("mcp-add-server")) {
                                Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                                Text("Add server", modifier = Modifier.padding(start = 6.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

/** What checking a server found: one line per check, then its tools. */
@Composable
private fun CheckReport(report: McpCheckReport) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        report.checks.forEach { check ->
            val (icon, tint) = when (check.status) {
                "pass" -> Icons.Rounded.Check to DexTheme.colors.success
                "warn" -> Icons.Outlined.WarningAmber to DexTheme.colors.warning
                "fail" -> Icons.Outlined.Cancel to MaterialTheme.colorScheme.error
                else -> Icons.Outlined.Info to MaterialTheme.colorScheme.outline
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                Icon(icon, contentDescription = check.status, tint = tint, modifier = Modifier.padding(top = 1.dp).size(16.dp))
                Text(
                    "${check.label} · ${check.detail}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (report.tools.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                report.tools.take(16).forEach { tool ->
                    Text(
                        tool,
                        style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                        modifier = Modifier
                            .background(MaterialTheme.colorScheme.surfaceContainerHighest, RoundedCornerShape(6.dp))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
                if (report.tools.size > 16) Text("+${report.tools.size - 16} more", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
            }
        }
    }
}

/** Adds a server (`id` "new", maybe prefilled) or edits one: remote URL or a command on the MCP VM, auth, and headers. */
@Composable
fun McpEditorScreen(route: McpEditor) {
    val app = LocalApp.current
    val repository = app.graph.repository
    val api = repository.api
    val state by repository.state.collectAsStateWithLifecycle()
    val openInBrowser = LocalOpenInBrowser.current
    val scope = rememberCoroutineScope()
    val confirm = rememberConfirm()
    val haptics = haptics()
    val isNew = route.id == "new"
    val prefill = remember(route) { McpForms.prefill(route.template, route.name, route.url, route.auth, route.header, route.command, route.env) }
    val server = state?.mcpServer(route.id)

    var draft by remember(route) { mutableStateOf(if (isNew) McpForms.newDraft(prefill) else null) }
    var saving by remember(route) { mutableStateOf(false) }
    var removing by remember(route) { mutableStateOf(false) }
    var error by remember(route) { mutableStateOf(McpEditorCarry.take(route.id)) }
    var advanced by remember(route) { mutableStateOf(false) }
    LaunchedEffect(route, server != null) {
        if (draft == null && server != null) draft = McpForms.draft(server)
    }

    val current = state
    val editing = draft
    if (current == null || (!isNew && server == null) || editing == null) {
        PaneScaffold(title = if (isNew) "Add MCP server" else server?.name ?: "MCP server") { padding ->
            PageColumn(padding) {
                if (current != null && !isNew && server == null && !removing) {
                    EmptyState("This server no longer exists.", action = {
                        TextButton(onClick = { app.navigator.open(McpList) }) { Text("Back to MCP servers") }
                    })
                } else if (current == null || editing == null) {
                    BoneRows(5)
                }
            }
        }
        return
    }

    fun update(block: (McpForms.Draft) -> McpForms.Draft) {
        draft = draft?.let(block)
    }

    fun save() {
        saving = true
        error = null
        scope.launch {
            try {
                val result = api.saveMcpServer(McpForms.payload(editing))
                when {
                    !result.ok -> {
                        val message = result.error ?: "Couldn't save the server."
                        error = message
                        haptics.reject()
                        val created = result.id
                        if (isNew && created != null) {
                            McpEditorCarry.put(created, message)
                            app.navigator.replace(McpEditor(created))
                        }
                    }
                    followConnect(result, route.id, server, openInBrowser) -> app.navigator.open(McpList)
                    else -> {
                        haptics.confirm()
                        app.navigator.open(McpList)
                    }
                }
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Exception) {
                error = failure.message
                haptics.reject()
            }
            saving = false
        }
    }

    val headerPlaceholder = prefill.template?.headerPlaceholder ?: "Bearer sk-…"
    PaneScaffold(
        title = if (isNew) "Add MCP server" else editing.name.ifBlank { "MCP server" },
        bottomBar = {
            EditorSaveBar {
                Button(onClick = ::save, enabled = !saving && !removing && editing.canSave, modifier = Modifier.testTag("mcp-save")) {
                    if (saving) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(McpForms.submitLabel(editing, isNew, server?.status, saving))
                }
                Spacer(Modifier.weight(1f))
                if (!isNew) {
                    TextButton(
                        onClick = {
                            confirm.ask("Remove “${editing.name}”? Chats and agents using it lose its tools.", confirm = "Remove") {
                                removing = true
                                scope.launch {
                                    runCatching { api.deleteMcpServer(route.id) }
                                        .onSuccess { app.navigator.open(McpList) }
                                        .onFailure { error = it.message; removing = false }
                                }
                            }
                        },
                        enabled = !saving && !removing,
                        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        modifier = Modifier.testTag("mcp-remove"),
                    ) {
                        Icon(Icons.Outlined.DeleteOutline, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Remove", modifier = Modifier.padding(start = 6.dp))
                    }
                }
            }
        },
        modifier = Modifier.testTag("mcp-editor"),
    ) { padding ->
        PageColumn(padding) {
            if (server != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(horizontal = 4.dp)) {
                    StatusDot(mcpStatusColor(server.status, DexTheme.colors, MaterialTheme.colorScheme), pulsing = server.status.pending, label = server.status.label)
                    Text(
                        server.status.label + if (server.status == McpStatus.Ready) " · ${server.tools.size} tools" else "",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            val kinds = listOf(false to "Remote URL", true to "Run on a VM")
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                kinds.forEachIndexed { index, (local, label) ->
                    SegmentedButton(
                        selected = editing.local == local,
                        onClick = { update { it.copy(local = local) } },
                        shape = SegmentedButtonDefaults.itemShape(index, kinds.size),
                        modifier = Modifier.testTag(if (local) "mcp-kind-local" else "mcp-kind-remote"),
                    ) { Text(label) }
                }
            }

            SectionCard {
                FieldHeading("Name")
                OutlinedTextField(
                    value = editing.name,
                    onValueChange = { value -> update { it.copy(name = value.take(60)) } },
                    singleLine = true,
                    placeholder = { Text("GitHub") },
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().testTag("mcp-name"),
                )
                if (!editing.local) {
                    FieldHeading("URL")
                    OutlinedTextField(
                        value = editing.url,
                        onValueChange = { value -> update { it.copy(url = value.trim()) } },
                        singleLine = true,
                        placeholder = { Text("https://example.com/mcp", fontFamily = FontFamily.Monospace) },
                        textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().testTag("mcp-url"),
                    )
                }
            }

            if (editing.local) {
                if (prefill.command != null && isNew) {
                    Banner(
                        "This command was filled in for you. Check it before saving: it runs on your MCP VM, with the variables you give it.",
                        tone = Tone.Warning,
                        icon = Icons.Outlined.WarningAmber,
                    )
                }
                SectionCard {
                    FieldHeading(
                        "Command",
                        hint = "Starts a stdio MCP server, e.g. npx -y <package>, uvx <package>, or docker run -i <image>. Dex runs it on its MCP VM behind a bridge to HTTP and connects to it; the VM stops when idle and starts again when a chat needs it.",
                    )
                    if (!current.vmConfigured) {
                        Text("Needs a boat.dev account: connect one in Settings → Cloud VMs.", style = MaterialTheme.typography.bodySmall, color = DexTheme.colors.warning)
                    }
                    OutlinedTextField(
                        value = editing.command,
                        onValueChange = { value -> update { it.copy(command = value.replace("\n", " ").replace("\r", "")) } },
                        placeholder = { Text("npx -y @modelcontextprotocol/server-everything", fontFamily = FontFamily.Monospace) },
                        textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().testTag("mcp-command"),
                    )
                }
                SectionCard {
                    FieldHeading(
                        "Environment",
                        hint = "Only the variables listed here reach the server. Values are encrypted and never shown again; leave one empty to keep its saved value, or to use the saved secret of the same name (Settings → Secrets).",
                    )
                    EntryRows(
                        entries = editing.env,
                        onChange = { env -> update { it.copy(env = env) } },
                        namePlaceholder = "API_KEY",
                        valuePlaceholder = "Value",
                        removeLabel = "Remove variable",
                        upperCase = true,
                        tag = "mcp-env",
                    )
                    TextButton(onClick = { update { it.copy(env = it.env + McpForms.Entry("")) } }, modifier = Modifier.testTag("mcp-add-env")) {
                        Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Add variable", modifier = Modifier.padding(start = 6.dp))
                    }
                }
            } else {
                SectionCard {
                    FieldHeading("Authentication", hint = Catalogs.MCP_AUTH_HINT[editing.auth])
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                        McpForms.AUTHS.forEachIndexed { index, auth ->
                            SegmentedButton(
                                selected = editing.auth == auth,
                                onClick = { update { it.copy(auth = auth) } },
                                shape = SegmentedButtonDefaults.itemShape(index, McpForms.AUTHS.size),
                                icon = {
                                    val icon = authIcon(auth)
                                    if (icon != null) Icon(icon, contentDescription = null, modifier = Modifier.size(SegmentedButtonDefaults.IconSize))
                                    else SegmentedButtonDefaults.Icon(editing.auth == auth)
                                },
                                modifier = Modifier.testTag("mcp-auth-$auth"),
                            ) { Text(authLabel(auth), maxLines = 1) }
                        }
                    }
                    if (editing.auth == "headers") {
                        FieldHeading("Headers", hint = "Values are encrypted and never shown again; leave a saved value empty to keep it.")
                        EntryRows(
                            entries = editing.headers,
                            onChange = { headers -> update { it.copy(headers = headers) } },
                            namePlaceholder = "Authorization",
                            valuePlaceholder = headerPlaceholder,
                            removeLabel = "Remove header",
                            upperCase = false,
                            tag = "mcp-header",
                        )
                        TextButton(onClick = { update { it.copy(headers = it.headers + McpForms.Entry("")) } }, modifier = Modifier.testTag("mcp-add-header")) {
                            Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                            Text("Add header", modifier = Modifier.padding(start = 6.dp))
                        }
                    }
                }
                SectionCard(contentPadding = false) {
                    val chevron by animateFloatAsState(if (advanced) 90f else 0f, label = "advanced")
                    Row(
                        Modifier.fillMaxWidth().clickable { advanced = !advanced }.padding(horizontal = 20.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(Icons.Rounded.ChevronRight, contentDescription = null, modifier = Modifier.size(20.dp).rotate(chevron), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("Advanced", style = MaterialTheme.typography.titleSmall)
                    }
                    AnimatedVisibility(advanced) {
                        Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            val transports = Catalogs.MCP_TRANSPORTS
                            Dropdown(
                                "Transport",
                                transports.firstOrNull { it.first == editing.transport }?.second ?: editing.transport,
                                transports.map { it.second },
                                modifier = Modifier.fillMaxWidth().testTag("mcp-transport"),
                            ) { index -> update { it.copy(transport = transports[index].first) } }
                            Text("Auto tries Streamable HTTP, then falls back to SSE.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }

            Row(
                Modifier.fillMaxWidth().clickable { update { it.copy(defaultOn = !it.defaultOn) } }.testTag("mcp-default"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(checked = editing.defaultOn, onCheckedChange = { on -> update { it.copy(defaultOn = on) } })
                Text("On for new chats", style = MaterialTheme.typography.bodyLarge)
                InfoTip("Attach it to new chats that don't use an agent. Agents choose their own servers.", "About on for new chats")
            }

            error?.let { ErrorText(it, Modifier.testTag("mcp-error")) }
        }
    }
}

/** Name and secret value rows (headers or environment variables); saved values show as dots. */
@Composable
private fun EntryRows(
    entries: List<McpForms.Entry>,
    onChange: (List<McpForms.Entry>) -> Unit,
    namePlaceholder: String,
    valuePlaceholder: String,
    removeLabel: String,
    upperCase: Boolean,
    tag: String,
) {
    entries.forEachIndexed { index, entry ->
        fun set(next: McpForms.Entry) = onChange(entries.toMutableList().also { it[index] = next })
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = entry.name,
                onValueChange = { set(entry.copy(name = it, saved = false)) },
                singleLine = true,
                placeholder = { Text(namePlaceholder, maxLines = 1) },
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                keyboardOptions = KeyboardOptions(
                    capitalization = if (upperCase) KeyboardCapitalization.Characters else KeyboardCapitalization.None,
                    autoCorrectEnabled = false,
                ),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.weight(0.4f).testTag("$tag-name-$index"),
            )
            OutlinedTextField(
                value = entry.value,
                onValueChange = { set(entry.copy(value = it)) },
                singleLine = true,
                placeholder = { Text(if (entry.saved) "•••••••• saved" else valuePlaceholder, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.weight(0.6f).testTag("$tag-value-$index"),
            )
            Hint(removeLabel) {
                IconButton(onClick = { onChange(entries.filterIndexed { i, _ -> i != index }) }) {
                    Icon(Icons.Rounded.Close, contentDescription = removeLabel)
                }
            }
        }
    }
}
