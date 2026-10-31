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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.rounded.TheaterComedy
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
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
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.chat.ModelPicker
import dev.trydex.android.ui.components.Bone
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.CharacterAvatar
import dev.trydex.android.ui.components.EmptyState
import dev.trydex.android.ui.components.ErrorText
import dev.trydex.android.ui.components.Hint
import dev.trydex.android.ui.components.InfoTip
import dev.trydex.android.ui.components.ModelLogo
import dev.trydex.android.ui.components.PageColumn
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.SectionCard
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.components.rememberConfirm
import dev.trydex.android.ui.nav.CharacterEditor
import dev.trydex.android.ui.nav.CharacterList
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.nav.Route
import dev.trydex.android.ui.nav.Tab
import dev.trydex.core.client.DexApi
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.Characters
import dev.trydex.core.model.DexState
import dev.trydex.core.model.Format
import dev.trydex.core.model.SessionMeta
import dev.trydex.core.model.SidekickPreset
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** The id of a character that doesn't exist yet. */
const val NEW_CHARACTER = "new"

private fun blankCharacter(state: DexState) = CharacterProfile(id = "", model = state.settings.defaultModel, thinking = state.settings.defaultThinking)

private fun CharacterProfile.comparable() = copy(createdAt = 0, updatedAt = 0)

/** "Oct 5, 2026": when a conversation with a character started. */
fun conversationDate(millis: Long): String =
    Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))

/** Whether anything has happened in a chat since it was made (the web's `updatedAt > createdAt + 1s`). */
fun SessionMeta.touched() = updatedAt > createdAt + 1_000

/** Every character as a card: their tagline, model, and when you last talked, with Talk and Edit. */
@Composable
fun CharacterListScreen() {
    val app = LocalApp.current
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val selected = (app.navigator.stack(Tab.Library).getOrNull(2) as? CharacterEditor)?.id
    PaneScaffold(
        title = "Sidekicks",
        actions = {
            InfoTip(
                "Companions with a name, a personality, and one long conversation of their own, pinned above your chats. They remember you, and keep every tool Dex has.",
                "About sidekicks",
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { app.navigator.open(CharacterEditor(NEW_CHARACTER)) },
                icon = { Icon(Icons.Rounded.Add, contentDescription = null) },
                text = { Text("New sidekick") },
                modifier = Modifier.testTag("character-list-new"),
            )
        },
        modifier = Modifier.testTag("character-list"),
    ) { padding ->
        PageColumn(padding) {
            val current = state
            when {
                current == null -> BoneRows(4)
                current.characters.isEmpty() -> EmptyState(
                    "No sidekicks yet. Make a creative partner, a planner, a coach, or anyone you'd like to talk to.",
                    Icons.Rounded.TheaterComedy,
                    modifier = Modifier.testTag("character-empty"),
                )
                else -> ProfileGrid(current.characters) { character ->
                    CharacterCard(character, current.session(character.sessionId), character.id == selected)
                }
            }
            Box(Modifier.heightIn(min = 56.dp))
        }
    }
}

@Composable
private fun CharacterCard(character: CharacterProfile, session: SessionMeta?, selected: Boolean) {
    val app = LocalApp.current
    val scheme = MaterialTheme.colorScheme
    val models = app.graph.models
    OutlinedCard(
        onClick = { app.navigator.open(CharacterEditor(character.id)) },
        shape = RoundedCornerShape(24.dp),
        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) scheme.primary else scheme.outlineVariant),
        colors = CardDefaults.outlinedCardColors(containerColor = if (selected) scheme.secondaryContainer.copy(alpha = 0.5f) else scheme.surfaceContainerLow),
        modifier = Modifier.fillMaxWidth().testTag("character-card-${character.id}"),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                CharacterAvatar(character, size = 40.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(character.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(character.tagline.ifEmpty { "A sidekick" }, style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    ModelLogo(character.model, models, size = 14.dp)
                    MetaText(models.find(character.model)?.name ?: character.model, Modifier.widthIn(max = 200.dp))
                }
                if (session != null) MetaText(if (session.touched()) "last talked ${Format.timeAgo(session.updatedAt)}" else "new")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(
                    onClick = { app.navigator.open(Chat(character.sessionId)) },
                    modifier = Modifier.weight(1f).testTag("character-talk-${character.id}"),
                ) {
                    Icon(Icons.AutoMirrored.Rounded.Chat, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("Talk", modifier = Modifier.padding(start = 8.dp))
                }
                OutlinedButton(onClick = { app.navigator.open(CharacterEditor(character.id)) }) {
                    Icon(Icons.Rounded.Edit, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("Edit", modifier = Modifier.padding(start = 8.dp))
                }
            }
        }
    }
}

