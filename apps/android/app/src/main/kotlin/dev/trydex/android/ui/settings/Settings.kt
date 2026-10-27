package dev.trydex.android.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextObfuscationMode
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.RemoveModerator
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.Vibration
import androidx.compose.material.icons.outlined.VpnKey
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedSecureTextField
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.data.SignedOutReason
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.LocalOpenInBrowser
import dev.trydex.android.ui.chat.ModelPicker
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.InfoTip
import dev.trydex.android.ui.components.PageColumn
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.SectionCard
import dev.trydex.android.ui.components.UserAvatar
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.components.rememberConfirm
import dev.trydex.android.ui.nav.Access
import dev.trydex.android.ui.nav.GeneralSettings
import dev.trydex.android.ui.nav.NotificationSettings
import dev.trydex.android.ui.nav.Route
import dev.trydex.android.ui.nav.Secrets
import dev.trydex.android.ui.nav.Tab
import dev.trydex.android.ui.nav.Usage
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.ChatGPTSignInStart
import dev.trydex.core.model.ConnectResult
import dev.trydex.core.model.ProviderStatus
import dev.trydex.core.model.ScheduledPrompt
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Pending requests from chats that still wait for an answer (an hour at most). */
fun waitingCount(state: dev.trydex.core.model.DexState?, now: Long = System.currentTimeMillis()): Int =
    state?.access?.pending?.count { it.status == "pending" && now - it.createdAt < 3_600_000 } ?: 0

/** A row of a list in a card: icon, label, an optional line under it, and a control on the right. */
@Composable
fun SettingRow(
    label: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    detail: String? = null,
    info: String? = null,
    leading: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    ListItem(
        headlineContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (info != null) InfoTip(info, "About $label")
            }
        },
        supportingContent = detail?.let { { Text(it) } },
        leadingContent = leading ?: icon?.let { { Icon(it, contentDescription = null) } },
        trailingContent = trailing,
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = modifier.then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
    )
}

