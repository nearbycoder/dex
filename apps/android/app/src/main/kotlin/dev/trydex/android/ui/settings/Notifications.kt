package dev.trydex.android.ui.settings

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.notifications.Alert
import dev.trydex.android.notifications.Notifier
import dev.trydex.android.notifications.PushState
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.CharacterAvatar
import dev.trydex.android.ui.components.InfoTip
import dev.trydex.android.ui.components.PageColumn
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.SectionCard
import dev.trydex.android.ui.nav.CharacterEditor
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.client.DexApi
import dev.trydex.core.model.Catalogs
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.DexState
import dev.trydex.core.model.Format
import dev.trydex.core.model.PushDevice
import dev.trydex.core.model.SidekickNotify
import kotlinx.coroutines.launch

/**
 * What this device tells you about. With push (a build with Firebase, and an agent that has its key), the agent
 * notifies this device directly and its choices live there; otherwise the app notifies from its own connection and a
 * check about every 15 minutes. Below: each sidekick's setting, your other devices, and muted chats.
 */
@Composable
fun NotificationSettingsScreen() {
    val app = LocalApp.current
    val context = LocalContext.current
    val repository = app.graph.repository
    val push = app.graph.push
    val state by repository.state.collectAsStateWithLifecycle()
    val prefs by app.graph.preferences.prefs.collectAsStateWithLifecycle()
    val pushState by push.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf<Pair<Boolean, String>?>(null) }
    var allowed by remember { mutableStateOf(Notifier.canPost(context)) }
    var denied by remember { mutableStateOf(false) }
    // Coming back from Android's settings may have changed the permission.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        val now = Notifier.canPost(context)
        if (now != allowed) {
            allowed = now
            scope.launch { push.sync() }
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        allowed = granted
        if (granted) {
            app.graph.preferences.setNotifications(true)
            message = true to "Notifications are on for this device."
        } else {
            denied = true
            app.graph.preferences.setNotifyAsked()
            message = false to "Notifications weren't allowed."
        }
    }
    // Opening this page is a fine moment to ask, once.
    LaunchedEffect(Unit) {
        val loaded = app.graph.preferences.prefs.value
        if (loaded.loaded && !loaded.notifyAsked && !loaded.notifications && !Notifier.canPost(context) && Build.VERSION.SDK_INT >= 33) {
            runCatching { permission.launch(Manifest.permission.POST_NOTIFICATIONS) }
        }
    }
    val turnOn = {
        message = null
        if (Build.VERSION.SDK_INT >= 33 && !allowed) permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        else {
            app.graph.preferences.setNotifications(true)
            message = true to "Notifications are on for this device."
        }
    }
    PaneScaffold(title = "Notifications", actions = {
        InfoTip("Know when a sidekick messages you, Dex finishes, hits a problem, or needs you. Set per device. Each sidekick also says which of their messages notify you.", "About Notifications")
    }, modifier = Modifier.testTag("notifications")) { padding ->
        PageColumn(padding) {
            val current = state
            if (current == null) {
                BoneRows(8)
                return@PageColumn
            }
            val supported = push.supported(current)
            val on = prefs.notifications && allowed
            val device = push.device(current)
            val model = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
            SectionCard(title = "This device", aside = { if (on) Text(model, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 8.dp)) }) {
                when {
                    !on -> {
                        Text(
                            when {
                                !allowed && prefs.notifications -> "Android isn't allowing Dex to notify you."
                                supported -> "Off. Turn them on to hear from your sidekicks and chats the moment something happens."
                                else -> "Off. Turn them on to hear when chats finish, while Dex is open and about every 15 minutes when it isn't."
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.testTag("push-status"),
                        )
                        Button(onClick = turnOn, modifier = Modifier.testTag("turn-on")) {
                            Icon(Icons.Outlined.Notifications, contentDescription = null, modifier = Modifier.size(18.dp))
                            Text("Turn on notifications", modifier = Modifier.padding(start = 6.dp))
                        }
                        if (denied || (!allowed && prefs.notifications)) Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Blocked for Dex", style = MaterialTheme.typography.bodySmall, color = DexTheme.colors.warning)
                            TextButton(onClick = {
                                context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                            }) { Text("Open Android settings") }
                        }
                    }
                    supported -> PushDeviceSettings(current, device, pushState, onMessage = { message = it }, onTurnOff = {
                        app.graph.preferences.setNotifications(false)
                        message = null
                    })
                    else -> LocalDeviceSettings(onMessage = { message = it }, onTurnOff = {
                        app.graph.preferences.setNotifications(false)
                        message = null
                    })
                }
                message?.let { (ok, text) -> Text(text, style = MaterialTheme.typography.bodyMedium, color = if (ok) DexTheme.colors.success else MaterialTheme.colorScheme.error, modifier = Modifier.testTag("push-message")) }
            }
            if (current.characters.isNotEmpty()) {
                SectionCard(title = "Sidekicks", info = "Which of each sidekick's messages notify you. Devices also need Sidekicks turned on above.", contentPadding = false) {
                    current.characters.forEach { character -> SidekickNotifyRow(character, onError = { message = false to it }) }
                }
            }
            val others = current.push.devices.filter { it.id != device?.id }
            if (others.isNotEmpty()) {
                SectionCard(title = "Other devices", info = "Browsers, installed web apps, and the iPhone and Android apps. Each device has its own choices. Remove one to stop notifications there.", contentPadding = false) {
                    others.forEach { other ->
                        SettingRow(
                            other.label + platformSuffix(other),
                            icon = Icons.Outlined.Smartphone,
                            detail = "${other.kinds.size}/${Catalogs.NOTIFY_KINDS.size} kinds · " + (other.lastSentAt?.let { "sent ${Format.timeAgo(it)}" } ?: "nothing sent yet") + (if (other.error != null) " · last delivery failed" else ""),
                            trailing = {
                                IconButton(onClick = { scope.launch { runCatching { repository.api.pushUnsubscribe(other.id) } } }) {
                                    Icon(Icons.Outlined.DeleteOutline, contentDescription = "Remove ${other.label}")
                                }
                            },
                        )
                    }
                }
            }
            val muted = current.sessions.filter { it.muted }
            if (muted.isNotEmpty()) {
                SectionCard(title = "Muted chats", info = "No notifications from these. Mute or unmute a chat with the bell in its header.", contentPadding = false) {
                    muted.forEach { session ->
                        SettingRow(session.title, icon = Icons.Outlined.NotificationsOff, onClick = { app.navigator.open(Chat(session.id)) }, trailing = {
                            TextButton(onClick = { scope.launch { runCatching { repository.api.setSessionMuted(session.id, false) } } }) { Text("Unmute") }
                        })
                    }
                }
            }
        }
    }
}

