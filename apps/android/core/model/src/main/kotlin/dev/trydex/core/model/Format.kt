package dev.trydex.core.model

import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.log10

/** Formatting that matches the web app exactly (apps/web/src/client/lib/format.ts and the pages' helpers). */
object Format {
    private val units = listOf("year" to 31_536_000L, "month" to 2_592_000L, "day" to 86_400L, "hour" to 3_600L, "minute" to 60L)

    /**
     * How long ago (or until) a time was, as `Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" })` writes
     * it: "5 min. ago", "yesterday", "in 2 hr.". Under a minute either way is "just now".
     */
    fun timeAgo(timestamp: Long, now: Long = System.currentTimeMillis()): String {
        val seconds = (timestamp - now) / 1000.0
        for ((unit, size) in units) {
            if (abs(seconds) >= size) return relative(jsRound(seconds / size), unit)
        }
        return "just now"
    }

    private fun relative(value: Long, unit: String): String {
        val n = abs(value)
        val past = value < 0
        if (n == 1L) when (unit) {
            "day" -> return if (past) "yesterday" else "tomorrow"
            "month" -> return if (past) "last mo." else "next mo."
            "year" -> return if (past) "last yr." else "next yr."
        }
        val label = when (unit) {
            "minute" -> "$n min."
            "hour" -> "$n hr."
            "day" -> "$n days"
            "month" -> "$n mo."
            else -> "$n yr."
        }
        return if (past) "$label ago" else "in $label"
    }

    /** JavaScript's Math.round (halves towards +∞). */
    fun jsRound(value: Double): Long = floor(value + 0.5).toLong()

    /** 512 → "512 B", 1536 → "1.5 KB", 5242880 → "5.0 MB". */
    fun bytes(bytes: Long): String = when {
        bytes < 1024 -> "$bytes B"
        bytes < 1_048_576 -> "${fixed(bytes / 1024.0, 1)} KB"
        else -> "${fixed(bytes / 1_048_576.0, 1)} MB"
    }

    /** Number.prototype.toFixed: rounds half away from zero on the decimal value. */
    fun fixed(value: Double, digits: Int): String = BigDecimal(value).setScale(digits, RoundingMode.HALF_UP).toPlainString()

    /** skills.sh installs and Smithery uses: 1234 → "1.2K", 12345 → "12K", 2500000 → "2.5M". */
    fun installs(count: Long): String = when {
        count >= 1_000_000 -> "${fixed(count / 1_000_000.0, 1)}M"
        count >= 1_000 -> "${fixed(count / 1_000.0, if (count >= 10_000) 0 else 1)}K"
        else -> count.toString()
    }

    /** The Usage page's dollars: "$0.00", "<$0.01", "$3.14", "$1,234". */
    fun usd(value: Double): String = when {
        value == 0.0 -> "$0.00"
        value < 0.01 -> "<$0.01"
        value < 100 -> "$${fixed(value, 2)}"
        else -> "$${String.format(Locale.US, "%,d", jsRound(value))}"
    }

    /** `Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: v < 1000 ? 0 : 1 })`: 950, 1.2K, 3.5M. */
    fun compact(value: Double): String {
        if (abs(value) < 1000) return jsRound(value).toString()
        val suffixes = listOf("K", "M", "B", "T")
        var exponent = (floor(log10(abs(value)) / 3)).toInt().coerceIn(1, suffixes.size)
        var scaled = BigDecimal.valueOf(value).movePointLeft(exponent * 3).setScale(1, RoundingMode.HALF_UP)
        if (scaled.abs() >= BigDecimal(1000) && exponent < suffixes.size) {
            exponent++
            scaled = BigDecimal.valueOf(value).movePointLeft(exponent * 3).setScale(1, RoundingMode.HALF_UP)
        }
        val text = scaled.stripTrailingZeros().toPlainString()
        return text + suffixes[exponent - 1]
    }

    fun compact(value: Long): String = compact(value.toDouble())

    private val timeFormat = DateTimeFormatter.ofPattern("h:mm a", Locale.US)

    /** A time of day like the web's `toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })`: "6:00 PM". */
    fun timeOfDay(millis: Long, zone: ZoneId = ZoneId.systemDefault()): String =
        Instant.ofEpochMilli(millis).atZone(zone).format(timeFormat)

    /** "Oct 5" from a UTC `YYYY-MM-DD` day (the Usage chart's labels). */
    fun shortDate(date: String): String = runCatching {
        val day = LocalDate.parse(date)
        "${day.month.getDisplayName(TextStyle.SHORT, Locale.US)} ${day.dayOfMonth}"
    }.getOrDefault(date)

    /** "Oct 5, 3:07 PM" in local time. */
    fun dateTime(millis: Long, zone: ZoneId = ZoneId.systemDefault()): String =
        Instant.ofEpochMilli(millis).atZone(zone).format(DateTimeFormatter.ofPattern("MMM d, h:mm a", Locale.US))

    /** A full local date and time, for tooltips and schedules ("10/19/2026, 5:08:00 PM" on the web). */
    fun fullDateTime(millis: Long, zone: ZoneId = ZoneId.systemDefault()): String =
        Instant.ofEpochMilli(millis).atZone(zone).format(DateTimeFormatter.ofPattern("M/d/yyyy, h:mm:ss a", Locale.US))

    fun date(millis: Long, zone: ZoneId = ZoneId.systemDefault()): String =
        Instant.ofEpochMilli(millis).atZone(zone).format(DateTimeFormatter.ofPattern("M/d/yyyy", Locale.US))

    fun utcDay(millis: Long): String = Instant.ofEpochMilli(millis).atOffset(ZoneOffset.UTC).toLocalDate().toString()

    /** "36s", "2m 5s" (the activity row's clock). */
    fun duration(ms: Long): String {
        val seconds = maxOf(0, jsRound(ms / 1000.0))
        return if (seconds < 60) "${seconds}s" else "${seconds / 60}m ${seconds % 60}s"
    }

    fun plural(count: Int, one: String, many: String = "${one}s") = "$count ${if (count == 1) one else many}"
}
