package dev.trydex.android.ui.settings

import android.content.ClipData
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.GppMaybe
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Mouse
import androidx.compose.material.icons.outlined.Power
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.InfoTip
import dev.trydex.android.ui.components.PageColumn
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.SectionCard
import dev.trydex.android.ui.components.rememberConfirm
import dev.trydex.android.ui.machine.Dropdown
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.Catalogs
import dev.trydex.core.model.CreatedAccessToken
import dev.trydex.core.model.Format
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** The MCP client config (JSON) for a token. */
fun mcpConfig(endpoint: String, token: String) = """
{
  "mcpServers": {
    "dex": {
      "type": "http",
      "url": "$endpoint",
      "headers": {
        "Authorization": "Bearer $token"
      }
    }
  }
}
""".trim()

/** Chats and external agents managing Dex: what waits for your confirmation, MCP tokens, and the activity log. */
@Composable
fun AccessScreen() {
    val app = LocalApp.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val confirm = rememberConfirm()
    var answering by remember { mutableStateOf<String?>(null) }
    var answerError by remember { mutableStateOf<String?>(null) }
    var created by remember { mutableStateOf<CreatedAccessToken?>(null) }
    var allActivity by rememberSaveable { mutableStateOf(false) }
    val endpoint = repository.session.value?.serverUrl?.resolve("/api/mcp")?.toString() ?: "/api/mcp"
    PaneScaffold(title = "Access & API", actions = {
        InfoTip("Chats and external agents can manage Dex: start and message chats, create agents and projects, run VMs, and more. In a chat, just ask (“start a chat per repo”). Deleting anything, changing settings, editing existing agents or projects, and adding MCP servers need your confirmation in the chat, or a Full token over MCP. Chats started by chats go at most two levels deep, and every operation is logged below.", "About Access & API")
    }, modifier = Modifier.testTag("access")) { padding ->
        PageColumn(padding) {
            val current = state
            if (current == null) {
                BoneRows(8)
                return@PageColumn
            }
            val now = System.currentTimeMillis()
            val pending = current.access.pending.filter { it.status == "pending" && now - it.createdAt < 3_600_000 }
            if (pending.isNotEmpty()) {
                SectionCard(title = "Waiting for you", info = "Chats asked to do these. Nothing happens until you confirm.") {
                    pending.forEach { action ->
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.testTag("pending-${action.id}")) {
                            Icon(Icons.Outlined.GppMaybe, contentDescription = null, tint = DexTheme.colors.warning)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(action.summary, style = MaterialTheme.typography.bodyLarge)
                                val title = current.sessions.firstOrNull { it.id == action.sessionId }?.title ?: "a chat"
                                TextButton(onClick = { app.navigator.open(Chat(action.sessionId)) }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                                    Text("from $title · ${Format.timeAgo(action.createdAt)}", style = MaterialTheme.typography.bodySmall)
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    fun answer(approve: Boolean) {
                                        answering = action.id
                                        answerError = null
                                        scope.launch {
                                            runCatching { repository.api.resolvePendingAction(action.id, approve) }.onFailure { answerError = it.message }
                                            answering = null
                                        }
                                    }
                                    Button(
                                        onClick = { answer(true) }, enabled = answering == null,
                                        colors = ButtonDefaults.buttonColors(containerColor = DexTheme.colors.warning, contentColor = MaterialTheme.colorScheme.surface),
                                        modifier = Modifier.testTag("confirm-${action.id}"),
                                    ) {
                                        if (answering == action.id) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Icon(Icons.Rounded.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                                        Text("Confirm", modifier = Modifier.padding(start = 6.dp))
                                    }
                                    TextButton(onClick = { answer(false) }, enabled = answering == null, modifier = Modifier.testTag("decline-${action.id}")) {
                                        Icon(Icons.Rounded.Close, contentDescription = null, modifier = Modifier.size(18.dp))
                                        Text("Decline", modifier = Modifier.padding(start = 6.dp))
                                    }
                                }
                            }
                        }
                    }
                    answerError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                }
            }
            SectionCard(title = "MCP", info = "Connect Claude Code, Claude Desktop, Cursor, or any MCP client. Each token has its own access level and expiry, and can be revoked any time.") {
                CopyField("Endpoint (Streamable HTTP)", endpoint)
                val made = created
                if (made != null) {
                    Surface(shape = RoundedCornerShape(20.dp), color = DexTheme.colors.warningContainer, contentColor = DexTheme.colors.onWarningContainer, modifier = Modifier.testTag("created-token")) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Icon(Icons.Outlined.Key, contentDescription = null)
                                Text("Copy this token now. It won't be shown again.", style = MaterialTheme.typography.titleSmall)
                            }
                            CopyField("${made.token.label} · ${Catalogs.riskLabel(made.token.scope)}", made.secret, secret = true)
                            CopyField("Claude Code", "claude mcp add --transport http dex $endpoint --header \"Authorization: Bearer ${made.secret}\"", secret = true)
                            Text("Other clients (JSON config)", style = MaterialTheme.typography.labelMedium)
                            Surface(shape = RoundedCornerShape(12.dp), color = DexTheme.colors.codeBackground, contentColor = DexTheme.colors.codeText) {
                                Text(mcpConfig(endpoint, made.secret), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, softWrap = false, modifier = Modifier.horizontalScroll(rememberScrollState()).padding(12.dp))
                            }
                            TextButton(onClick = { created = null }) { Text("Done") }
                        }
                    }
                } else {
                    NewToken { created = it }
                }
                if (current.access.tokens.isNotEmpty()) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    current.access.tokens.forEach { token ->
                        val expired = token.expiresAt != null && token.expiresAt!! < now
                        ListItem(
                            headlineContent = { Text(token.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            supportingContent = {
                                Text(
                                    "${Catalogs.riskLabel(token.scope)} · " + (token.lastUsedAt?.let { "used ${Format.timeAgo(it)}" } ?: "never used") + " · " +
                                        when {
                                            expired -> "expired"
                                            token.expiresAt != null -> "expires " + Instant.ofEpochMilli(token.expiresAt!!).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
                                            else -> "no expiry"
                                        },
                                    color = if (expired) DexTheme.colors.warning else Color.Unspecified,
                                )
                            },
                            leadingContent = { Icon(Icons.Outlined.Power, contentDescription = null) },
                            trailingContent = {
                                IconButton(onClick = {
                                    confirm.ask("Revoke “${token.label}”?", "Agents using it lose access immediately.", confirm = "Revoke") {
                                        scope.launch { runCatching { repository.api.revokeAccessToken(token.id) } }
                                    }
                                }) { Icon(Icons.Outlined.DeleteOutline, contentDescription = "Revoke ${token.label}") }
                            },
                            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                            modifier = Modifier.testTag("token-${token.id}"),
                        )
                    }
                }
            }
            SectionCard(title = "Activity", info = "Every app operation run by a chat, an external agent, or a button in a chat's UI, newest first.") {
                val audit = current.access.audit
                if (audit.isEmpty()) Text("Nothing yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                (if (allActivity) audit else audit.take(8)).forEach { entry ->
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(vertical = 4.dp)) {
                        val (icon, tint) = when (entry.actor) {
                            "mcp" -> Icons.Outlined.Power to DexTheme.colors.info
                            "user" -> Icons.Outlined.Check to DexTheme.colors.warning
                            "ui" -> Icons.Outlined.Mouse to MaterialTheme.colorScheme.tertiary
                            else -> Icons.Outlined.SmartToy to MaterialTheme.colorScheme.primary
                        }
                        Icon(icon, contentDescription = entry.actor, tint = tint, modifier = Modifier.size(18.dp).padding(top = 2.dp))
                        Column(Modifier.weight(1f)) {
                            Text(entry.summary, style = MaterialTheme.typography.bodyMedium, color = if (entry.ok) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                            Row {
                                val prefix = when (entry.actor) {
                                    "user" -> "You confirmed, for "
                                    "ui" -> "From a button in "
                                    else -> ""
                                }
                                Text("$prefix${entry.actorLabel} · ${Format.timeAgo(entry.at)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                                if (!entry.ok && entry.error != null) Text(" · ${entry.error}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
                if (!allActivity && audit.size > 8) TextButton(onClick = { allActivity = true }) { Text("Show all ${audit.size}") }
            }
        }
    }
}

@Composable
private fun NewToken(onCreated: (CreatedAccessToken) -> Unit) {
    val app = LocalApp.current
    val scope = rememberCoroutineScope()
    var label by rememberSaveable { mutableStateOf("") }
    var scopeIndex by rememberSaveable { mutableIntStateOf(1) }
    var expiry by rememberSaveable { mutableIntStateOf(1) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedTextField(
            value = label, onValueChange = { label = it.take(60) },
            label = { Text("New token") }, placeholder = { Text("Name, e.g. Claude Code on my laptop") },
            singleLine = true, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth().testTag("token-label"),
        )
        Text("Access", style = MaterialTheme.typography.labelLarge)
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            Catalogs.ACCESS_RISKS.forEachIndexed { index, risk ->
                SegmentedButton(
                    selected = scopeIndex == index,
                    onClick = { scopeIndex = index },
                    shape = SegmentedButtonDefaults.itemShape(index, Catalogs.ACCESS_RISKS.size),
                    modifier = Modifier.testTag("scope-${risk.id}"),
                ) { Text(risk.label, maxLines = 1) }
            }
        }
        Text(Catalogs.ACCESS_RISKS[scopeIndex].description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Dropdown("Expires", Catalogs.TOKEN_EXPIRY[expiry].second, Catalogs.TOKEN_EXPIRY.map { it.second }) { expiry = it }
        Button(onClick = {
            busy = true
            error = null
            scope.launch {
                runCatching {
                    val days = Catalogs.TOKEN_EXPIRY[expiry].first
                    app.graph.repository.api.createAccessToken(label.trim(), Catalogs.ACCESS_RISKS[scopeIndex].id, days.takeIf { it > 0 })
                }.onSuccess {
                    label = ""
                    onCreated(it)
                }.onFailure { error = it.message }
                busy = false
            }
        }, enabled = !busy && label.isNotBlank(), modifier = Modifier.testTag("create-token")) {
            if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.Key, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("Create token", modifier = Modifier.padding(start = 6.dp))
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
    }
}

/** A value to copy, with a Copy button that confirms for a moment. */
@Composable
fun CopyField(label: String, value: String, secret: Boolean = false) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var copied by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Surface(shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), color = Color.Transparent) {
            Row(Modifier.padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    value, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall,
                    color = if (secret) DexTheme.colors.warning else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                TextButton(onClick = {
                    scope.launch {
                        clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(label, value)))
                        copied = true
                        delay(1_500)
                        copied = false
                    }
                }) {
                    Icon(if (copied) Icons.Rounded.Check else Icons.Outlined.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp), tint = if (copied) DexTheme.colors.success else androidx.compose.material3.LocalContentColor.current)
                    Text(if (copied) "Copied" else "Copy", modifier = Modifier.padding(start = 6.dp))
                }
            }
        }
    }
}