/**
 * A character's page and editor; [id] is "new" for one that doesn't exist yet. [route] is where it's open: the Library,
 * beside their conversation, or New character above the chats.
 */
@Composable
fun CharacterEditorScreen(id: String, route: Route) {
    val app = LocalApp.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val confirm = rememberConfirm()
    val haptics = haptics()
    val isNew = id == NEW_CHARACTER

    var edited by rememberSaveable(id, stateSaver = draftSaver(CharacterProfile.serializer())) { mutableStateOf<CharacterProfile?>(null) }
    var template by rememberSaveable(id) { mutableStateOf<String?>(null) }
    var saved by rememberSaveable(id) { mutableStateOf(false) }
    var saving by remember(id) { mutableStateOf(false) }
    var error by remember(id) { mutableStateOf<String?>(null) }

    val current = state
    val existing = current?.character(id)
    val base = when {
        current == null -> null
        isNew -> blankCharacter(current)
        else -> existing
    }
    val draft = edited ?: base
    val dirty = edited != null && (base == null || edited!!.comparable() != base.comparable())

    fun update(change: (CharacterProfile) -> CharacterProfile) {
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
            // The picture and look go only when they changed: left out, the agent keeps them as they are.
            val picture = isNew || value.image != base?.image || value.look != base?.look
            attempt { repository.api.saveCharacter(DexApi.characterDraft(value, picture)) }
                .onSuccess { result ->
                    haptics.confirm()
                    if (isNew) {
                        // A new character: straight to saying hi.
                        app.navigator.close(route)
                        app.navigator.open(Chat(result.sessionId))
                    } else {
                        edited = result
                        saved = true
                    }
                }
                .onFailure {
                    haptics.reject()
                    error = it.message ?: "Couldn't save the sidekick."
                }
            saving = false
        }
    }

    fun startOver(character: CharacterProfile) {
        confirm.ask(
            "Start over with ${character.name}?",
            "A new conversation. They keep their memory, and the current one stays here.",
            confirm = "Start over",
            destructive = false,
        ) {
            scope.launch {
                attempt { repository.api.restartCharacter(character.id) }
                    .onSuccess { next -> app.navigator.open(Chat(next.sessionId)) }
                    .onFailure { error = it.message ?: "Couldn't start over." }
            }
        }
    }

    PaneScaffold(
        title = draft?.name?.takeIf { it.isNotBlank() } ?: if (isNew) "New sidekick" else "Untitled",
        subtitle = draft?.tagline?.takeIf { it.isNotBlank() } ?: "Who are they to you?",
        modifier = Modifier.testTag("character-editor"),
        bottomBar = {
            if (draft != null && (isNew || existing != null)) {
                ProfileSaveBar(
                    label = when {
                        isNew -> "Create and say hi"
                        saved && !dirty -> "Saved"
                        else -> "Save"
                    },
                    enabled = !saving && draft.name.isNotBlank() && (isNew || dirty),
                    saving = saving,
                    saved = saved && !dirty && !isNew,
                    saveTag = "character-save",
                    onSave = ::save,
                    onStartChat = existing?.let { { app.navigator.open(Chat(it.sessionId)) } },
                    startChatLabel = "Talk",
                    onDelete = existing?.let { character ->
                        {
                            confirm.ask("Delete ${character.name}?", "Your conversations with them stay, as ordinary chats.") {
                                scope.launch {
                                    attempt { repository.api.deleteCharacter(character.id) }
                                        .onSuccess { app.navigator.close(route) }
                                        .onFailure { error = it.message ?: "Couldn't delete the sidekick." }
                                }
                            }
                        }
                    },
                )
            }
        },
    ) { padding ->
        PageColumn(padding, Modifier.consumeWindowInsets(padding).imePadding()) {
            when {
                current == null -> BoneRows(6)
                draft == null || (!isNew && existing == null) -> ProfileMissing("This sidekick no longer exists.", "Back to sidekicks") { app.navigator.open(CharacterList) }
                else -> {
                    if (isNew) {
                        TemplatePicker(template) { key ->
                            template = key
                            val preset = Characters.TEMPLATES.firstOrNull { it.key == key }
                            edited = preset?.applyTo(draft) ?: blankCharacter(current).copy(model = draft.model, thinking = draft.thinking)
                            saved = false
                        }
                    }
                    CharacterForm(draft, current, ::update)
                    error?.let { ErrorText(it, Modifier.testTag("character-error")) }
                    if (existing != null) {
                        CharacterMemory(existing)
                        Conversations(existing, current, onStartOver = { startOver(existing) })
                    }
                }
            }
        }
    }
}

