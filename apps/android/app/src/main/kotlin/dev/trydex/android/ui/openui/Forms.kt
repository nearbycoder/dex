package dev.trydex.android.ui.openui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextObfuscationMode
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.OutlinedSecureTextField
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberDateRangePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.trydex.openui.ActionPlan
import dev.trydex.openui.ActionStep
import dev.trydex.openui.ElementNode
import dev.trydex.openui.FormValidation
import dev.trydex.openui.Js
import dev.trydex.openui.Rule
import dev.trydex.openui.StateField
import dev.trydex.openui.Undefined
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt

// ── Fields ───────────────────────────────────────────────────────────────────

/** A field bound to its `$variable` or stored in its form (useStateField). */
@Composable
private fun rememberField(p: Props, componentType: String? = null): StateField {
    val ui = LocalOpenUI.current
    val form = LocalFormName.current
    // Reading the revision redraws the field when state changes.
    ui.revision
    return ui.runtime.stateField(p.text("name"), p["value"], form, componentType)
}

/** Registers a field's rules with its Form, so the form's primary button checks them. */
@Composable
private fun RegisterRules(name: String, rules: List<Rule>, value: Any?) {
    val ui = LocalOpenUI.current
    val validation = LocalFormValidation.current
    val current by rememberUpdatedState(value)
    DisposableEffect(validation, name, rules, ui.streaming) {
        if (validation != null && rules.isNotEmpty() && !ui.streaming) validation.register(name, rules) { current }
        onDispose { validation?.unregister(name) }
    }
}

@Composable
private fun rulesOf(p: Props): List<Rule> {
    val raw = p["rules"]
    return remember(Js.stableStringify(raw)) { FormValidation.parse(raw) }
}

private fun ElementNode.required() = (props["rules"] as? Map<*, *>)?.get("required") == true

// ── Form ─────────────────────────────────────────────────────────────────────

@Composable
fun FormView(node: ElementNode) {
    val p = node.p
    val name = p.text("name")
    val validation = remember(name) { FormValidationState() }
    CompositionLocalProvider(LocalFormName provides name, LocalFormValidation provides validation) {
        Column(Modifier.fillMaxWidth().semantics { contentDescription = "Form $name" }, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            p.list("fields").forEach { RenderValue(it) }
            RenderValue(p["buttons"])
        }
    }
}

