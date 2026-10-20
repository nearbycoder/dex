package dev.trydex.android.ui.openui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.TextFields
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ChevronLeft
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.trydex.android.ui.components.TableGrid
import dev.trydex.openui.ElementNode
import dev.trydex.openui.Js
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
private fun RowBackground(row: Int, last: Boolean) {
    val line = MaterialTheme.colorScheme.outlineVariant
    val stripe = MaterialTheme.colorScheme.surfaceContainerLow
    Box(
        Modifier.background(
            when {
                row == 0 -> MaterialTheme.colorScheme.surfaceContainerHigh
                row % 2 == 0 -> stripe
                else -> Color.Transparent
            },
        ).drawBehind {
            if (!last) drawLine(line, Offset(0f, size.height - 0.5f), Offset(size.width, size.height - 0.5f), strokeWidth = 1f)
        },
    )
}

/** A bordered box that scrolls sideways and is at least as wide as its container. */
@Composable
private fun TableFrame(content: @Composable (minWidth: Dp) -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    BoxWithConstraints(Modifier.fillMaxWidth().clip(shape).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape)) {
        val width = maxWidth
        Box(Modifier.horizontalScroll(rememberScrollState())) { content(width) }
    }
}

@Composable
fun TableView(node: ElementNode) {
    val ui = LocalOpenUI.current
    val columns = node.p.nodes("columns").filter { it.typeName == "Col" }
    if (columns.isEmpty()) return
    val data = columns.map { col ->
        when (val raw = col.props["data"]) {
            null, dev.trydex.openui.Undefined -> emptyList()
            is List<*> -> raw
            else -> listOf(raw)
        }
    }
    val rowCount = data.maxOf { it.size }
    if (rowCount == 0 && ui.queryLoading) {
        TableSkeleton(maxOf(columns.size, 3))
        return
    }
    val pageSize = 10
    val pages = maxOf(1, (rowCount + pageSize - 1) / pageSize)
    var page by remember { mutableIntStateOf(0) }
    if (page >= pages) page = pages - 1
    val start = page * pageSize
    val shown = minOf(pageSize, rowCount - start)
    Column(Modifier.fillMaxWidth().testTag("openui-table"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TableFrame { minWidth ->
            TableGrid(
                rows = shown + 1,
                columns = columns.size,
                modifier = Modifier.widthIn(min = minWidth),
                fitWidth = minWidth,
                rowBackground = { r -> RowBackground(r, r == shown) },
            ) { r, c ->
                Box(Modifier.widthIn(max = 360.dp).padding(horizontal = 14.dp, vertical = 12.dp)) {
                    if (r == 0) {
                        Text(columns[c].p.text("label"), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    } else {
                        when (val value = data[c].getOrNull(start + r - 1)) {
                            is ElementNode -> RenderNode(value)
                            is List<*> -> Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { value.forEach { if (it is ElementNode) RenderNode(it) else Text(cellText(it), style = MaterialTheme.typography.bodyMedium, maxLines = 1) } }
                            else -> Text(cellText(value), style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
        }
        if (pages > 1) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { page-- }, enabled = page > 0) { Icon(Icons.Rounded.ChevronLeft, contentDescription = "Previous page") }
                Text("${page + 1} / $pages", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                IconButton(onClick = { page++ }, enabled = page < pages - 1) { Icon(Icons.Rounded.ChevronRight, contentDescription = "Next page") }
            }
        }
    }
}

@Composable
private fun TableSkeleton(columns: Int) {
    val pulse by rememberInfiniteTransition(label = "table").animateFloat(0.3f, 0.85f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "pulse")
    val shape = RoundedCornerShape(16.dp)
    Column(Modifier.fillMaxWidth().clip(shape).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape).padding(12.dp).semanticsBusy(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        for (r in 0..5) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                for (c in 0 until columns) {
                    val fraction = if (r == 0) 0.6f else (50 + ((r * 7 + c * 13) % 40)) / 100f
                    Box(Modifier.weight(1f)) {
                        Box(Modifier.fillMaxWidth(fraction).height(14.dp).alpha(pulse).clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest))
                    }
                }
            }
        }
    }
}

private fun Modifier.semanticsBusy() = this.then(Modifier.testTag("openui-table-loading"))

// ── EditableTable ────────────────────────────────────────────────────────────

private data class EditColumn(val type: String, val key: String, val header: String, val width: Int?, val options: List<Pair<String, String>>)

private data class EditCell(val row: Int, val column: Int)

private val DATE_LABEL: DateTimeFormatter = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.getDefault())

private fun dateOf(value: Any?): LocalDate? {
    val text = (value as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return runCatching { Instant.parse(text).atZone(ZoneOffset.UTC).toLocalDate() }.getOrNull()
        ?: runCatching { LocalDate.parse(text.take(10)) }.getOrNull()
}

/** A table whose cells you can edit, saved together with "Save changes" (sent as the form `name`). */
@Composable
fun EditableTable(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val name = p.text("name")
    val columns = p.list("columns").mapNotNull { raw ->
        val map = raw as? Map<*, *> ?: return@mapNotNull null
        EditColumn(
            type = map["type"] as? String ?: "text",
            key = map["key"] as? String ?: "default",
            header = map["header"] as? String ?: "",
            width = (map["width"] as? Double)?.toInt(),
            options = (map["options"] as? List<*>)?.mapNotNull { o -> (o as? Map<*, *>)?.let { (it["value"] as? String ?: return@let null) to (it["label"] as? String ?: it["value"] as String) } } ?: emptyList(),
        )
    }
    // Rows as the program wrote them, or as last saved.
    val saved = ui.runtime.fieldValue(name, name) as? List<*>
    val source = (saved ?: p.list("data")).mapNotNull { raw ->
        val map = raw as? Map<*, *> ?: return@mapNotNull null
        val id = Js.toStr(map["id"] ?: "")
        val values = map["values"] as? List<*> ?: emptyList<Any?>()
        id to columns.indices.map { values.getOrNull(it) }
    }
    var rows by remember(source) { mutableStateOf(source) }
    var baseline by remember(source, ui.streaming) { mutableStateOf(source) }
    var editing by remember { mutableStateOf<EditCell?>(null) }
    val changes = rows.sumOf { (id, values) ->
        val before = baseline.firstOrNull { it.first == id }?.second
        values.indices.count { before == null || !Js.same(before.getOrNull(it), values[it]) }
    }
    Column(Modifier.fillMaxWidth().testTag("openui-editable-table"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TableFrame { minWidth ->
            TableGrid(
                rows = rows.size + 1,
                columns = columns.size,
                modifier = Modifier.widthIn(min = minWidth),
                columnWidths = columns.map { (it.width ?: 140).dp },
                rowBackground = { r -> RowBackground(r, r == rows.size) },
            ) { r, c ->
                val column = columns[c]
                if (r == 0) {
                    Row(Modifier.height(48.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(column.header, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Icon(
                            when (column.type) {
                                "url" -> Icons.Outlined.Link
                                "date-single" -> Icons.Outlined.CalendarMonth
                                "select" -> Icons.AutoMirrored.Outlined.List
                                else -> Icons.Outlined.TextFields
                            },
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    val value = rows[r - 1].second.getOrNull(c)
                    val label = when (column.type) {
                        "date-single" -> dateOf(value)?.format(DATE_LABEL) ?: ""
                        "select" -> column.options.firstOrNull { it.first == value }?.second ?: cellText(value)
                        else -> cellText(value)
                    }
                    Row(
                        Modifier.fillMaxWidth().height(48.dp).clickable { editing = EditCell(r - 1, c) }.padding(horizontal = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (column.type == "url" && label.isNotEmpty()) Icon(Icons.Outlined.Link, contentDescription = null, modifier = Modifier.size(14.dp).padding(end = 2.dp), tint = MaterialTheme.colorScheme.primary)
                        Text(
                            label,
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (column.type == "url") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            textAlign = if (column.type == "number") TextAlign.End else TextAlign.Start,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
        if (changes > 0) {
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (changes == 1) "1 change" else "$changes changes", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    OutlinedButton(onClick = { rows = baseline }) {
                        Icon(Icons.Rounded.Replay, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Reset", modifier = Modifier.padding(start = 6.dp))
                    }
                    Button(onClick = {
                        val value = rows.map { (id, values) -> mapOf("id" to id, "values" to values) }
                        ui.runtime.setFieldValue(name, "EditableTable", name, value)
                        ui.trigger("Save Changes", name, null)
                        baseline = rows
                    }) {
                        Icon(Icons.Rounded.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Save changes", modifier = Modifier.padding(start = 6.dp))
                    }
                }
            }
        }
    }
    editing?.let { cell ->
        val column = columns[cell.column]
        val current = rows[cell.row].second.getOrNull(cell.column)
        CellEditor(column, current, onDismiss = { editing = null }) { next ->
            rows = rows.mapIndexed { i, row -> if (i == cell.row) row.first to row.second.mapIndexed { c, v -> if (c == cell.column) next else v } else row }
            editing = null
        }
    }
}

@Composable
private fun CellEditor(column: EditColumn, value: Any?, onDismiss: () -> Unit, onSave: (Any?) -> Unit) {
    when (column.type) {
        "date-single" -> {
            val state = rememberDatePickerState(initialSelectedDateMillis = dateOf(value)?.atStartOfDay(ZoneOffset.UTC)?.toInstant()?.toEpochMilli())
            DatePickerDialog(
                onDismissRequest = onDismiss,
                confirmButton = {
                    TextButton(onClick = {
                        onSave(state.selectedDateMillis?.let { Instant.ofEpochMilli(it).toString() })
                    }) { Text("Done") }
                },
                dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
            ) { DatePicker(state) }
        }
        "select" -> AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text(column.header.ifEmpty { "Select an option" }) },
            text = {
                Column {
                    column.options.forEach { (optionValue, label) ->
                        ListItem(
                            headlineContent = { Text(label) },
                            leadingContent = { RadioButton(selected = optionValue == value, onClick = null) },
                            modifier = Modifier.clickable { onSave(optionValue) },
                        )
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        )
        else -> {
            val state = rememberTextFieldState(cellText(value))
            AlertDialog(
                onDismissRequest = onDismiss,
                icon = { Icon(Icons.Rounded.Edit, contentDescription = null) },
                title = { Text(column.header.ifEmpty { "Edit" }) },
                text = {
                    OutlinedTextField(
                        state = state,
                        lineLimits = TextFieldLineLimits.SingleLine,
                        keyboardOptions = KeyboardOptions(keyboardType = when (column.type) {
                            "number" -> KeyboardType.Decimal
                            "url" -> KeyboardType.Uri
                            else -> KeyboardType.Text
                        }),
                        modifier = Modifier.fillMaxWidth().testTag("cell-editor"),
                    )
                },
                confirmButton = {
                    TextButton(onClick = {
                        val text = state.text.toString()
                        onSave(if (column.type == "number") text.trim().toDoubleOrNull()?.takeIf { it.isFinite() } ?: 0.0 else text)
                    }) { Text("Save") }
                },
                dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
            )
        }
    }
}
