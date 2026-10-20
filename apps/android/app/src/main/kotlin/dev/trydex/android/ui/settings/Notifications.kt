package dev.trydex.android.ui.settings

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.notifications.Alert
import dev.trydex.android.notifications.Notifier
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.InfoTip
import dev.trydex.android.ui.components.PageColumn
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.SectionCard
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.Catalogs
import dev.trydex.core.model.Format
import kotlinx.coroutines.launch

/**
 * What this device tells you about. The app notifies from its own connection to your agent (while it's open or
 * recently was) and checks in the background about every 15 minutes; your agent's Web Push devices are listed too.
 */
@Composable
fun NotificationSettingsScreen() {
    val app = LocalApp.current
    val context = LocalContext.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val prefs by app.graph.preferences.prefs.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf<Pair<Boolean, String>?>(null) }
    var allowed by remember { mutableStateOf(Notifier.canPost(context)) }
    var denied by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        allowed = granted
        if (granted) {
            app.graph.preferences.setNotifications(true)
            message = true to "Notifications are on for this device."
        } else {
            denied = true
            message = false to "Notifications weren't allowed."
        }
    }
    PaneScaffold(title = "Notifications", actions = {
        InfoTip("Know when Dex finishes, hits a problem, or needs you. Off until you turn it on, and set per device. Notifications have quick actions (Open chat, Mute this chat). This app checks in about every 15 minutes while it's closed, so some arrive a little late.", "About Notifications")
    }, modifier = Modifier.testTag("notifications")) { padding ->
        PageColumn(padding) {
            val current = state
            if (current == null) {
                BoneRows(8)
                return@PageColumn
            }
            val on = prefs.notifications && allowed
            SectionCard(title = "This device", aside = { if (on) Text("${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 8.dp)) }) {
                if (on) {
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
                            message = true to "Sent. It should arrive in a moment."
                        }, modifier = Modifier.testTag("send-test")) {
                            Icon(Icons.AutoMirrored.Outlined.Send, contentDescription = null, modifier = Modifier.size(18.dp))
                            Text("Send a test", modifier = Modifier.padding(start = 6.dp))
                        }
                        TextButton(onClick = { app.graph.preferences.setNotifications(false); message = null }, modifier = Modifier.testTag("turn-off")) {
                            Icon(Icons.Outlined.NotificationsOff, contentDescription = null, modifier = Modifier.size(18.dp))
                            Text("Turn off", modifier = Modifier.padding(start = 6.dp))
                        }
                    }
                } else {
                    Button(onClick = {
                        message = null
                        if (Build.VERSION.SDK_INT >= 33 && !allowed) permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                        else {
                            app.graph.preferences.setNotifications(true)
                            message = true to "Notifications are on for this device."
                        }
                    }, modifier = Modifier.testTag("turn-on")) {
                        Icon(Icons.Outlined.Notifications, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Turn on notifications", modifier = Modifier.padding(start = 6.dp))
                    }
                    if (denied) Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Blocked for Dex", style = MaterialTheme.typography.bodySmall, color = DexTheme.colors.warning)
                        TextButton(onClick = {
                            context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        }) { Text("Open Android settings") }
                    }
                }
                message?.let { (ok, text) -> Text(text, style = MaterialTheme.typography.bodyMedium, color = if (ok) DexTheme.colors.success else MaterialTheme.colorScheme.error) }
            }
            val others = current.push.devices
            if (others.isNotEmpty()) {
                SectionCard(title = "Other devices", info = "Browsers and installed web apps with Web Push. Each device has its own choices. Remove one to stop notifications there.", contentPadding = false) {
                    others.forEach { device ->
                        SettingRow(
                            device.label,
                            icon = Icons.Outlined.Smartphone,
                            detail = "${device.kinds.size}/6 kinds · " + (device.lastSentAt?.let { "sent ${Format.timeAgo(it)}" } ?: "nothing sent yet") + (if (device.error != null) " · last delivery failed" else ""),
                            trailing = {
                                IconButton(onClick = { scope.launch { runCatching { repository.api.pushUnsubscribe(device.id) } } }) {
                                    Icon(Icons.Outlined.DeleteOutline, contentDescription = "Remove ${device.label}")
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