@Composable
fun FormControl(node: ElementNode) {
    val p = node.p
    val input = p.node("input")
    val validation = LocalFormValidation.current
    val error = input?.let { validation?.errors?.get(it.p.text("name")) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            p.text("label") + if (input?.required() == true) " *" else "",
            style = MaterialTheme.typography.labelLarge,
        )
        if (input != null) RenderNode(input)
        when {
            error != null -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(16.dp))
                Text(error, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("field-error"))
            }
            !p.str("hint").isNullOrEmpty() -> Text(p.text("hint"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun LabelView(node: ElementNode) {
    Text(node.p.text("text"), style = MaterialTheme.typography.bodyLarge)
}

// ── Text inputs ──────────────────────────────────────────────────────────────

@Composable
fun InputView(node: ElementNode, multiline: Boolean) {
    val ui = LocalOpenUI.current
    val p = node.p
    val name = p.text("name")
    val field = rememberField(p)
    val rules = rulesOf(p)
    val validation = LocalFormValidation.current
    RegisterRules(name, rules, field.value)
    val external = if (Js.isNullish(field.value)) "" else Js.toStr(field.value)
    val state = rememberTextFieldState(external)
    val latest by rememberUpdatedState(field)
    // State changed elsewhere (@Set, @Reset, a restore): show it.
    LaunchedEffect(external) {
        if (state.text.toString() != external) state.setTextAndPlaceCursorAtEnd(external)
    }
    LaunchedEffect(state) {
        snapshotFlow { state.text.toString() }.collect { text ->
            val stored = latest.value
            if (text != (if (Js.isNullish(stored)) "" else Js.toStr(stored))) {
                validation?.clear(name)
                latest.setValue(text)
            }
        }
    }
    val type = p.str("type") ?: "text"
    val modifier = Modifier.fillMaxWidth().testTag("input-$name").onFocusChanged { focus ->
        if (!focus.isFocused && validation != null && rules.isNotEmpty() && !ui.streaming) validation.validateField(name, latest.value, rules)
    }
    val placeholder: @Composable (() -> Unit)? = p.str("placeholder")?.takeIf { it.isNotEmpty() }?.let { { Text(it) } }
    val error = validation?.errors?.containsKey(name) == true
    if (type == "password" && !multiline) {
        var reveal by remember { mutableStateOf(false) }
        OutlinedSecureTextField(
            state = state,
            enabled = !ui.streaming,
            placeholder = placeholder,
            isError = error,
            textObfuscationMode = if (reveal) TextObfuscationMode.Visible else TextObfuscationMode.RevealLastTyped,
            trailingIcon = {
                IconButton(onClick = { reveal = !reveal }) {
                    Icon(if (reveal) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, contentDescription = if (reveal) "Hide" else "Show")
                }
            },
            shape = RoundedCornerShape(12.dp),
            modifier = modifier,
        )
    } else {
        OutlinedTextField(
            state = state,
            enabled = !ui.streaming,
            placeholder = placeholder,
            isError = error,
            lineLimits = if (multiline) {
                val rows = (p.num("rows") ?: 3.0).toInt().coerceIn(1, 20)
                TextFieldLineLimits.MultiLine(minHeightInLines = rows, maxHeightInLines = max(rows, 8))
            } else TextFieldLineLimits.SingleLine,
            keyboardOptions = KeyboardOptions(
                keyboardType = when (type) {
                    "email" -> KeyboardType.Email
                    "number" -> KeyboardType.Decimal
                    "url" -> KeyboardType.Uri
                    else -> KeyboardType.Text
                },
            ),
            shape = RoundedCornerShape(12.dp),
            modifier = modifier,
        )
    }
}

// ── Select ───────────────────────────────────────────────────────────────────

@Composable
fun SelectView(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val name = p.text("name")
    val field = rememberField(p)
    val rules = rulesOf(p)
    val validation = LocalFormValidation.current
    RegisterRules(name, rules, field.value)
    val items = p.nodes("items").mapNotNull { item ->
        val value = item.p.str("value")?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
        value to (item.p.str("label")?.takeIf { it.isNotEmpty() } ?: value)
    }
    val selected = if (Js.isNullish(field.value)) "" else Js.toStr(field.value)
    var open by remember { mutableStateOf(false) }
    val text = rememberTextFieldState()
    val label = items.firstOrNull { it.first == selected }?.second ?: selected
    LaunchedEffect(label) { text.setTextAndPlaceCursorAtEnd(label) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { if (!ui.streaming) open = it }) {
        OutlinedTextField(
            state = text,
            readOnly = true,
            enabled = !ui.streaming,
            placeholder = { Text(p.str("placeholder") ?: "Select…") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            isError = validation?.errors?.containsKey(name) == true,
            lineLimits = TextFieldLineLimits.SingleLine,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).testTag("select-$name"),
        )
        androidx.compose.material3.DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.exposedDropdownSize()) {
            items.forEach { (value, itemLabel) ->
                DropdownMenuItem(
                    text = { Text(itemLabel) },
                    trailingIcon = { if (value == selected) Icon(Icons.Rounded.Check, contentDescription = "Selected") },
                    onClick = {
                        open = false
                        field.setValue(value)
                        if (validation != null && rules.isNotEmpty()) validation.validateField(name, value, rules)
                    },
                    contentPadding = ExposedDropdownMenuDefaults.ItemContentPadding,
                )
            }
        }
    }
}

// ── Dates ────────────────────────────────────────────────────────────────────

private val ISO: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)
private val DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.getDefault())

/** A day as the web stores a picked Date: local midnight, as an ISO instant. */
private fun isoOf(day: LocalDate): String = ISO.format(day.atStartOfDay(ZoneId.systemDefault()).toInstant())

