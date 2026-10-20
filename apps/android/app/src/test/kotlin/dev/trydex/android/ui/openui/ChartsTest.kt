package dev.trydex.android.ui.openui

import com.google.common.truth.Truth.assertThat
import dev.trydex.openui.ElementNode
import org.junit.Test

/** Chart data and number formats as OpenUI's chart library produces them. */
class ChartsTest {
    @Test fun ticksAreRound() {
        val scale = Scale.nice(0.0, 28.0, 6)
        assertThat(scale.min).isEqualTo(0.0)
        assertThat(scale.max).isEqualTo(30.0)
        assertThat(scale.ticks).containsExactly(0.0, 5.0, 10.0, 15.0, 20.0, 25.0, 30.0).inOrder()
        assertThat(Scale.nice(-3.0, 7.0, 5).ticks.first()).isAtMost(-3.0)
    }

    @Test fun axisAndTooltipNumbers() {
        assertThat(tickLabel(1500.0)).isEqualTo("1.5K")
        assertThat(tickLabel(2000.0)).isEqualTo("2.0K")
        assertThat(tickLabel(10_000.0)).isEqualTo("10K")
        assertThat(tickLabel(0.5)).isEqualTo("0.50")
        assertThat(tickLabel(42.0)).isEqualTo("42")
        assertThat(tooltipValue(123_456.0)).isEqualTo("123.4K")
        assertThat(tooltipValue(1_999_999.0)).isEqualTo("1.9M")
        assertThat(tooltipValue(-250_000.0)).isEqualTo("-250.0K")
    }

    @Test fun paletteFromTheMiddleOut() {
        assertThat(chartColors(1)).containsExactly(CHART_PALETTE[5])
        assertThat(chartColors(2)).containsExactly(CHART_PALETTE[4], CHART_PALETTE[6]).inOrder()
        assertThat(chartColors(5)).isEqualTo(CHART_PALETTE.subList(3, 8))
        assertThat(chartColors(12).last()).isEqualTo(CHART_PALETTE[0])
    }

    @Test fun seriesDataLikeBuildChartData() {
        fun series(name: String, vararg values: Double) = ElementNode("Series", mapOf("category" to name, "values" to values.toList()), partial = false)
        val data = buildChartData(listOf("Mon", "Tue"), listOf(series("A", 1.0, 2.0, 9.0), series("B"), series("A", 3.0, 4.0)))!!
        // A later series replaces an earlier one with the same name; an empty one is left out; values past the labels are ignored.
        assertThat(data.series.map { it.name }).containsExactly("A")
        assertThat(data.series.single().values).containsExactly(3.0, 4.0).inOrder()
        val rows = buildChartData(listOf("day", "x", "y"), listOf(listOf("Mon", 1.0, "2"), listOf("Tue", 3.0, "oops")))!!
        assertThat(rows.categories).containsExactly("Mon", "Tue").inOrder()
        assertThat(rows.series[1].values).containsExactly(2.0, 0.0).inOrder()
        assertThat(buildSlices(listOf("a", "b"), listOf(1.0, "2"))).containsExactly("a" to 1.0, "b" to 0.0).inOrder()
    }
}
