package dev.trydex.android.ui.openui

import android.util.Base64
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.openui.ElementNode
import dev.trydex.openui.FormValidation
import dev.trydex.openui.Js
import dev.trydex.openui.OpenUIRuntime
import dev.trydex.openui.Rule
import dev.trydex.openui.Undefined
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.net.URI

/** What every component in a generated UI can reach (react-lang's contexts and hooks). */
@Immutable
class OpenUIScope(
    val runtime: OpenUIRuntime,
    val streaming: Boolean,
    /** Changes whenever state or queries change; reading it makes a component redraw then. */
    val revision: Long,
    val queryLoading: Boolean,
    val scope: CoroutineScope,
    val onLink: (String) -> Unit,
    /** The card's sources, for `[n]` citations. */
    val sources: List<Source> = emptyList(),
) {
    /** What a button or card does: its plan, a legacy action, or with neither, sends `label` to the chat. */
    fun trigger(label: String, formName: String?, action: Any?) {
        scope.launch { runtime.triggerAction(label, formName, action) }
    }

    fun withSources(sources: List<Source>) = OpenUIScope(runtime, streaming, revision, queryLoading, scope, onLink, sources)
}

@Immutable
data class Source(val url: String?, val title: String, val sourceName: String)

val LocalOpenUI = compositionLocalOf<OpenUIScope> { error("No OpenUI scope") }

/** The enclosing Form's name (useFormName). */
val LocalFormName = compositionLocalOf<String?> { null }

/** The enclosing Form's validation (useFormValidation); null outside a Form. */
val LocalFormValidation = compositionLocalOf<FormValidationState?> { null }

/** A Form's fields, their rules, and the errors shown under them. */
class FormValidationState {
    val errors = mutableStateMapOf<String, String>()
    private val fields = LinkedHashMap<String, Pair<List<Rule>, () -> Any?>>()

    fun register(name: String, rules: List<Rule>, value: () -> Any?) {
        fields[name] = rules to value
    }

    fun unregister(name: String) {
        fields.remove(name)
    }

    fun validateField(name: String, value: Any?, rules: List<Rule>): Boolean {
        val error = FormValidation.validate(value, rules)
        if (error == null) errors.remove(name) else errors[name] = error
        return error == null
    }

    fun clear(name: String) {
        errors.remove(name)
    }

    /** Checks every field at once; false if any fails (they all show their errors). */
    fun validateForm(): Boolean {
        val next = LinkedHashMap<String, String>()
        for ((name, entry) in fields) {
            val raw = entry.second()
            val value = if (raw is Map<*, *> && raw.containsKey("value")) raw["value"] else raw
            FormValidation.validate(value, entry.first)?.let { next[name] = it }
        }
        errors.clear()
        errors.putAll(next)
        return next.isEmpty()
    }
}

/** Typed reads of an element's evaluated props. */
@Immutable
class Props(val node: ElementNode) {
    private val props = node.props
    operator fun get(key: String): Any? = props[key]
    fun has(key: String) = !Js.isNullish(props[key])

    /** A string prop; numbers and booleans read as their text. */
    fun str(key: String): String? = when (val value = props[key]) {
        is String -> value
        is Double -> Js.numberToString(value)
        is Number -> Js.numberToString(value.toDouble())
        is Boolean -> value.toString()
        else -> null
    }

    fun text(key: String): String = str(key) ?: ""
    fun num(key: String): Double? = when (val value = props[key]) {
        is Double -> value.takeUnless { it.isNaN() }
        is Number -> value.toDouble()
        is String -> value.trim().toDoubleOrNull()
        else -> null
    }

    fun bool(key: String): Boolean? = props[key] as? Boolean
    fun node(key: String): ElementNode? = props[key] as? ElementNode

    /** An array prop; a lone value reads as one item and null as none. */
    fun list(key: String): List<Any?> = when (val value = props[key]) {
        null, Undefined -> emptyList()
        is List<*> -> value
        else -> listOf(value)
    }

