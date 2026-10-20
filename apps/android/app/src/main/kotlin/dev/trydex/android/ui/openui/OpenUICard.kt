package dev.trydex.android.ui.openui

import android.content.ClipData
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.GppMaybe
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.LocalOpenInBrowser
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.nav.Machine
import dev.trydex.android.ui.nav.WorkspaceFile
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.client.DexApi
import dev.trydex.core.model.UiOperationResult
import dev.trydex.openui.ActionEvent
import dev.trydex.openui.Ast
import dev.trydex.openui.DexLibrary
import dev.trydex.openui.ElementNode
import dev.trydex.openui.Js
import dev.trydex.openui.OpenUIError
import dev.trydex.openui.OpenUIRuntime
import dev.trydex.openui.ParseResult
import dev.trydex.openui.ToolError
import dev.trydex.openui.ToolProvider
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement

private const val CANCELLED = "You cancelled it."

/** Each chat's saved card states (DexAgent.uiStates), loaded once per chat and kept current by this app's saves. */
internal object UiStateCache {
    private val states = HashMap<String, CompletableDeferred<MutableMap<String, Any?>>>()

    suspend fun load(api: DexApi, sessionId: String): Map<String, Any?> {
        val existing = states[sessionId]
        if (existing != null) return existing.await()
        val deferred = CompletableDeferred<MutableMap<String, Any?>>()
        states[sessionId] = deferred
        val loaded = runCatching { api.uiStates(sessionId) }.getOrElse {
            states.remove(sessionId)
            emptyMap<String, JsonElement>()
        }
        deferred.complete(loaded.mapValues { Js.fromJson(it.value) }.toMutableMap())
        return deferred.await()
    }

    fun saved(sessionId: String, card: String, state: Any?) {
        val deferred = states[sessionId] ?: return
        if (deferred.isCompleted) deferred.getCompleted()[card] = state
    }
}

/** Password inputs' names anywhere in the tree: their values are kept as secrets, never in state or messages. */
fun passwordFields(root: ElementNode?): Set<String> {
    val names = HashSet<String>()
    fun walk(value: Any?) {
        when (value) {
            is ElementNode -> {
                if (value.typeName == "Input" && value.props["type"] == "password") (value.props["name"] as? String)?.let(names::add)
                value.props.values.forEach(::walk)
            }
            is List<*> -> value.forEach(::walk)
            is Map<*, *> -> value.values.forEach(::walk)
        }
    }
    walk(root)
    return names
}

/** State to save, without password fields at any depth. */
fun withoutPasswords(value: Any?, fields: Set<String>): Any? = when (value) {
    is List<*> -> value.map { withoutPasswords(it, fields) }
    is Map<*, *> -> LinkedHashMap<String, Any?>().apply {
        value.forEach { (k, v) -> if (k.toString() !in fields) put(k.toString(), withoutPasswords(v, fields)) }
    }
    else -> value
}

/** The form values with each password field's value stored as a chat secret and replaced by `{{secret:<name>}}`. */
suspend fun withoutSecrets(value: Any?, fields: Set<String>, store: suspend (String, String) -> String): Any? {
    suspend fun walk(node: Any?, key: String?): Any? {
        if (key != null && key in fields) {
            val text = node as? String ?: (node as? Map<*, *>)?.get("value") as? String
            if (!text.isNullOrEmpty()) {
                val placeholder = "{{secret:${store(key, text)}}}"
                return if (node is String) placeholder else LinkedHashMap<String, Any?>().apply {
                    (node as Map<*, *>).forEach { (k, v) -> put(k.toString(), v) }
                    put("value", placeholder)
                }
            }
        }
        return when (node) {
            is List<*> -> node.map { walk(it, null) }
            is Map<*, *> -> LinkedHashMap<String, Any?>().apply { node.forEach { (k, v) -> put(k.toString(), walk(v, k.toString())) } }
            else -> node
        }
    }
    return walk(value, null)
}

