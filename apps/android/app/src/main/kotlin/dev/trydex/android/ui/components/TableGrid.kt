package dev.trydex.android.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp

/**
 * A grid whose columns are as wide as their widest cell and whose rows are as tall as their tallest, with a background
 * behind each row. Row 0 is the header.
 */
@Composable
fun TableGrid(
    rows: Int,
    columns: Int,
    modifier: Modifier = Modifier,
    columnWidths: List<Dp?> = emptyList(),
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
        val placeables = cells.mapIndexed { i, cell ->
            val width = fixed[i % columns]
            cell.measure(if (width >= 0) Constraints(minWidth = width, maxWidth = width) else Constraints())
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