private fun dayOf(value: Any?): LocalDate? {
    val text = (value as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return runCatching { Instant.parse(text).atZone(ZoneId.systemDefault()).toLocalDate() }.getOrNull()
        ?: runCatching { LocalDate.parse(text.take(10)) }.getOrNull()
}

/** The picker's UTC-midnight millis for a day, and back. */
private fun millisOf(day: LocalDate) = day.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
private fun dayOfMillis(ms: Long) = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate()

@Composable
fun DatePickerView(node: ElementNode) {
    val p = node.p
    val name = p.text("name")
    val range = p.str("mode") == "range"
    val field = rememberField(p)
    val rules = rulesOf(p)
    val validation = LocalFormValidation.current
    RegisterRules(name, rules, field.value)
    var open by remember { mutableStateOf(false) }
    val value = field.value
    val label = if (range) {
        val map = value as? Map<*, *>
        val from = dayOf(map?.get("from"))
        val to = dayOf(map?.get("to"))
        when {
            from == null -> null
            to == null || to == from -> from.format(DATE)
            else -> "${from.format(DATE)} – ${to.format(DATE)}"
        }
    } else dayOf(value)?.format(DATE)
    fun commit(next: Any?) {
        field.setValue(next ?: Undefined)
        if (validation != null && rules.isNotEmpty()) validation.validateField(name, next, rules)
    }
    Surface(
        onClick = { open = true },
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, if (validation?.errors?.containsKey(name) == true) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline),
        color = Color.Transparent,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("date-$name"),
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                label ?: if (range) "Select a range" else "Select a date",
                style = MaterialTheme.typography.bodyLarge,
                color = if (label == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Icon(Icons.Outlined.CalendarMonth, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    if (!open) return
    if (range) {
        val map = value as? Map<*, *>
        val state = rememberDateRangePickerState(
            initialSelectedStartDateMillis = dayOf(map?.get("from"))?.let(::millisOf),
            initialSelectedEndDateMillis = dayOf(map?.get("to"))?.let(::millisOf),
        )
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    open = false
                    val from = state.selectedStartDateMillis?.let(::dayOfMillis)
                    val to = state.selectedEndDateMillis?.let(::dayOfMillis) ?: from
                    commit(from?.let { linkedMapOf("from" to isoOf(it), "to" to isoOf(to!!)) })
                }) { Text("Done") }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
        ) { DateRangePicker(state, modifier = Modifier.weight(1f)) }
    } else {
        val state = rememberDatePickerState(initialSelectedDateMillis = dayOf(value)?.let(::millisOf))
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    open = false
                    commit(state.selectedDateMillis?.let { isoOf(dayOfMillis(it)) })
                }) { Text("Done") }
            },
            dismissButton = {
                Row {
                    if (value != null && value !== Undefined) TextButton(onClick = { open = false; commit(null) }) { Text("Clear") }
                    TextButton(onClick = { open = false }) { Text("Cancel") }
                }
            },
        ) { DatePicker(state) }
    }
}

// ── Slider ───────────────────────────────────────────────────────────────────