@Composable
private fun TemplatePicker(selected: String?, onPick: (String) -> Unit) {
    SectionCard {
        ProfileField("Start from", "Fills in everything below; change any of it.") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Characters.TEMPLATES.forEach { preset ->
                    FilterChip(
                        selected = selected == preset.key,
                        onClick = { onPick(preset.key) },
                        label = { Text(preset.name) },
                        leadingIcon = { CharacterAvatar(preset.applyTo(CharacterProfile("")), size = 24.dp) },
                        modifier = Modifier.heightIn(min = 40.dp).testTag("character-template-${preset.key}"),
                    )
                }
                FilterChip(
                    selected = selected == "blank",
                    onClick = { onPick("blank") },
                    label = { Text("Blank") },
                    modifier = Modifier.heightIn(min = 40.dp).testTag("character-template-blank"),
                )
            }
        }
    }
}

@Composable
private fun CharacterForm(draft: CharacterProfile, state: DexState, onChange: ((CharacterProfile) -> CharacterProfile) -> Unit) {
    SectionCard {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            CharacterAvatar(draft, size = 56.dp)
            OutlinedTextField(
                value = draft.name,
                onValueChange = { v -> onChange { it.copy(name = v.take(40)) } },
                label = { Text("Name") },
                placeholder = { Text("Muse") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                modifier = Modifier.weight(1f).testTag("character-name"),
            )
        }
        OutlinedTextField(
            value = draft.tagline,
            onValueChange = { v -> onChange { it.copy(tagline = v.take(120)) } },
            label = { Text("Tagline") },
            placeholder = { Text("Your creative sparring partner") },
            supportingText = { Text("One line under their name in your chats.") },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.fillMaxWidth().testTag("character-tagline"),
        )
    }

    SectionCard {
        ProfileField("Look", "Pick a ready-made sidekick, or use a photo.") {
            LookPicker(draft) { preset -> onChange { preset.applyTo(it) } }
        }
        Text(
            "To mix your own look (body, eyes, mouth, extras), edit them in Dex on the web.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.testTag("character-look-web"),
        )
        ProfileField("Photo", "Shown instead of their look, cropped to a circle.") {
            // A photo replaces the look; removing it leaves their initial until you pick a look.
            CharacterPicture(draft.image?.takeIf { draft.look == null }) { image -> onChange { it.copy(image = image, look = null) } }
        }
        ProfileField("Background") { ProfileColorPicker(draft.color) { key -> onChange { it.copy(color = key) } } }
    }

    SectionCard {
        ProfileField("Character profile", "Who they are: personality, voice, backstory, how they talk to you. They become this instead of Dex.") {
            OutlinedTextField(
                value = draft.persona,
                onValueChange = { v -> onChange { it.copy(persona = v.take(20_000)) } },
                placeholder = { Text("Playful and curious, an artist friend who gets excited about half-formed ideas…") },
                minLines = 6,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Character profile" }.testTag("character-persona"),
            )
        }
        ProfileField("Prompt", "What they do for you, and any rules. Edits apply to the conversation right away.") {
            OutlinedTextField(
                value = draft.instructions,
                onValueChange = { v -> onChange { it.copy(instructions = v.take(20_000)) } },
                placeholder = { Text("Help me brainstorm and make small prototypes. Remember the projects we've worked on…") },
                minLines = 7,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Prompt" }.testTag("character-instructions"),
            )
        }
        ProfileField("Greeting", "Their first words, at the top of the conversation.") {
            OutlinedTextField(
                value = draft.greeting,
                onValueChange = { v -> onChange { it.copy(greeting = v.take(2_000)) } },
                placeholder = { Text("Hey you. What are we making today?") },
                minLines = 2,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Greeting" }.testTag("character-greeting-field"),
            )
        }
    }

    SectionCard {
        ProfileField("Model and thinking", "Changing them moves the conversation to the new model.") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ModelPicker(draft.model, draft.thinking, onChange = { model, thinking -> onChange { it.copy(model = model, thinking = thinking) } })
            }
        }
        ProfileField("MCP servers", "Tools from these servers are always on in their conversation.") {
            ProfileMcpChips(state, draft.mcpServers, tag = "character-mcp") { ids -> onChange { it.copy(mcpServers = ids) } }
        }
    }
}