private fun platformSuffix(device: PushDevice) = when (device.platform) {
    "ios" -> " · iPhone app"
    "android" -> " · Android app"
    else -> ""
}

/** Push from the agent: whether it's registered, and this device's choices, kept by the agent. */
@Composable
private fun PushDeviceSettings(state: DexState, device: PushDevice?, pushState: PushState, onMessage: (Pair<Boolean, String>?) -> Unit, onTurnOff: () -> Unit) {
    val app = LocalApp.current
    val api = app.graph.repository.api
    val scope = rememberCoroutineScope()
    var testing by remember { mutableStateOf(false) }
    val status = when {
        device != null -> "Instant push is on: your agent notifies this device directly" + (device.lastSentAt?.let { ", last ${Format.timeAgo(it)}." } ?: ".")
        pushState is PushState.Failed -> "Couldn't turn on push: ${pushState.message}"
        else -> "Setting up push…"
    }
    Text(status, style = MaterialTheme.typography.bodyMedium, color = if (pushState is PushState.Failed && device == null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("push-status"))
    device?.error?.let { Text("The last delivery failed: $it", style = MaterialTheme.typography.bodySmall, color = DexTheme.colors.warning) }
    if (device == null) {
        if (pushState is PushState.Failed) TextButton(onClick = { scope.launch { app.graph.push.sync(force = true) } }, modifier = Modifier.testTag("push-retry")) { Text("Try again") }
        return
    }
    Column {
        Catalogs.NOTIFY_KINDS.forEach { kind ->
            SettingRow(kind.label, info = kind.description, trailing = {
                Switch(
                    checked = kind.id in device.kinds,
                    onCheckedChange = { checked ->
                        val kinds = if (checked) device.kinds + kind.id else device.kinds - kind.id
                        scope.launch { runCatching { api.pushUpdate(device.id, kinds = kinds) }.onFailure { onMessage(false to (it.message ?: "Couldn't save that.")) } }
                    },
                    modifier = Modifier.semantics { contentDescription = kind.label }.testTag("kind-${kind.id}"),
                )
            })
        }
        SettingRow("Skip what I'm looking at", icon = Icons.Outlined.Visibility, info = "No notification while Dex is open and visible on any of your devices.", trailing = {
            Switch(
                checked = device.onlyWhenAway,
                onCheckedChange = { on -> scope.launch { runCatching { api.pushUpdate(device.id, onlyWhenAway = on) } } },
                modifier = Modifier.semantics { contentDescription = "Skip what I'm looking at" }.testTag("only-when-away"),
            )
        })
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(enabled = !testing, onClick = {
            testing = true
            onMessage(null)
            scope.launch {
                runCatching { api.pushTest(device.id) }
                    .onSuccess { error -> onMessage(if (error == null) true to "Sent. It should arrive in a moment." else false to error) }
                    .onFailure { onMessage(false to (it.message ?: "Couldn't send a test.")) }
                testing = false
            }
        }, modifier = Modifier.testTag("send-test")) {
            Icon(Icons.AutoMirrored.Outlined.Send, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("Send a test", modifier = Modifier.padding(start = 6.dp))
        }
        TextButton(onClick = onTurnOff, modifier = Modifier.testTag("turn-off")) {
            Icon(Icons.Outlined.NotificationsOff, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("Turn off", modifier = Modifier.padding(start = 6.dp))
        }
    }
}

/** Without push: the app notifies from its own connection; the choices are kept on this device. */
@Composable
private fun LocalDeviceSettings(onMessage: (Pair<Boolean, String>?) -> Unit, onTurnOff: () -> Unit) {
    val app = LocalApp.current
    val context = LocalContext.current
    val prefs by app.graph.preferences.prefs.collectAsStateWithLifecycle()
    Text(
        "This app notifies from its own connection to your agent, and checks in about every 15 minutes while it's closed, so some arrive a little late. Instant push needs Firebase set up for this Dex.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.testTag("push-status"),
    )
    Column {
        Catalogs.NOTIFY_KINDS.forEach { kind ->
            SettingRow(kind.label, info = kind.description, trailing = {
                Switch(
                    checked = kind.id in prefs.notifyKinds,
                    onCheckedChange = { checked -> app.graph.preferences.setNotifyKinds(if (checked) prefs.notifyKinds + kind.id else prefs.notifyKinds - kind.id) },
                    modifier = Modifier.semantics { contentDescription = kind.label }.testTag("kind-${kind.id}"),
                )
            })
        }
        SettingRow("Skip what I'm looking at", icon = Icons.Outlined.Visibility, info = "No notification for a chat that's open and visible on this device.", trailing = {
            Switch(checked = prefs.onlyWhenAway, onCheckedChange = { app.graph.preferences.setOnlyWhenAway(it) }, modifier = Modifier.semantics { contentDescription = "Skip what I'm looking at" })
        })
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(onClick = {
            Notifier.post(context, Alert("test", "dex-test", "Dex notifications are on", "This is what an update from Dex looks like.", "dex://app/notifications"))
            onMessage(true to "Sent. It should arrive in a moment.")
        }, modifier = Modifier.testTag("send-test")) {
            Icon(Icons.AutoMirrored.Outlined.Send, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("Send a test", modifier = Modifier.padding(start = 6.dp))
        }
        TextButton(onClick = onTurnOff, modifier = Modifier.testTag("turn-off")) {
            Icon(Icons.Outlined.NotificationsOff, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("Turn off", modifier = Modifier.padding(start = 6.dp))
        }
    }
}

/** A sidekick and which of their messages notify you, changed from a menu. */
@Composable
private fun SidekickNotifyRow(character: CharacterProfile, onError: (String) -> Unit) {
    val app = LocalApp.current
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    val level = character.notifyLevel
    SettingRow(
        character.name,
        detail = level.description,
        leading = { CharacterAvatar(character, size = 32.dp) },
        onClick = { app.navigator.open(CharacterEditor(character.id)) },
        modifier = Modifier.testTag("sidekick-notify-${character.id}"),
        trailing = {
            Box {
                TextButton(onClick = { open = true }, modifier = Modifier.semantics { contentDescription = "Notifications from ${character.name}: ${level.label}" }.testTag("sidekick-notify-menu-${character.id}")) {
                    Text(level.label)
                    Icon(Icons.Rounded.ExpandMore, contentDescription = null, modifier = Modifier.size(18.dp))
                }
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                    SidekickNotify.entries.forEach { choice ->
                        DropdownMenuItem(
                            text = { Text(choice.label) },
                            onClick = {
                                open = false
                                if (choice != level) scope.launch {
                                    runCatching { app.graph.repository.api.saveCharacter(DexApi.characterNotifyDraft(character, choice)) }
                                        .onFailure { onError(it.message ?: "Couldn't save that.") }
                                }
                            },
                            modifier = Modifier.testTag("sidekick-notify-${character.id}-${choice.id}"),
                        )
                    }
                }
            }
        },
    )
}