@Composable
fun SliderView(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val name = p.text("name")
    val field = rememberField(p)
    val rules = rulesOf(p)
    val validation = LocalFormValidation.current
    RegisterRules(name, rules, (field.value as? List<*>)?.firstOrNull())
    val min = p.num("min") ?: 0.0
    val maxValue = (p.num("max") ?: 100.0).let { if (it <= min) min + 1 else it }
    val discrete = p.str("variant") == "discrete"
    val step = if (discrete) (p.num("step") ?: 1.0) else max(1.0, p.num("step") ?: 1.0)
    val stored = (field.value as? List<*>)?.mapNotNull { (it as? Double) }
        ?: (p["defaultValue"] as? List<*>)?.mapNotNull { it as? Double }
        ?: listOf(min)
    val isRange = stored.size >= 2
    var local by remember(stored) { mutableStateOf(stored.map { it.toFloat() }) }
    fun snap(v: Float) = (min + ((v - min) / step).roundToInt() * step).coerceIn(min, maxValue)
    fun commit() {
        val values = local.map { snap(it) }
        field.setValue(values)
        if (validation != null && rules.isNotEmpty()) validation.validateField(name, values.firstOrNull(), rules)
    }
    val stops = ((maxValue - min) / step).roundToInt()
    val steps = if (discrete && stops in 2..40) stops - 1 else 0
    Column(Modifier.fillMaxWidth().testTag("slider-$name")) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(p.str("label")?.takeIf { it.isNotEmpty() } ?: name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            if (!ui.streaming) {
                Text(
                    local.joinToString(" – ") { formatSliderValue(snap(it)) },
                    style = MaterialTheme.typography.titleSmall.copy(fontFeatureSettings = "tnum"),
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
        if (isRange) {
            RangeSlider(
                value = local[0]..local[1],
                onValueChange = { local = listOf(it.start, it.endInclusive) },
                onValueChangeFinished = { commit() },
                valueRange = min.toFloat()..maxValue.toFloat(),
                steps = steps,
                enabled = !ui.streaming,
            )
        } else {
            Slider(
                value = local.firstOrNull() ?: min.toFloat(),
                onValueChange = { local = listOf(it) },
                onValueChangeFinished = { commit() },
                valueRange = min.toFloat()..maxValue.toFloat(),
                steps = steps,
                enabled = !ui.streaming,
            )
        }
        Row(Modifier.fillMaxWidth()) {
            Text(formatSliderValue(min), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            Text(formatSliderValue(maxValue), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun formatSliderValue(value: Double): String =
    if (kotlin.math.abs(value) >= 1000) Js.numberToString((value / 100).roundToInt() / 10.0) + "k" else Js.numberToString(value)

// ── Choices ──────────────────────────────────────────────────────────────────

/** Each item's checked state: what's stored, else its default. */
private fun aggregate(items: List<ElementNode>, stored: Any?): LinkedHashMap<String, Boolean> {
    val map = stored as? Map<*, *>
    val result = LinkedHashMap<String, Boolean>()
    items.forEach { item ->
        val key = item.p.text("name")
        result[key] = (map?.get(key) as? Boolean) ?: item.p.bool("defaultChecked") ?: false
    }
    return result
}

@Composable
fun CheckBoxGroup(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val name = p.text("name")
    val items = p.nodes("items")
    if (items.isEmpty()) return
    val field = rememberField(p)
    val rules = rulesOf(p)
    val validation = LocalFormValidation.current
    RegisterRules(name, rules, field.value)
    val values = aggregate(items, field.value)
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        items.forEach { item ->
            val key = item.p.text("name")
            val checked = values[key] == true
            ChoiceRow(
                title = item.p.text("label"),
                description = item.p.str("description"),
                modifier = Modifier.toggleable(checked, enabled = !ui.streaming, role = Role.Checkbox) { on ->
                    val next = LinkedHashMap(values).apply { put(key, on) }
                    field.setValue(next)
                    if (validation != null && rules.isNotEmpty()) validation.validateField(name, next, rules)
                },
            ) { Checkbox(checked = checked, onCheckedChange = null, enabled = !ui.streaming) }
        }
    }
}

@Composable
fun RadioGroup(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val name = p.text("name")
    val items = p.nodes("items")
    val field = rememberField(p)
    val rules = rulesOf(p)
    val validation = LocalFormValidation.current
    RegisterRules(name, rules, field.value)
    val current = if (Js.isNullish(field.value)) p.str("defaultValue") else Js.toStr(field.value)
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        items.forEach { item ->
            val value = item.p.text("value")
            ChoiceRow(
                title = item.p.text("label"),
                description = item.p.str("description"),
                modifier = Modifier.selectable(value == current, enabled = !ui.streaming, role = Role.RadioButton) {
                    field.setValue(value)
                    if (validation != null && rules.isNotEmpty()) validation.validateField(name, value, rules)
                },
            ) { RadioButton(selected = value == current, onClick = null, enabled = !ui.streaming) }
        }
    }
}

@Composable
private fun ChoiceRow(title: String, description: String?, modifier: Modifier, control: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip12().then(modifier).padding(vertical = 6.dp, horizontal = 4.dp),
        verticalAlignment = if (description.isNullOrEmpty()) Alignment.CenterVertically else Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) { control() }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (!description.isNullOrEmpty()) Text(description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun Modifier.clip12() = this.clip(RoundedCornerShape(12.dp))

@Composable
fun SwitchGroup(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val items = p.nodes("items")
    val field = rememberField(p)
    val values = aggregate(items, field.value)
    val content: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            items.forEach { item ->
                val key = item.p.text("name")
                val checked = values[key] == true
                Row(
                    Modifier.fillMaxWidth().clip12().toggleable(checked, enabled = !ui.streaming, role = Role.Switch) { on ->
                        field.setValue(LinkedHashMap(values).apply { put(key, on) })
                    }.padding(vertical = 6.dp, horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        item.p.str("label")?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
                        item.p.str("description")?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    Switch(checked = checked, onCheckedChange = null, enabled = !ui.streaming)
                }
            }
        }
    }
    when (p.str("variant")) {
        "card", "sunk" -> Surface(
            shape = RoundedCornerShape(16.dp),
            color = if (p.str("variant") == "sunk") MaterialTheme.colorScheme.surfaceContainerHigh else Color.Transparent,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth(),
        ) { Box(Modifier.padding(12.dp)) { content() } }
        else -> content()
    }
}

/** Chips and OptionCards: the selection as stored (one value, or a list), with the default written after streaming. */
@Composable
private fun rememberSelection(p: Props, componentType: String): Triple<List<String>, (String) -> Unit, Boolean> {
    val ui = LocalOpenUI.current
    val form = LocalFormName.current
    val name = p.text("name")
    val multiple = p.str("type") == "multiple"
    ui.revision
    val stored = ui.runtime.fieldValue(form, name)
    val default = p["defaultValue"]
    val defaultValue: Any? = when {
        Js.isNullish(default) -> null
        multiple -> (default as? List<*>)?.map { Js.toStr(it) } ?: listOf(Js.toStr(default))
        else -> (default as? List<*>)?.firstOrNull()?.let { Js.toStr(it) } ?: Js.toStr(default)
    }
    LaunchedEffect(ui.streaming, stored === Undefined) {
        if (!ui.streaming && stored === Undefined && defaultValue != null) ui.runtime.setFieldValue(form, componentType, name, defaultValue)
    }
    val rules = rulesOf(p)
    val validation = LocalFormValidation.current
    RegisterRules(name, rules, stored)
    val selected: List<String> = when (stored) {
        is List<*> -> stored.map { Js.toStr(it) }
        is String -> listOf(stored)
        else -> emptyList()
    }
    val onTap: (String) -> Unit = { value ->
        if (!ui.streaming) {
            val next: Any? = if (multiple) {
                if (value in selected) selected - value else selected + value
            } else {
                if (selected.firstOrNull() == value) Undefined else value
            }
            ui.runtime.setFieldValue(form, componentType, name, next)
            if (validation != null && rules.isNotEmpty()) {
                validation.validateField(name, if (next is List<*> && next.isEmpty()) Undefined else next, rules)
            }
        }
    }
    return Triple(selected, onTap, multiple)
}

@Composable
fun ChipsView(node: ElementNode) {
    val p = node.p
    val (selected, onTap, _) = rememberSelection(p, "Chips")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        p.nodes("items").forEach { item ->
            val value = item.p.text("value")
            val on = value in selected
            FilterChip(
                selected = on,
                onClick = { onTap(value) },
                enabled = item.p.bool("disabled") != true,
                label = { Text(item.p.str("label") ?: value, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                leadingIcon = when {
                    on -> ({ Icon(Icons.Rounded.Check, contentDescription = null, modifier = Modifier.size(18.dp)) })
                    item.p.node("icon") != null -> ({ IconView(item.p.node("icon")!!, 18) })
                    else -> null
                },
                modifier = Modifier.testTag("chip-$value"),
            )
        }
    }
}

@Composable
fun OptionCards(node: ElementNode) {
    val p = node.p
    val (selected, onTap, _) = rememberSelection(p, "OptionCards")
    val items = p.nodes("items")
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val columns = when {
            maxWidth <= 480.dp -> 1
            maxWidth <= 768.dp -> 2
            else -> 3
        }
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items.chunked(columns).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    row.forEach { item ->
                        val value = item.p.text("value")
                        val on = value in selected
                        val disabled = item.p.bool("disabled") == true
                        Surface(
                            onClick = { onTap(value) },
                            enabled = !disabled,
                            shape = RoundedCornerShape(16.dp),
                            color = if (on) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent,
                            border = BorderStroke(if (on) 2.dp else 1.dp, if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
                            modifier = Modifier.weight(1f).alpha(if (disabled) 0.5f else 1f).testTag("option-$value"),
                        ) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                item.p.node("topContent")?.let { top ->
                                    if (top.typeName == "Image" || top.props["src"] is String) {
                                        PolicyImage(top.p.str("src"), top.p.str("alt"), Modifier.size(72.dp).clip12())
                                    } else {
                                        Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
                                            Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceContainerHighest, modifier = Modifier.size(36.dp)) {
                                                Box(contentAlignment = Alignment.Center) { IconView(top, 18) }
                                            }
                                        }
                                    }
                                }
                                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    InlineMarkdown(item.p.text("title"), MaterialTheme.typography.titleSmall)
                                    item.p.str("subtitle")?.takeIf { it.isNotEmpty() }?.let { InlineMarkdown(it, MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                }
                            }
                        }
                    }
                    // An odd last card on a two-column row spans both, as the web's grid does.
                    if (row.size < columns && columns == 3) repeat(columns - row.size) { Box(Modifier.weight(1f)) }
                }
            }
        }
    }
}

