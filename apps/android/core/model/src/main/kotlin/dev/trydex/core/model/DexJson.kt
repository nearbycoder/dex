package dev.trydex.core.model

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/**
 * The JSON settings every wire type is read with. Agents on older builds leave out fields and newer ones add them, so
 * unknown keys are ignored and missing or null fields fall back to their defaults (the native form of
 * `withStateDefaults` in apps/web/src/shared/protocol.ts).
 */
val DexJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    encodeDefaults = true
    isLenient = true
}

/** Small readers for loosely typed JSON (Pi events, tool arguments, OpenUI data). */
val JsonElement?.obj: JsonObject? get() = this as? JsonObject
val JsonElement?.arr: JsonArray? get() = this as? JsonArray
val JsonElement?.str: String? get() = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
val JsonElement?.num: Double? get() = (this as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
val JsonElement?.long: Long? get() = (this as? JsonPrimitive)?.takeIf { !it.isString }?.let { it.longOrNull ?: it.doubleOrNull?.toLong() }
val JsonElement?.bool: Boolean? get() = (this as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
val JsonElement?.isNullish: Boolean get() = this == null || this is JsonNull

/** A primitive's text whatever its type (numbers and booleans included), for display. */
val JsonElement?.text: String? get() = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull

operator fun JsonElement?.get(key: String): JsonElement? = (this as? JsonObject)?.get(key)