    fun nodes(key: String): List<ElementNode> = list(key).filterIsInstance<ElementNode>()

    @Suppress("UNCHECKED_CAST")
    fun map(key: String): Map<String, Any?>? = props[key] as? Map<String, Any?>
}

val ElementNode.p: Props get() = Props(this)

/** A value as text the way JS's `String(v)` shows it in a cell; objects show nothing. */
fun cellText(value: Any?): String = when (value) {
    null, Undefined -> ""
    is String -> value
    is Double -> Js.numberToString(value)
    is Number -> Js.numberToString(value.toDouble())
    is Boolean -> value.toString()
    is List<*> -> value.joinToString("") { cellText(it) }
    else -> ""
}

/** renderNode: text, numbers, arrays, and elements render; anything else renders nothing. */
@Composable
fun RenderValue(value: Any?) {
    when (value) {
        null, Undefined -> Unit
        is String -> if (value.isNotEmpty()) Text(value)
        is Double, is Boolean -> Text(cellText(value))
        is List<*> -> value.forEach { RenderValue(it) }
        is ElementNode -> RenderNode(value)
        else -> Unit
    }
}

/** Children in a column with the Card's 12dp gap. */
@Composable
fun RenderChildren(children: List<Any?>, modifier: Modifier = Modifier, gap: Int = 12) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(gap.dp)) {
        children.forEach { RenderValue(it) }
    }
}

/** One element: the library's component for its type, or nothing if there isn't one. */
@Composable
fun RenderNode(node: ElementNode) {
    when (node.typeName) {
        "Card" -> CardRoot(node)
        "CardHeader" -> CardHeader(node)
        "TextContent" -> TextContent(node)
        "MarkDownRenderer" -> MarkDownRenderer(node)
        "Callout" -> Callout(node)
        "TextCallout" -> TextCallout(node)
        "Image" -> ImageView(node)
        "ImageBlock" -> ImageBlock(node)
        "ImageGallery" -> ImageGallery(node)
        "CodeBlock" -> OpenUICode(node)
        "Separator" -> SeparatorView(node)
        "InlineHeader" -> InlineHeader(node)
        "Icon" -> IconView(node)
        "Tag" -> TagView(node)
        "TagBlock" -> TagBlock(node)
        "EntityList" -> EntityList(node)
        "Table" -> TableView(node)
        "EditableTable" -> EditableTable(node)
        "BarChart" -> BarChart(node)
        "LineChart" -> LineChart(node, area = false)
        "AreaChart" -> LineChart(node, area = true)
        "HorizontalBarChart" -> HorizontalBarChart(node)
        "RadarChart" -> RadarChart(node)
        "PieChart" -> PieChart(node)
        "RadialChart" -> RadialChart(node)
        "SingleStackedBarChart" -> SingleStackedBarChart(node)
        "ScatterChart" -> ScatterChart(node)
        "Button" -> ButtonView(node)
        "Buttons" -> ButtonsView(node)
        "IconButton" -> IconButtonView(node)
        "ListBlock" -> ListBlockView(node)
        "FollowUpBlock" -> FollowUpBlock(node)
        "Form" -> FormView(node)
        "FormControl" -> FormControl(node)
        "Label" -> LabelView(node)
        "Input" -> InputView(node, multiline = false)
        "TextArea" -> InputView(node, multiline = true)
        "Select" -> SelectView(node)
        "DatePicker" -> DatePickerView(node)
        "Slider" -> SliderView(node)
        "CheckBoxGroup" -> CheckBoxGroup(node)
        "RadioGroup" -> RadioGroup(node)
        "SwitchGroup" -> SwitchGroup(node)
        "Chips" -> ChipsView(node)
        "OptionCards" -> OptionCards(node)
        "SectionBlock" -> SectionBlock(node)
        "Tabs" -> TabsView(node)
        "Accordion" -> AccordionView(node)
        "Steps" -> StepsView(node)
        "Carousel" -> CarouselView(node)
        "SnippetCardBlock" -> SnippetCardBlock(node)
        "OverviewCardBlock" -> OverviewCardBlock(node)
        "ContextCardBlock" -> ContextCardBlock(node)
        "CompositeCardBlock" -> CompositeCardBlock(node)
        "VisualCardBlock" -> VisualCardBlock(node)
        "Text" -> TextLine(node, bold = false)
        "BoldText" -> TextLine(node, bold = true)
        "IconText" -> IconText(node)
        "ImageText" -> ImageText(node)
        "ImageTextLarge" -> ImageTextLarge(node)
        "MetricIndicatorInline" -> MetricInline(node)
        "MetricIndicatorWithStrikethrough" -> MetricStrikethrough(node)
        // Data-only children (Col, Series, SelectItem, …) render through their parents.
        else -> Unit
    }
}