/** Settings' hub: a list of pages, with what needs attention marked. */
@Composable
fun SettingsHomeScreen() {
    val app = LocalApp.current
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val session by app.graph.repository.session.collectAsStateWithLifecycle()
    val selected = app.navigator.stack(Tab.Settings).getOrNull(1)
    val waiting = waitingCount(state)
    val providerMissing = state?.let { !it.anyProviderConnected } == true
    PaneScaffold(title = "Settings", back = false, modifier = Modifier.testTag("settings-home")) { padding ->
        PageColumn(padding) {
            session?.user?.let { user ->
                Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerLow) {
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        UserAvatar(user.name, user.avatarUrl, size = 48.dp)
                        Column(Modifier.weight(1f)) {
                            Text(user.name, style = MaterialTheme.typography.titleMedium)
                            Text("@${user.login} · ${session?.serverUrl?.host}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            SectionCard(contentPadding = false) {
                HubRow(Icons.Outlined.Tune, "General", "Providers, GitHub, defaults, account", GeneralSettings, selected, attention = providerMissing)
                HubRow(Icons.Outlined.Notifications, "Notifications", "What this device tells you about", NotificationSettings, selected)
                HubRow(Icons.Outlined.Lock, "Secrets", "API keys VMs get as environment variables", Secrets, selected)
                HubRow(Icons.Outlined.BarChart, "Usage", "Tokens, cost, and VM time", Usage, selected)
                HubRow(Icons.Outlined.VpnKey, "Access & API", "MCP tokens, confirmations, and activity", Access, selected, badge = waiting)
            }
        }
    }
}

@Composable
private fun HubRow(icon: ImageVector, label: String, detail: String, route: Route, selected: Any?, attention: Boolean = false, badge: Int = 0) {
    val app = LocalApp.current
    val on = selected == route
    ListItem(
        headlineContent = { Text(label) },
        supportingContent = { Text(detail) },
        leadingContent = {
            BadgedBox(badge = {
                when {
                    badge > 0 -> Badge(containerColor = DexTheme.colors.warning) { Text("$badge") }
                    attention -> Badge(containerColor = DexTheme.colors.warning)
                }
            }) { Icon(icon, contentDescription = null) }
        },
        trailingContent = { Icon(Icons.Rounded.ChevronRight, contentDescription = null) },
        colors = ListItemDefaults.colors(containerColor = if (on) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent),
        modifier = Modifier.testTag("settings-$label")
            .semantics { if (badge > 0) contentDescription = "$label, $badge waiting for your confirmation" }
            .clickable { app.navigator.open(route) },
    )
}

/**
 * General settings: this device, the model providers, cloud VMs, GitHub, defaults for new chats, scheduled prompts,
 * and the account.
 */
@Composable
fun GeneralSettingsScreen() {
    val app = LocalApp.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val prefs by app.graph.preferences.prefs.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val haptics = haptics()
    PaneScaffold(title = "General", modifier = Modifier.testTag("general-settings")) { padding ->
        PageColumn(padding) {
            val current = state
            if (current == null) {
                BoneRows(10)
                return@PageColumn
            }
            SectionCard(title = "This device", contentPadding = false) {
                SettingRow("Haptic feedback", icon = Icons.Outlined.Vibration, info = "A light tap when you press buttons. Saved on this device.", trailing = {
                    Switch(checked = prefs.haptics, onCheckedChange = { app.graph.preferences.setHaptics(it); if (it) haptics.toggle(true) }, modifier = Modifier.semantics { contentDescription = "Haptic feedback" })
                })
                if (android.os.Build.VERSION.SDK_INT >= 31) {
                    SettingRow("Colours from your wallpaper", icon = Icons.Outlined.Palette, info = "Material You: Dex takes its colours from your wallpaper. Off: Dex's own emerald.", trailing = {
                        Switch(checked = prefs.dynamicColor, onCheckedChange = { app.graph.preferences.setDynamicColor(it) }, modifier = Modifier.semantics { contentDescription = "Colours from your wallpaper" })
                    })
                }
            }
            SectionCard(title = "ClinePass", info = "Models marked Cline in the model menu run on your ClinePass subscription.") {
                val user = current.cline.source == "user"
                SecretConnect(
                    connected = current.cline.connected,
                    status = if (user) current.cline.keyHint ?: "" else "Shared deployment key",
                    monospace = user,
                    placeholder = if (user) "New Cline API key" else "Cline API key",
                    help = "Generate a key at app.cline.bot → Settings → API Keys. Needs a ClinePass subscription. Dex checks the key with Cline, then stores it encrypted in your agent; it's never sent to this device.",
                    helpLink = "https://app.cline.bot" to "app.cline.bot",
                    onConnect = { repository.api.connectCline(it) },
                    onDisconnect = if (user) ({ repository.api.disconnectCline(); ConnectResult(ok = true) }) else null,
                    tag = "cline",
                )
            }
            SectionCard(title = "OpenCode Go", info = "Models marked OpenCode in the model menu run on your OpenCode Go subscription.") {
                val user = current.opencode.source == "user"
                SecretConnect(
                    connected = current.opencode.connected,
                    status = if (user) current.opencode.keyHint ?: "" else "This deployment's account",
                    monospace = user,
                    placeholder = if (user) "New OpenCode API key" else "OpenCode API key",
                    help = "Copy your key from the OpenCode console. Needs an OpenCode Go subscription. Dex checks the key with OpenCode, then stores it encrypted in your agent; it's never sent to this device.",
                    helpLink = "https://opencode.ai/auth" to "OpenCode console",
                    onConnect = { repository.api.connectOpenCode(it) },
                    onDisconnect = if (user) ({ repository.api.disconnectOpenCode(); ConnectResult(ok = true) }) else null,
                    tag = "opencode",
                )
            }
            SectionCard(title = "ChatGPT", info = "Models marked ChatGPT in the model menu run on your ChatGPT Plus or Pro plan. Connect any or all of these.") {
                ChatGPTConnect(current.chatgpt)
            }
            SectionCard(title = "Cloud VMs", info = "Chats run code, browsers, and servers on VMs in your boat.dev account.") {
                val user = current.boat.source == "user"
                SecretConnect(
                    connected = current.boat.connected,
                    status = if (user) current.boat.keyHint ?: "" else "This deployment's account",
                    monospace = user,
                    placeholder = if (user) "New boat.dev API key" else "boat.dev API key",
                    help = "Create an API key in your boat.dev account. Chats' VMs run on this account, so boat.dev bills it for the time they run (they stop after a few idle minutes). To switch accounts, delete your VMs first: they live in the account that made them.",
                    helpLink = "https://boat.dev" to "boat.dev",
                    onConnect = { repository.api.connectBoat(it).copy(note = null) },
                    onDisconnect = if (user) ({ repository.api.disconnectBoat() }) else null,
                    tag = "boat",
                )
            }
            SectionCard(title = "GitHub", info = "Lets chats' VMs clone private repos, push branches, and open pull requests.") { GitHubConnect() }
            SectionCard(title = "New chats", info = "Defaults for chats you start. Each chat can change its model and thinking level.") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ModelPicker(current.settings.defaultModel, current.settings.defaultThinking, onChange = { model, thinking ->
                        scope.launch {
                            runCatching {
                                repository.api.updateSettings(buildJsonObject {
                                    put("defaultModel", model)
                                    put("defaultThinking", thinking.id)
                                })
                            }
                        }
                    })
                }
                Instructions(current.settings.instructions)
            }
            SectionCard(title = "Scheduled prompts", info = "Things Dex will do later. Ask Dex in any chat to schedule something.") { ScheduledPrompts() }
            SectionCard(contentPadding = false) { Account() }
        }
    }
}