/** The twelve ready-made looks; picking one sets their look, its picture, and its background color. */
@Composable
private fun LookPicker(draft: CharacterProfile, onPick: (SidekickPreset) -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val current = Characters.presetOf(draft)?.key
    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Characters.PRESETS.forEach { preset ->
            val on = preset.key == current
            Hint(preset.name) {
                Box(
                    Modifier
                        .size(60.dp)
                        .then(if (on) Modifier.border(2.dp, scheme.primary, CircleShape) else Modifier)
                        .padding(4.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Surface(
                        onClick = { onPick(preset) },
                        shape = CircleShape,
                        color = Color.Transparent,
                        modifier = Modifier.size(52.dp).semantics {
                            contentDescription = preset.name
                            selected = on
                        }.testTag("character-look-${preset.key}"),
                    ) {
                        CharacterAvatar(CharacterProfile(preset.key, name = preset.name, color = preset.color, image = preset.dataUrl), size = 52.dp)
                    }
                }
            }
        }
    }
}

/** Choose a photo from the device (center-cropped and shrunk to fit the agent's 48 KB), or remove it. */
@Composable
private fun CharacterPicture(image: String?, onChange: (String?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var encoding by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        encoding = true
        error = null
        scope.launch {
            attempt { characterPicture(context, uri) }
                .onSuccess(onChange)
                .onFailure { error = it.message ?: "Couldn't read that picture." }
            encoding = false
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                enabled = !encoding,
                modifier = Modifier.testTag("character-picture"),
            ) {
                if (encoding) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Icon(Icons.Rounded.AddPhotoAlternate, contentDescription = null, modifier = Modifier.size(18.dp))
                Text(if (image != null) "Change picture" else "Choose a photo", modifier = Modifier.padding(start = 8.dp))
            }
            if (image != null) {
                TextButton(onClick = { onChange(null) }, modifier = Modifier.testTag("character-picture-remove")) {
                    Icon(Icons.Rounded.Close, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("Remove", modifier = Modifier.padding(start = 6.dp))
                }
            }
        }
        error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
    }
}

/**
 * A photo as a small square data: URL (center-cropped), under the 48 KB a character's picture may be: WebP (JPEG
 * before Android 11), shrinking until the URL is under 63,000 characters, as the web does.
 */
