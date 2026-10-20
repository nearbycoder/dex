package dev.trydex.android.ui.openui

import dev.trydex.core.model.Format
import dev.trydex.openui.Catalog
import dev.trydex.openui.Js
import dev.trydex.openui.RuntimeFunction
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Dex's OpenUI functions (apps/web/src/client/openui/library.tsx): @Ago, @DateTime, @Bytes. */
object DexFunctions {
    /** A time as `Date.parse` reads it: ms since 1970, or an ISO 8601 string (a bare date is UTC midnight). */
    fun millis(value: Any?): Long? = when (value) {
        is Double -> value.takeIf { it.isFinite() }?.toLong()
        is Number -> value.toLong()
        is String -> value.trim().let { text ->
            runCatching { Instant.parse(text).toEpochMilli() }.getOrNull()
                ?: runCatching { OffsetDateTime.parse(text).toInstant().toEpochMilli() }.getOrNull()
                ?: runCatching { LocalDate.parse(text).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull()
                ?: runCatching { LocalDateTime.parse(text).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli() }.getOrNull()
        }
        else -> null
    }

    fun ago(time: Any?, now: Long = System.currentTimeMillis()): String = millis(time)?.let { Format.timeAgo(it, now) } ?: ""

    /** "Oct 19, 5:08 PM" in the device's own order and clock. */
    fun dateTime(time: Any?, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String {
        val ms = millis(time) ?: return ""
        val pattern = runCatching { android.text.format.DateFormat.getBestDateTimePattern(locale, "MMMdjmm") }.getOrNull() ?: "MMM d, h:mm a"
        return Instant.ofEpochMilli(ms).atZone(zone).format(DateTimeFormatter.ofPattern(pattern, locale))
    }

    fun bytes(value: Any?): String = Format.bytes(Js.toNumber(value).toLong())

    /** The functions with the schemas the library declares, for the evaluator. */
    fun forCatalog(catalog: Catalog): Map<String, RuntimeFunction> {
        fun fn(name: String, body: (Map<String, Any?>) -> Any?): Pair<String, RuntimeFunction>? {
            val schema = catalog.functions[name] ?: return null
            return name to RuntimeFunction(Js.obj(schema["params"]) ?: emptyMap(), schema["returns"], body)
        }
        return listOfNotNull(
            fn("Ago") { ago(it["time"]) },
            fn("DateTime") { dateTime(it["time"]) },
            fn("Bytes") { bytes(it["bytes"]) },
        ).toMap()
    }
}