/** A key that connects a provider: its status, and a form to add, replace, or remove it. */
@Composable
fun SecretConnect(
    connected: Boolean,
    status: String,
    placeholder: String,
    help: String,
    onConnect: suspend (String) -> ConnectResult,
    onDisconnect: (suspend () -> ConnectResult)?,
    tag: String,
    monospace: Boolean = false,
    helpLink: Pair<String, String>? = null,
    footer: (@Composable () -> Unit)? = null,
) {
    val openInBrowser = LocalOpenInBrowser.current
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<Boolean, String>?>(null) }
    val value = rememberTextFieldState()
    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.testTag("connect-$tag")) {
        if (connected) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = DexTheme.colors.success, modifier = Modifier.size(20.dp))
                Text(status, color = DexTheme.colors.success, fontFamily = if (monospace) FontFamily.Monospace else null, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (!editing) TextButton(onClick = { editing = true }) { Text("Replace") }
                if (onDisconnect != null) TextButton(onClick = {
                    message = null
                    scope.launch {
                        runCatching { onDisconnect() }
                            .onSuccess { if (!it.ok) message = false to (it.error ?: "That didn't work.") }
                            .onFailure { message = false to (it.message ?: "That didn't work.") }
                    }
                }) { Text("Disconnect") }
            }
        }
        if (!connected || editing) {
            Text(help, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            helpLink?.let { (url, label) ->
                TextButton(onClick = { openInBrowser(url) }, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 0.dp)) { Text("Open $label ↗") }
            }
            OutlinedSecureTextField(
                state = value,
                placeholder = { Text(placeholder) },
                leadingIcon = { Icon(Icons.Outlined.Key, contentDescription = null) },
                textObfuscationMode = TextObfuscationMode.RevealLastTyped,
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth().testTag("connect-$tag-key"),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = {
                    busy = true
                    message = null
                    scope.launch {
                        runCatching { onConnect(value.text.toString()) }
                            .onSuccess { result ->
                                if (result.ok) {
                                    value.setTextAndPlaceCursorAtEnd("")
                                    editing = false
                                    result.note?.let { message = true to it }
                                } else message = false to (result.error ?: "That didn't work.")
                            }
                            .onFailure { message = false to (it.message ?: "That didn't work.") }
                        busy = false
                    }
                }, enabled = value.text.isNotBlank() && !busy, modifier = Modifier.testTag("connect-$tag-submit")) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                        Text("Checking", modifier = Modifier.padding(start = 8.dp))
                    } else Text("Connect")
                }
                if (editing) TextButton(onClick = { editing = false }) { Text("Cancel") }
            }
        }
        footer?.invoke()
        message?.let { (ok, text) -> Text(text, style = MaterialTheme.typography.bodySmall, color = if (ok) DexTheme.colors.success else MaterialTheme.colorScheme.error) }
    }
}