/** What a UI action sends to the chat: `[UI action] …`, then the form values and context, if any. */
fun modelMessage(event: ActionEvent, formState: Any?): String {
    val lines = mutableListOf("[UI action] ${event.humanFriendlyMessage}")
    if (formState is Map<*, *> && formState.isNotEmpty()) lines += "Form values: ${Js.json(formState)}"
    if (event.params.containsKey("context")) lines += "Context: ${Js.json(event.params["context"])}"
    return lines.joinToString("\n")
}

private fun literal(node: Ast?): String? = (node as? Ast.Str)?.v

/** Tools only Mutation()s call: they run on a tap. Everything else is a Query and may only read. */
fun mutationOnlyTools(result: ParseResult?): Set<String> {
    result ?: return emptySet()
    val queried = result.queryStatements.map { literal(it.toolAst) }
    if (null in queried) return emptySet()
    return result.mutationStatements.mapNotNull { literal(it.toolAst) }.filter { it !in queried }.toSet()
}

/** Tools whose list results the program reads as `{ rows: [...] }`. */
fun rowsTools(result: ParseResult?, code: String): Set<String> {
    result ?: return emptySet()
    return (result.queryStatements.map { it.statementId to it.toolAst } + result.mutationStatements.map { it.statementId to it.toolAst })
        .mapNotNull { (id, tool) -> literal(tool)?.takeIf { Regex("\\b${Regex.escape(id)}\\.rows\\b").containsMatchIn(code) } }
        .toSet()
}

/** Problems in the program itself, described for the model that wrote it. */
fun programProblems(errors: List<OpenUIError>): List<String> = errors
    .filter { (it.source == "parser" || it.source == "runtime") && it.severity != "warning" }
    .map { e -> listOfNotNull(e.statementId?.let { "$it:" }, e.component, e.message, e.hint?.let { "($it)" }).joinToString(" ") }

/** Failed live data and buttons, as `tool: message`. */
fun toolErrors(errors: List<OpenUIError>): List<String> = errors
    .filter { (it.source == "query" || it.source == "mutation") && !it.message.endsWith(CANCELLED) }
    .map { it.message.replace(Regex("^(Query|Mutation) \"([^\"]+)\" (returned an error|failed): "), "$2: ") }
    .distinct()

fun fixItMessage(problems: List<String>) =
    "[UI errors] The UI you rendered has problems. Render it again, fixed:\n" + problems.joinToString("\n") { "- $it" }

@Stable
private class CardHost {
    var confirm by mutableStateOf<Pair<String, CompletableDeferred<Boolean>>?>(null)
    var error by mutableStateOf<String?>(null)
    var notice by mutableStateOf<String?>(null)
    val visible = MutableStateFlow(false)
    var lastSaved: String? = null
    var saveJob: Job? = null
    /** The program as it is now, for which queries read `.rows`. */
    var code: String = ""

    suspend fun ask(summary: String): Boolean {
        confirm?.second?.complete(false)
        val answer = CompletableDeferred<Boolean>()
        confirm = summary to answer
        return try {
            answer.await()
        } finally {
            if (confirm?.second === answer) confirm = null
        }
    }
}

/**
 * A chat's render_ui card (OpenUIBlock on the web): the program rendered natively, live as it streams. Its queries
 * and buttons run app operations as this chat; its form and filter state is saved per card.
 */
