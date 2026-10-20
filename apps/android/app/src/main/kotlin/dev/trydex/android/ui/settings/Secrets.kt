package dev.trydex.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextObfuscationMode
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedSecureTextField
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
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
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.Format
import kotlinx.coroutines.launch

/** A secret's name as it's typed: capitals, digits, and underscores. */
fun secretName(input: String) = input.uppercase().replace(Regex("[^A-Z0-9_]"), "_").take(64)

/** API keys and tokens every chat's VM gets as environment variables. */
@Composable
fun SecretsScreen() {
    val app = LocalApp.current
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val confirm = rememberConfirm()
    val scope = rememberCoroutineScope()
    var replacing by remember { mutableStateOf<String?>(null) }
    PaneScaffold(title = "Secrets", actions = {
        InfoTip("API keys and tokens every chat's VM gets as environment variables (e.g. \$MY_API_KEY), so you enter them once. Values are stored encrypted, never shown again, hidden from chats, and masked in VM output.", "About Secrets")
    }, modifier = Modifier.testTag("secrets")) { padding ->
        PageColumn(padding) {
            val current = state
            if (current == null) {
                BoneRows(6)
                return@PageColumn
            }
            SectionCard(title = "Add a secret") { SecretForm(fixedName = null, note = null, onDone = {}) }
            SectionCard(title = "Saved", contentPadding = false, aside = { if (current.secrets.isNotEmpty()) Text("${current.secrets.size}", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 8.dp)) }) {
                if (current.secrets.isEmpty()) Text("No secrets yet.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                current.secrets.forEach { secret ->
                    ListItem(
                        headlineContent = { Text(secret.name, fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        supportingContent = { Text((if (secret.note.isNotEmpty()) "${secret.note} · " else "") + "updated ${Format.timeAgo(secret.updatedAt)}") },
                        leadingContent = { Icon(Icons.Outlined.Lock, contentDescription = null) },
                        trailingContent = {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                if (replacing != secret.name) TextButton(onClick = { replacing = secret.name }) { Text("Replace") }
                                IconButton(onClick = {
                                    confirm.ask("Delete ${secret.name}?", "VMs stop getting it from their next command.") {
                                        scope.launch { runCatching { app.graph.repository.api.removeSecret(secret.name) } }
                                    }
                                }) { Icon(Icons.Outlined.DeleteOutline, contentDescription = "Delete ${secret.name}") }
                            }
                        },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                        modifier = Modifier.testTag("secret-${secret.name}"),
                    )
                    if (replacing == secret.name) {
                        Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                            SecretForm(fixedName = secret.name, note = secret.note, onDone = { replacing = null })
                        }
                    }
                }
            }
        }
    }
}

/** Saves a secret: a new one (name, note, value), or a new value for [fixedName] (keeping its note). */
@Composable
private fun SecretForm(fixedName: String?, note: String?, onDone: () -> Unit) {
    val app = LocalApp.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var noteText by remember { mutableStateOf("") }
    val value = rememberTextFieldState()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var saved by remember { mutableStateOf<String?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (fixedName == null) {
            BoxWithConstraints {
                val fields = @Composable { modifier: Modifier ->
                    OutlinedTextField(
                        value = name, onValueChange = { name = secretName(it) },
                        placeholder = { Text("MY_API_KEY") }, label = { Text("Name") }, singleLine = true,
                        textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
                        shape = RoundedCornerShape(16.dp), modifier = modifier.testTag("secret-name"),
                    )
                }
                val noteField = @Composable { modifier: Modifier ->
                    OutlinedTextField(
                        value = noteText, onValueChange = { noteText = it.take(200) },
                        placeholder = { Text("What it's for (optional)") }, label = { Text("Note") }, singleLine = true,
                        shape = RoundedCornerShape(16.dp), modifier = modifier.testTag("secret-note"),
                    )
                }
                if (maxWidth >= 520.dp) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { fields(Modifier.weight(1f)); noteField(Modifier.weight(1f)) }
                else Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { fields(Modifier.fillMaxWidth()); noteField(Modifier.fillMaxWidth()) }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedSecureTextField(
                state = value,
                placeholder = { Text(if (fixedName != null) "New value for $fixedName" else "Value") },
                leadingIcon = { Icon(Icons.Outlined.Key, contentDescription = null) },
                textObfuscationMode = TextObfuscationMode.RevealLastTyped,
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.weight(1f).testTag("secret-value"),
            )
            Button(onClick = {
                busy = true
                error = null
                val target = fixedName ?: name
                scope.launch {
                    // Replacing keeps the note: the agent overwrites it with whatever is sent.
                    runCatching { app.graph.repository.api.saveSecret(target, value.text.toString(), if (fixedName != null) note.orEmpty() else noteText) }
                        .onSuccess { savedName ->
                            value.setTextAndPlaceCursorAtEnd("")
                            name = ""
                            noteText = ""
                            if (fixedName == null) saved = savedName
                            onDone()
                        }
                        .onFailure { error = it.message }
                    busy = false
                }
            }, enabled = !busy && value.text.isNotEmpty() && (fixedName != null || name.isNotEmpty()), modifier = Modifier.testTag("secret-save")) {
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text(if (fixedName != null) "Replace" else "Save")
            }
        }
        if (fixedName != null) TextButton(onClick = onDone) { Text("Cancel") }
        error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        if (error == null && saved != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Rounded.Check, contentDescription = null, tint = DexTheme.colors.success, modifier = Modifier.size(18.dp))
            Text("Saved $saved. VMs get it from their next command.", style = MaterialTheme.typography.bodySmall, color = DexTheme.colors.success)
        }
    }
}