// ── Buttons ──────────────────────────────────────────────────────────────────

/** Whether a plan needs the form to be valid before it runs (it sends, runs a custom action, or a mutation). */
private fun needsValid(action: Any?): Boolean = when (action) {
    is ActionPlan -> action.steps.any { it is ActionStep.ToAssistant || it is ActionStep.Custom || (it is ActionStep.Run && it.refType == "mutation") }
    else -> true
}

@Composable
fun ButtonView(node: ElementNode, sizeOverride: String? = null, fill: Boolean = false) {
    val ui = LocalOpenUI.current
    val p = node.p
    val label = p.text("label")
    val form = LocalFormName.current
    val validation = LocalFormValidation.current
    val variant = p.str("variant") ?: "primary"
    val destructive = p.str("type") == "destructive"
    val action = p["action"]
    val onClick = {
        if (validation == null || variant != "primary" || !needsValid(action) || validation.validateForm()) {
            ui.trigger(label, form, action.takeUnless { it === Undefined })
        }
    }
    val (height, padding) = when (sizeOverride ?: p.str("size")) {
        "extra-small" -> 32.dp to PaddingValues(horizontal = 12.dp)
        "small" -> 36.dp to PaddingValues(horizontal = 14.dp)
        "large" -> 48.dp to PaddingValues(horizontal = 20.dp)
        else -> 40.dp to PaddingValues(horizontal = 16.dp)
    }
    val modifier = Modifier.heightIn(min = height).then(if (fill) Modifier.fillMaxWidth() else Modifier).testTag("openui-button")
    val content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = { Text(label, maxLines = 2, overflow = TextOverflow.Ellipsis) }
    val error = MaterialTheme.colorScheme.error
    when (variant) {
        "secondary" -> OutlinedButton(
            onClick = onClick, enabled = !ui.streaming, modifier = modifier, contentPadding = padding,
            colors = if (destructive) ButtonDefaults.outlinedButtonColors(contentColor = error) else ButtonDefaults.outlinedButtonColors(),
            border = if (destructive) BorderStroke(1.dp, error.copy(alpha = 0.5f)) else ButtonDefaults.outlinedButtonBorder(!ui.streaming),
            content = content,
        )
        "tertiary" -> TextButton(
            onClick = onClick, enabled = !ui.streaming, modifier = modifier, contentPadding = padding,
            colors = if (destructive) ButtonDefaults.textButtonColors(contentColor = error) else ButtonDefaults.textButtonColors(),
            content = content,
        )
        else -> Button(
            onClick = onClick, enabled = !ui.streaming, modifier = modifier, contentPadding = padding,
            colors = if (destructive) ButtonDefaults.buttonColors(containerColor = error, contentColor = MaterialTheme.colorScheme.onError) else ButtonDefaults.buttonColors(),
            content = content,
        )
    }
}