@Composable
fun OpenUICard(sessionId: String, code: String, streaming: Boolean, card: String, onSend: (String) -> Unit) {
    val app = LocalApp.current
    val api = app.graph.repository.api
    val openInBrowser = LocalOpenInBrowser.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val host = remember(card) { CardHost() }
    var saved by remember(sessionId) { mutableStateOf<Map<String, Any?>?>(null) }
    LaunchedEffect(sessionId) { saved = UiStateCache.load(api, sessionId) }

    val runtime = remember(card) {
        lateinit var self: OpenUIRuntime
        val provider = ToolProvider { name, args ->
            val parse = self.state.value.parse
            val query = name !in mutationOnlyTools(parse)
            // Live data loads only while the card is on screen, or near it.
            if (query) host.visible.first { it }
            var outcome = api.runUiOperation(sessionId, name, Js.toJson(args), query)
            if (outcome is UiOperationResult.Confirm) {
                if (!host.ask(outcome.summary)) throw ToolError(CANCELLED)
                outcome = api.runUiOperation(sessionId, name, Js.toJson(args), query, confirmed = true)
            }
            when (outcome) {
                is UiOperationResult.Ok -> {
                    val result = Js.fromJson(outcome.result)
                    if (result is List<*> && name in rowsTools(parse, host.code)) mapOf("rows" to result) else result
                }
                is UiOperationResult.Failed -> throw ToolError(outcome.error)
                is UiOperationResult.Confirm -> throw ToolError("It wasn't confirmed.")
            }
        }
        OpenUIRuntime(DexLibrary.catalog, scope, provider, DexFunctions.forCatalog(DexLibrary.catalog)).also { self = it }
    }
    DisposableEffect(runtime) { onDispose { runtime.dispose() } }
    LaunchedEffect(runtime, code, streaming) { runtime.update(code, streaming) }
    var restored by remember(card) { mutableStateOf(false) }
    LaunchedEffect(saved) {
        val states = saved ?: return@LaunchedEffect
        if (!restored) {
            restored = true
            @Suppress("UNCHECKED_CAST")
            (states[card] as? Map<String, Any?>)?.let { runtime.setInitialState(it) }
            host.lastSaved = states[card]?.let { Js.json(it) }
        }
    }

    val state by runtime.state.collectAsStateWithLifecycle()
    val handler = ActionHandler(
        send = { event ->
            host.error = null
            scope.launch {
                try {
                    val fields = passwordFields(runtime.state.value.root)
                    val formState = if (fields.isEmpty()) event.formState else withoutSecrets(event.formState, fields) { field, value -> api.storeChatSecret(sessionId, field, value) }
                    onSend(modelMessage(event, formState))
                } catch (error: Exception) {
                    host.error = error.message ?: "That couldn't be sent."
                }
            }
        },
        open = { route -> app.navigator.open(route) },
        browse = { url -> openInBrowser(url) },
        copy = { text ->
            scope.launch {
                try {
                    clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Dex", text)))
                    host.notice = "Copied"
                    delay(2_000)
                    if (host.notice == "Copied") host.notice = null
                } catch (_: Exception) {
                    host.error = "Couldn't copy to the clipboard."
                }
            }
        },
    )

    val graphScope = app.graph.scope
    SideEffect {
        host.code = code
        runtime.onStateUpdate = { snapshot ->
            if (!state.streaming) {
                val next = withoutPasswords(snapshot, passwordFields(runtime.state.value.root))
                val json = Js.json(next)
                if (json != host.lastSaved) {
                    host.lastSaved = json
                    host.saveJob?.cancel()
                    // Saved shortly after the last change, even if the card has scrolled away by then.
                    host.saveJob = graphScope.launch {
                        delay(800)
                        UiStateCache.saved(sessionId, card, next)
                        runCatching { api.saveUiState(sessionId, card, Js.toJson(next)) }
                    }
                }
            }
        }
        runtime.onAction = { event -> handler.run(event) }
    }

    val density = LocalDensity.current
    val window = LocalWindowInfo.current
    val ui = OpenUIScope(runtime, state.streaming, state.revision, state.queryLoading, scope, onLink = { url -> safeLink(url)?.let(openInBrowser) })

    Column(
        Modifier.fillMaxWidth().padding(vertical = 4.dp).testTag("openui-card-host").onGloballyPositioned { coordinates ->
            val bounds = coordinates.boundsInWindow()
            val margin = with(density) { 400.dp.toPx() }
            host.visible.value = bounds.bottom >= -margin && bounds.top <= window.containerSize.height + margin
        },
    ) {
        if (saved == null) {
            val pulse by rememberInfiniteTransition(label = "card").animateFloat(0.4f, 1f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "pulse")
            Box(Modifier.fillMaxWidth().height(96.dp).alpha(pulse).clip(RoundedCornerShape(24.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh))
            return@Column
        }
        Surface(
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surfaceContainerLow,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f)),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Box {
                Box(Modifier.padding(16.dp).alpha(if (state.queryLoading) 0.7f else 1f)) {
                    CompositionLocalProvider(LocalOpenUI provides ui) {
                        state.root?.let { RenderNode(it) }
                    }
                }
                if (state.queryLoading) LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter).height(2.dp).testTag("openui-loading"))
            }
        }
        host.confirm?.let { (summary, answer) -> ConfirmPanel(summary, onAnswer = { answer.complete(it) }) }
        val problems = if (state.streaming) emptyList() else programProblems(state.errors)
        toolErrors(state.errors).forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(start = 8.dp, top = 6.dp)) }
        host.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(start = 8.dp, top = 6.dp)) }
        if (!state.streaming && (problems.isNotEmpty() || host.notice != null)) {
            FlowRow(Modifier.padding(start = 8.dp, top = 4.dp), itemVerticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (problems.isNotEmpty()) {
                    Text(
                        "${problems.size} ${if (problems.size == 1) "problem" else "problems"} in this UI",
                        style = MaterialTheme.typography.bodySmall, color = DexTheme.colors.warning,
                    )
                    TextButton(onClick = { onSend(fixItMessage(problems)) }, modifier = Modifier.testTag("openui-fix")) {
                        Icon(Icons.Outlined.Build, contentDescription = null, modifier = Modifier.size(16.dp))
                        Text("Fix it", modifier = Modifier.padding(start = 6.dp))
                    }
                }
                host.notice?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = DexTheme.colors.success) }
            }
        }
    }
}