private suspend fun characterPicture(context: Context, uri: Uri): String = withContext(Dispatchers.IO) {
    val target = 512
    val decoded: Bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
            val shortest = min(info.size.width, info.size.height)
            if (shortest > target) {
                val scale = target.toFloat() / shortest
                decoder.setTargetSize(max(1, (info.size.width * scale).roundToInt()), max(1, (info.size.height * scale).roundToInt()))
            }
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } else {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (min(bounds.outWidth, bounds.outHeight) / (sample * 2) >= target) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
            ?: error("That file isn't an image Dex can read.")
    }
    val side = min(decoded.width, decoded.height)
    val square = Bitmap.createBitmap(decoded, (decoded.width - side) / 2, (decoded.height - side) / 2, side, side)
    val (format, type) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Bitmap.CompressFormat.WEBP_LOSSY to "webp" else Bitmap.CompressFormat.JPEG to "jpeg"
    for ((size, quality) in listOf(256 to 85, 192 to 80, 160 to 70, 128 to 60)) {
        val scaled = Bitmap.createScaledBitmap(square, min(size, side), min(size, side), true)
        val bytes = ByteArrayOutputStream().also { scaled.compress(format, quality, it) }.toByteArray()
        val url = "data:image/$type;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
        if (url.length < 63_000) return@withContext url
    }
    error("That picture is too detailed to keep small. Try another.")
}

/** Their own notes about you: they read these every turn and keep them up to date; you can edit them too. */
@Composable
private fun CharacterMemory(character: CharacterProfile) {
    val app = LocalApp.current
    val repository = app.graph.repository
    val connected by repository.connected.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var text by rememberSaveable(character.id) { mutableStateOf<String?>(null) }
    var loaded by rememberSaveable(character.id) { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(character.id, connected) {
        if (text != null || !connected) return@LaunchedEffect
        attempt { repository.api.characterMemory(character.id) }
            .onSuccess {
                text = it
                loaded = it
            }
            .onFailure { text = "" }
    }

    SectionCard(
        title = "Memory",
        info = "${character.name} reads this every turn and keeps it up to date as they get to know you. It lives at ${Characters.memoryPath(character.id)}.",
        modifier = Modifier.testTag("character-memory"),
    ) {
        val value = text
        if (value == null) {
            Bone(height = 120.dp, fraction = 1f)
        } else {
            OutlinedTextField(
                value = value,
                onValueChange = { text = it.take(64_000) },
                placeholder = { Text("Empty so far. ${character.name} writes here as they get to know you.", style = MonoStyle) },
                textStyle = MonoStyle,
                minLines = 5,
                maxLines = 16,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Memory" }.testTag("character-memory-text"),
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = {
                        saving = true
                        error = null
                        scope.launch {
                            attempt { repository.api.saveCharacterMemory(character.id, value) }
                                .onSuccess { loaded = value }
                                .onFailure { error = it.message ?: "Couldn't save the memory." }
                            saving = false
                        }
                    },
                    enabled = !saving && value != loaded,
                    modifier = Modifier.testTag("character-memory-save"),
                ) {
                    if (saving) CircularProgressIndicator(Modifier.size(16.dp).padding(end = 4.dp), strokeWidth = 2.dp)
                    Text(if (value == loaded) "Memory saved" else "Save memory", modifier = Modifier.padding(start = if (saving) 6.dp else 0.dp))
                }
                error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

/** Their conversations: the current one first, then the ones from before Start over, still readable. */
@Composable
private fun Conversations(character: CharacterProfile, state: DexState, onStartOver: () -> Unit) {
    val app = LocalApp.current
    val scheme = MaterialTheme.colorScheme
    val conversations = Characters.conversations(state, character)
    SectionCard(
        title = "Conversations",
        aside = {
            TextButton(onClick = onStartOver, modifier = Modifier.testTag("character-restart")) {
                Icon(Icons.Rounded.RestartAlt, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("Start over", modifier = Modifier.padding(start = 6.dp))
            }
        },
        contentPadding = false,
        modifier = Modifier.testTag("character-conversations"),
    ) {
        Column(Modifier.padding(horizontal = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            conversations.forEach { session ->
                val now = session.id == character.sessionId
                Surface(
                    onClick = { app.navigator.open(Chat(session.id)) },
                    shape = RoundedCornerShape(16.dp),
                    color = Color.Transparent,
                    modifier = Modifier.fillMaxWidth().testTag("character-conversation-${session.id}"),
                ) {
                    Row(Modifier.padding(horizontal = 12.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (now) "Current" else "Started ${conversationDate(session.createdAt)}",
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = if (now) FontWeight.Medium else null,
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            if (session.touched()) Format.timeAgo(session.updatedAt) else "nothing yet",
                            style = MaterialTheme.typography.labelMedium,
                            color = scheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