// ── Look ─────────────────────────────────────────────────────────────────────

/** A status tone: a strong colour for bars and titles, and a container pair for pills and badges. */
@Immutable
data class Tone(val accent: Color, val container: Color, val content: Color)

/** info, success, warning, danger (error), or neutral; null for anything else. */
@Composable
fun tone(variant: String?): Tone? {
    val dex = DexTheme.colors
    val scheme = MaterialTheme.colorScheme
    return when (variant) {
        "info" -> Tone(dex.info, dex.infoContainer, dex.onInfoContainer)
        "success" -> Tone(dex.success, dex.successContainer, dex.onSuccessContainer)
        "warning" -> Tone(dex.warning, dex.warningContainer, dex.onWarningContainer)
        "danger", "error" -> Tone(scheme.error, scheme.errorContainer, scheme.onErrorContainer)
        "neutral" -> Tone(scheme.onSurface, scheme.surfaceContainerHighest, scheme.onSurface)
        else -> null
    }
}

// ── Images ───────────────────────────────────────────────────────────────────

private val TRUSTED_IMAGE_HOSTS = setOf("avatars.githubusercontent.com", "i.ytimg.com")

/**
 * What an image may load, as the web's Content Security Policy allows (`img-src 'self' data: blob:` plus GitHub avatars
 * and YouTube thumbnails): Dex's own paths, inline data, and those two hosts. Anything else could leak chat content
 * through its URL, so it doesn't load (null).
 */
@Composable
fun rememberImageModel(src: String?): Any? {
    val server = LocalApp.current.graph.repository.session.value?.serverUrl
    return remember(src, server) { imageModel(src, server?.toString()) }
}

fun imageModel(src: String?, server: String?): Any? {
    val clean = src?.trim()?.filter { it >= ' ' && it != '\u007f' } ?: return null
    if (clean.isEmpty()) return null
    if (clean.startsWith("data:image/")) {
        val comma = clean.indexOf(',')
        if (comma < 0 || !clean.substring(0, comma).endsWith(";base64")) return null
        return runCatching { Base64.decode(clean.substring(comma + 1), Base64.DEFAULT) }.getOrNull()
    }
    if (clean.startsWith("/") && !clean.startsWith("//")) return server?.let { runCatching { URI(it).resolve(clean).toString() }.getOrNull() }
    val uri = runCatching { URI(clean) }.getOrNull() ?: return null
    if (uri.scheme != "https" && uri.scheme != "http") return null
    val own = server?.let { runCatching { URI(it) }.getOrNull() }
    if (own != null && uri.scheme == own.scheme && uri.host == own.host && uri.port == own.port) return clean
    return if (uri.scheme == "https" && uri.host in TRUSTED_IMAGE_HOSTS) clean else null
}

/** Only web links open: `javascript:`, `data:`, `file:` and the rest are ignored. */
fun safeLink(url: String?): String? {
    val clean = url?.trim()?.filter { it >= ' ' } ?: return null
    val scheme = runCatching { URI(clean).scheme?.lowercase() }.getOrNull()
    return clean.takeIf { scheme == "http" || scheme == "https" }
}
