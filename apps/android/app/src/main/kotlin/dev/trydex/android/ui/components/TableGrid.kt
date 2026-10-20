package dev.trydex.android.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.IntrinsicMeasureScope
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.Measurable
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * A grid whose columns are as wide as their widest cell and whose rows are as tall as their tallest, with a background
 * behind each row. Row 0 is the header. With [fitWidth], columns too wide to fit narrow (widest first, not below
 * [minColumnWidth]) so their text wraps, as a browser's table does; only what still doesn't fit scrolls.
 */
@Composable
fun TableGrid(
    rows: Int,
    columns: Int,
    modifier: Modifier = Modifier,
    columnWidths: List<Dp?> = emptyList(),
    fitWidth: Dp? = null,
    minColumnWidth: Dp = 96.dp,
    rowBackground: @Composable (Int) -> Unit,
    cell: @Composable (row: Int, column: Int) -> Unit,
) {
    Layout(
        contents = listOf(
            { repeat(rows) { rowBackground(it) } },
            { for (r in 0 until rows) for (c in 0 until columns) Box { cell(r, c) } },
        ),
        modifier = modifier,
    ) { (backgrounds, cells), constraints ->
        val fixed = IntArray(columns) { c -> columnWidths.getOrNull(c)?.roundToPx() ?: -1 }
        val caps = fitWidth?.let { fit(cells, columns, fixed, it.roundToPx(), minColumnWidth.roundToPx()) }
        val placeables = cells.mapIndexed { i, cell ->
            val width = fixed[i % columns]
            val cap = caps?.get(i % columns) ?: Constraints.Infinity
            cell.measure(if (width >= 0) Constraints(minWidth = width, maxWidth = width) else Constraints(maxWidth = cap))
        }
        val widths = IntArray(columns)
        val heights = IntArray(rows)
        placeables.forEachIndexed { i, p ->
            widths[i % columns] = maxOf(widths[i % columns], p.width)
            heights[i / columns] = maxOf(heights[i / columns], p.height)
        }
        val natural = widths.sum()
        val total = maxOf(natural, constraints.minWidth)
        if (columns > 0 && natural < total) widths[columns - 1] += total - natural
        val bgs = backgrounds.mapIndexed { r, m -> m.measure(Constraints.fixed(total, heights[r])) }
        layout(total, heights.sum()) {
            var y = 0
            for (r in 0 until rows) {
                bgs[r].place(0, y)
                var x = 0
                for (c in 0 until columns) {
                    val p = placeables[r * columns + c]
                    p.place(x, y + (heights[r] - p.height) / 2)
                    x += widths[c]
                }
                y += heights[r]
            }
        }
    }
}


/**
 * The widest each auto column may be so the grid fits [available]: columns narrower than an even share keep their
 * width, and the rest share what's left. Null when everything fits, or when a cell can't report its width.
 */
private fun IntrinsicMeasureScope.fit(cells: List<Measurable>, columns: Int, fixed: IntArray, available: Int, floor: Int): IntArray? {
    val natural = IntArray(columns)
    cells.forEachIndexed { i, cell ->
        val c = i % columns
        if (fixed[c] < 0) natural[c] = maxOf(natural[c], runCatching { cell.maxIntrinsicWidth(Constraints.Infinity) }.getOrElse { return null })
    }
    var remaining = available - fixed.sumOf { maxOf(it, 0) }
    if (natural.sum() <= remaining) return null
    val auto = (0 until columns).filter { fixed[it] < 0 }.sortedBy { natural[it] }
    var left = auto.size
    var cap = 0
    for (c in auto) {
        val share = remaining / left
        if (natural[c] > share) { cap = share; break }
        remaining -= natural[c]
        left--
    }
    return IntArray(columns) { maxOf(cap, floor) }
}
