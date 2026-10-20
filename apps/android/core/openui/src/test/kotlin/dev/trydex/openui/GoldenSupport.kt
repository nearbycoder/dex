package dev.trydex.openui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject

object GoldenSupport {
    fun load(name: String): JsonObject {
        val text = GoldenSupport::class.java.getResourceAsStream("/golden/$name")!!.bufferedReader().use { it.readText() }
        return Json.parseToJsonElement(text).jsonObject
    }

    /** The first difference between two JSON values (numbers compared by value), or null if they match. */
    fun diff(expected: JsonElement?, actual: JsonElement?, path: String = "$"): String? {
        val e = expected ?: JsonNull
        val a = actual ?: JsonNull
        return when {
            e is JsonObject && a is JsonObject -> {
                (e.keys + a.keys).sorted().firstNotNullOfOrNull { key ->
                    when {
                        key !in a -> "$path.$key missing (expected ${e[key].short()})"
                        key !in e -> "$path.$key unexpected (${a[key].short()})"
                        else -> diff(e[key], a[key], "$path.$key")
                    }
                }
            }
            e is JsonArray && a is JsonArray ->
                if (e.size != a.size) "$path length ${a.size}, expected ${e.size}: ${a.short()} vs ${e.short()}"
                else e.indices.firstNotNullOfOrNull { diff(e[it], a[it], "$path[$it]") }
            e is JsonPrimitive && a is JsonPrimitive -> {
                val en = if (e.isString) null else e.doubleOrNull
                val an = if (a.isString) null else a.doubleOrNull
                when {
                    e is JsonNull || a is JsonNull -> if (e is JsonNull && a is JsonNull) null else "$path: ${a.short()}, expected ${e.short()}"
                    en != null && an != null -> if (en == an) null else "$path: $an, expected $en"
                    e.isString == a.isString && e.content == a.content -> null
                    else -> "$path: ${a.short()}, expected ${e.short()}"
                }
            }
            else -> "$path: ${a.short()}, expected ${e.short()}"
        }
    }

    private fun JsonElement?.short() = toString().take(300)
}