private class ActionHandler(
    val send: (ActionEvent) -> Unit,
    val open: (dev.trydex.android.ui.nav.Route) -> Unit,
    val browse: (String) -> Unit,
    val copy: (String) -> Unit,
)

/** A string parameter of a Dex action, within reason. */
private fun param(event: ActionEvent, key: String): String? = (event.params[key] as? String)?.takeIf { it.length in 1..2_000 }

/** Runs a UI action: sends it to the chat, opens a link or a page in Dex, or copies text. */
private fun ActionHandler.run(event: ActionEvent) {
    when (event.type) {
        ActionEvent.CONTINUE_CONVERSATION -> send(event)
        ActionEvent.OPEN_URL -> safeLink(event.params["url"] as? String)?.let(browse)
        "OpenChat" -> param(event, "sessionId")?.let { open(Chat(it)) }
        "OpenFile" -> param(event, "path")?.let { open(WorkspaceFile(it)) }
        "OpenMachine" -> param(event, "vmKey")?.let { open(Machine(it)) }
        "Copy" -> (event.params["text"] as? String)?.let(copy)
    }
}

/** An admin operation a button asked for, with Dex's own summary of it (not the model's label). */
@Composable
private fun ConfirmPanel(summary: String, onAnswer: (Boolean) -> Unit) {
    val dex = DexTheme.colors
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = dex.warningContainer,
        contentColor = dex.onWarningContainer,
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp).testTag("openui-confirm"),
    ) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(Icons.Outlined.GppMaybe, contentDescription = null, tint = dex.warning)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("THIS BUTTON WILL", style = MaterialTheme.typography.labelSmall, color = dex.warning)
                Text(summary, style = MaterialTheme.typography.bodyMedium)
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { onAnswer(true) }, colors = ButtonDefaults.buttonColors(containerColor = dex.warning, contentColor = MaterialTheme.colorScheme.surface)) {
                        Icon(Icons.Rounded.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Confirm", modifier = Modifier.padding(start = 6.dp))
                    }
                    TextButton(onClick = { onAnswer(false) }) {
                        Icon(Icons.Rounded.Close, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Cancel", modifier = Modifier.padding(start = 6.dp))
                    }
                }
            }
        }
    }
}