@Composable
fun ButtonsView(node: ElementNode) {
    val p = node.p
    val buttons = p.nodes("buttons")
    if (p.str("direction") == "column") {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            buttons.forEach { if (it.typeName == "Button") ButtonView(it, fill = true) else RenderNode(it) }
        }
    } else {
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            buttons.forEach { RenderNode(it) }
        }
    }
}

@Composable
fun IconButtonView(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val name = p.text("name")
    val form = LocalFormName.current
    val icon = p.node("icon")
    val onClick = { ui.trigger(name, form, p["action"].takeUnless { it === Undefined }) }
    val size = when (p.str("size")) {
        "extra-small" -> 32.dp
        "small" -> 36.dp
        "large" -> 48.dp
        else -> 40.dp
    }
    val shape = if (p.str("shape") == "circle") CircleShape else RoundedCornerShape(12.dp)
    val modifier = Modifier.size(size).semantics { contentDescription = name }.testTag("openui-icon-button")
    val glyph: @Composable () -> Unit = { if (icon != null) IconView(icon, 20) }
    when (p.str("variant")) {
        "primary" -> FilledIconButton(onClick = onClick, enabled = !ui.streaming, shape = shape, modifier = modifier) { glyph() }
        "tertiary" -> IconButton(onClick = onClick, enabled = !ui.streaming, shape = shape, modifier = modifier) { glyph() }
        else -> OutlinedIconButton(onClick = onClick, enabled = !ui.streaming, shape = shape, modifier = modifier) { glyph() }
    }
}