/**
 * ChatGPT: Sign in with ChatGPT, so its models run on the user's Plus or Pro plan (chatgpt-connect.tsx on the web).
 * OpenAI only sends the browser back to a 127.0.0.1 address, which doesn't load; the user pastes that address here.
 * It opens in the full browser rather than a Custom Tab, whose address is harder to copy.
 */
@Composable
private fun ChatGPTConnect(status: ProviderStatus) {
    val app = LocalApp.current
    val api = app.graph.repository.api
    val uriHandler = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    var signIn by remember { mutableStateOf<ChatGPTSignInStart?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<Boolean, String>?>(null) }
    val callback = rememberTextFieldState()

    fun start() {
        busy = true
        message = null
        scope.launch {
            runCatching { api.startChatGPTSignIn() }
                .onSuccess { started ->
                    callback.setTextAndPlaceCursorAtEnd("")
                    signIn = started
                    runCatching { uriHandler.openUri(started.url) }
                }
                .onFailure { message = false to (it.message ?: "That didn't work.") }
            busy = false
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.testTag("connect-chatgpt")) {
        if (status.connected) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = DexTheme.colors.success, modifier = Modifier.size(20.dp))
                Text(status.keyHint ?: "Signed in", color = DexTheme.colors.success, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (signIn == null) TextButton(onClick = { start() }, enabled = !busy) { Text("Sign in again") }
                TextButton(onClick = {
                    signIn = null
                    message = null
                    scope.launch { runCatching { api.disconnectChatGPT() }.onFailure { message = false to (it.message ?: "That didn't work.") } }
                }) { Text("Disconnect") }
            }
        }
        val pending = signIn
        if (!status.connected && pending == null) {
            Text(
                "Use your ChatGPT Plus or Pro plan for GPT models, through OpenAI's Sign in with ChatGPT. Plus plans share their 5-hour limit with every app signed in this way. Dex stores the tokens encrypted in your agent; they're never sent to this device.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(onClick = { start() }, enabled = !busy, modifier = Modifier.testTag("connect-chatgpt-start")) {
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                Text("Sign in with ChatGPT", modifier = if (busy) Modifier.padding(start = 8.dp) else Modifier)
            }
        }
        if (pending != null) {
            Text(
                "Approve Dex on the ChatGPT page that opened in your browser. It then shows a page that can't be reached, at an address starting with ${pending.redirectUri}. That's expected: copy the whole address and paste it here.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextButton(onClick = { runCatching { uriHandler.openUri(pending.url) } }, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 0.dp)) {
                Text("Open the ChatGPT sign-in page ↗")
            }
            OutlinedTextField(
                state = callback,
                placeholder = { Text("${pending.redirectUri}?code=…") },
                leadingIcon = { Icon(Icons.Outlined.Link, contentDescription = null) },
                lineLimits = TextFieldLineLimits.SingleLine,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth().testTag("connect-chatgpt-callback"),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = {
                    busy = true
                    message = null
                    scope.launch {
                        runCatching { api.finishChatGPTSignIn(callback.text.toString()) }
                            .onSuccess { result ->
                                if (result.ok) {
                                    signIn = null
                                    callback.setTextAndPlaceCursorAtEnd("")
                                    message = true to "Signed in. ChatGPT's models are in the model menu."
                                } else message = false to (result.error ?: "That didn't work.")
                            }
                            .onFailure { message = false to (it.message ?: "That didn't work.") }
                        busy = false
                    }
                }, enabled = callback.text.isNotBlank() && !busy, modifier = Modifier.testTag("connect-chatgpt-submit")) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                        Text("Checking", modifier = Modifier.padding(start = 8.dp))
                    } else Text("Connect")
                }
                TextButton(onClick = { signIn = null; message = null }) { Text("Cancel") }
            }
        }
        message?.let { (ok, text) -> Text(text, style = MaterialTheme.typography.bodySmall, color = if (ok) DexTheme.colors.success else MaterialTheme.colorScheme.error) }
    }
}

/**
 * GitHub: connect with GitHub's sign-in (in a Custom Tab, which has the Dex session from signing in to this app) or
 * a fine-grained token. The outcome arrives with the synced state.
 */
@Composable
private fun GitHubConnect() {
    val app = LocalApp.current
    val repository = app.graph.repository
    val openInBrowser = LocalOpenInBrowser.current
    val state by repository.state.collectAsStateWithLifecycle()
    val github = state?.github ?: return
    val oauth = github.oauthAvailable
    var useToken by remember { mutableStateOf(false) }
    var waiting by remember { mutableStateOf(false) }
    val server = repository.session.value?.serverUrl
    val connectUrl = server?.resolve("/auth/github/connect")?.toString()
    val scope = rememberCoroutineScope()
    // The Custom Tab ends on the web's settings page; the state says how it went.
    var connectedMessage by remember { mutableStateOf(false) }
    LaunchedEffect(github.connected) {
        if (waiting && github.connected) {
            connectedMessage = true
            waiting = false
        }
    }
    val message: @Composable () -> Unit = {
        if (connectedMessage) Text("GitHub is connected. New VMs sign in with it. You can close the browser tab.", style = MaterialTheme.typography.bodySmall, color = DexTheme.colors.success)
    }
    when {
        !oauth || useToken || (github.connected && github.via == "token") -> SecretConnect(
            connected = github.connected,
            status = "@${github.login}" + (if (github.via == "token") " · token" else "") + (if (github.expired) " · GitHub stopped accepting it: replace it" else ""),
            placeholder = "github_pat_…",
            help = "Create a fine-grained token with Contents and Pull requests set to Read and write. New VMs sign the GitHub CLI and git in with it, so projects clone private repos and agents can push and open PRs. Anything on a VM can use it, so limit it to the repos Dex needs. Existing VMs pick up a new token after “Re-run setup”.",
            helpLink = "https://github.com/settings/personal-access-tokens/new" to "the token page",
            onConnect = { repository.api.connectGitHub(it).let { r -> r.copy(note = null) } },
            onDisconnect = { repository.api.disconnectGitHub(); ConnectResult(ok = true) },
            tag = "github",
            footer = {
                if (oauth && !github.connected) TextButton(onClick = { useToken = false }) { Text("Connect with GitHub instead") }
                message()
            },
        )
        github.connected -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (github.expired) {
                dev.trydex.android.ui.components.Banner(
                    "GitHub stopped accepting this connection (revoked or expired). New VMs can't sign in and repo search shows public repos only until you reconnect.",
                    action = { TextButton(onClick = { connectUrl?.let { waiting = true; openInBrowser(it) } }) { Text("Reconnect") } },
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = DexTheme.colors.success, modifier = Modifier.size(20.dp))
                Column(Modifier.weight(1f)) {
                    Text("@${github.login}", style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("via GitHub", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = { connectUrl?.let { waiting = true; openInBrowser(it) } }) { Text("Reconnect") }
                TextButton(onClick = { scope.launch { runCatching { repository.api.disconnectGitHub() } } }) { Text("Disconnect") }
            }
            message()
        }
        else -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = { connectUrl?.let { waiting = true; openInBrowser(it) } }, modifier = Modifier.testTag("connect-github-oauth")) { Text("Connect with GitHub") }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Gives chats' VMs access to your repos (clone, push, pull requests).", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                InfoTip("GitHub asks you to approve repo and workflow access for Dex. The token is stored encrypted in your agent; new VMs sign the GitHub CLI and git in with it. It can reach every repo you can, so for access limited to chosen repos, use a fine-grained token instead. Disconnecting revokes it at GitHub.", "About GitHub access")
            }
            TextButton(onClick = { useToken = true }) { Text("Use a fine-grained token instead") }
            message()
        }
    }
}

@Composable
private fun Instructions(saved: String) {
    val app = LocalApp.current
    val scope = rememberCoroutineScope()
    val text = rememberTextFieldState(saved)
    var done by remember { mutableStateOf(false) }
    LaunchedEffect(saved) { if (text.text.toString() != saved) text.setTextAndPlaceCursorAtEnd(saved) }
    val changed = text.text.toString() != saved
    LaunchedEffect(text.text) { if (changed) done = false }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Custom instructions", style = MaterialTheme.typography.labelLarge)
            InfoTip("Added to the system prompt of every chat.", "About Custom instructions")
        }
        OutlinedTextField(
            state = text,
            placeholder = { Text("e.g. I'm a TypeScript developer in Chicago. Be concise. Prefer tables for comparisons.") },
            lineLimits = TextFieldLineLimits.MultiLine(minHeightInLines = 5, maxHeightInLines = 12),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.fillMaxWidth().testTag("instructions"),
        )
        if (changed || done) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (changed) Button(onClick = {
                val value = text.text.toString()
                scope.launch {
                    runCatching { app.graph.repository.api.updateSettings(buildJsonObject { put("instructions", value) }) }
                        .onSuccess { done = true }
                }
            }, modifier = Modifier.testTag("save-instructions")) { Text("Save instructions") }
            if (done && !changed) {
                Icon(Icons.Rounded.Check, contentDescription = null, tint = DexTheme.colors.success)
                Text("Saved", color = DexTheme.colors.success)
            }
        }
    }
}

@Composable
private fun ScheduledPrompts() {
    val app = LocalApp.current
    val repository = app.graph.repository
    val connected by repository.connected.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<ScheduledPrompt>?>(null) }
    suspend fun reload() {
        runCatching { repository.api.listScheduledPrompts() }.onSuccess { items = it }
    }
    LaunchedEffect(connected) { if (connected) reload() }
    val list = items
    when {
        list == null -> BoneRows(2)
        list.isEmpty() -> Text("Nothing scheduled.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        else -> Column {
            list.forEach { prompt ->
                ListItem(
                    headlineContent = { Text(prompt.prompt) },
                    supportingContent = {
                        val at = runCatching { Instant.parse(prompt.`when`).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)) }.getOrDefault(prompt.`when`)
                        Text((prompt.cron?.let { "$it · next " } ?: "") + at)
                    },
                    leadingContent = { Icon(Icons.Outlined.Schedule, contentDescription = null) },
                    trailingContent = {
                        IconButton(onClick = { scope.launch { runCatching { repository.api.cancelScheduledPrompt(prompt.id) }; reload() } }) {
                            Icon(Icons.Outlined.DeleteOutline, contentDescription = "Cancel scheduled prompt")
                        }
                    },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    modifier = Modifier.testTag("scheduled-${prompt.id}"),
                )
            }
        }
    }
}

@Composable
private fun Account() {
    val app = LocalApp.current
    val repository = app.graph.repository
    val session by repository.session.collectAsStateWithLifecycle()
    val confirm = rememberConfirm()
    val scope = rememberCoroutineScope()
    val user = session?.user
    SettingRow(
        user?.name ?: "Account",
        detail = user?.let { "@${it.login}" },
        leading = { if (user != null) UserAvatar(user.name, user.avatarUrl, size = 32.dp) else Icon(Icons.Outlined.AccountCircle, contentDescription = null) },
        trailing = {
            OutlinedButton(onClick = { repository.signOut() }, modifier = Modifier.testTag("sign-out")) {
                Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("Sign out", modifier = Modifier.padding(start = 6.dp))
            }
        },
    )
    SettingRow(
        "Sign out everywhere",
        icon = Icons.Outlined.RemoveModerator,
        info = "Ends every session on every device, including this one. Use it if a device is lost or your password may have leaked.",
        trailing = {
            TextButton(onClick = {
                confirm.ask("Sign out of Dex on every device, including this one?", confirm = "Sign out all") {
                    scope.launch {
                        runCatching { repository.api.signOutEverywhere() }
                        repository.signOut(SignedOutReason.Everywhere)
                    }
                }
            }, modifier = Modifier.testTag("sign-out-everywhere")) { Text("Sign out all") }
        },
    )
}
