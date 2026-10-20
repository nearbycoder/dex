package dev.trydex.openui

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.math.BigDecimal

/**
 * OpenUI Lang runs on JavaScript values, and programs depend on their quirks (`5 == "5"`, `"a" + null`, truthiness),
 * so the port keeps them. A value is one of:
 * - [Undefined] or `null`,
 * - `Boolean`, `Double` (every number), `String`,
 * - `List<Any?>` (an array) or `Map<String, Any?>` (an object, in insertion order),
 * - runtime shapes: [Ast] nodes, [ElementNode], [ActionPlan], [ReactiveAssign].
 */
object Undefined {
    override fun toString() = "undefined"
}

object Js {
    fun isNullish(value: Any?) = value == null || value === Undefined

    fun truthy(value: Any?): Boolean = when (value) {
        null, Undefined -> false
        is Boolean -> value
        is Double -> !(value == 0.0 || value.isNaN())
        is Number -> value.toDouble().let { !(it == 0.0 || it.isNaN()) }
        is String -> value.isNotEmpty()
        else -> true
    }

    fun typeOf(value: Any?): String = when (value) {
        Undefined -> "undefined"
        null -> "object"
        is Boolean -> "boolean"
        is Number -> "number"
        is String -> "string"
        else -> "object"
    }

    /** `Array.isArray(value) ? "array" : typeof value`, for validation messages. */
    fun jsType(value: Any?): String = if (value is List<*>) "array" else typeOf(value)

    /** JavaScript's `Number(string)`: trims whitespace; "" is 0; hex, binary, and octal literals; NaN otherwise. */
    fun numberOf(text: String): Double {
        val s = text.trim()
        if (s.isEmpty()) return 0.0
        when (s) {
            "Infinity", "+Infinity" -> return Double.POSITIVE_INFINITY
            "-Infinity" -> return Double.NEGATIVE_INFINITY
        }
        val radix = when {
            s.startsWith("0x") || s.startsWith("0X") -> 16
            s.startsWith("0b") || s.startsWith("0B") -> 2
            s.startsWith("0o") || s.startsWith("0O") -> 8
            else -> 10
        }
        if (radix != 10) return s.substring(2).toBigIntegerOrNull(radix)?.toDouble() ?: Double.NaN
        if (!Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$").matches(s)) return Double.NaN
        return s.toDoubleOrNull() ?: Double.NaN
    }

    /** lang-core's `toNumber`: numbers as they are, numeric strings parsed, booleans 1/0, anything else 0. */
    fun toNumber(value: Any?): Double = when (value) {
        is Double -> value
        is Number -> value.toDouble()
        is String -> numberOf(value).let { if (it.isNaN()) 0.0 else it }
        is Boolean -> if (value) 1.0 else 0.0
        else -> 0.0
    }

    /** JavaScript's ToNumber (NaN for what isn't a number), for loose equality. */
    private fun jsToNumber(value: Any?): Double = when (value) {
        is Double -> value
        is Number -> value.toDouble()
        is String -> numberOf(value)
        is Boolean -> if (value) 1.0 else 0.0
        null -> 0.0
        Undefined -> Double.NaN
        else -> numberOf(toStr(value))
    }

    /** JavaScript's `String(value)`. */
    fun toStr(value: Any?): String = when (value) {
        Undefined -> "undefined"
        null -> "null"
        is String -> value
        is Boolean -> value.toString()
        is Double -> numberToString(value)
        is Number -> numberToString(value.toDouble())
        is List<*> -> value.joinToString(",") { if (isNullish(it)) "" else toStr(it) }
        else -> "[object Object]"
    }

    /** Number.prototype.toString(): shortest round-trip digits, exponent form below 1e-6 and from 1e21. */
    fun numberToString(value: Double): String {
        if (value.isNaN()) return "NaN"
        if (value.isInfinite()) return if (value > 0) "Infinity" else "-Infinity"
        if (value == 0.0) return "0"
        val decimal = BigDecimal(value.toString()).stripTrailingZeros()
        val digits = decimal.unscaledValue().abs().toString()
        val negative = decimal.signum() < 0
        // value = 0.digits × 10^n
        val n = digits.length - decimal.scale()
        val k = digits.length
        val body = when {
            n in k..21 -> digits + "0".repeat(n - k)
            n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
            n in -5..0 -> "0." + "0".repeat(-n) + digits
            else -> {
                val exponent = n - 1
                val sign = if (exponent >= 0) "+" else "-"
                val mantissa = if (k == 1) digits else digits[0] + "." + digits.substring(1)
                "${mantissa}e$sign${kotlin.math.abs(exponent)}"
            }
        }
        return if (negative) "-$body" else body
    }

    /** JavaScript's `==`. */
    fun looseEquals(a: Any?, b: Any?): Boolean {
        if (isNullish(a) && isNullish(b)) return true
        if (isNullish(a) || isNullish(b)) return false
        if (a is Number && b is Number) return a.toDouble() == b.toDouble()
        if (a is String && b is String) return a == b
        if (a is Boolean && b is Boolean) return a == b
        val aObject = a !is String && a !is Number && a !is Boolean
        val bObject = b !is String && b !is Number && b !is Boolean
        if (aObject && bObject) return a === b
        if (a is Boolean) return looseEquals(if (a) 1.0 else 0.0, b)
        if (b is Boolean) return looseEquals(a, if (b) 1.0 else 0.0)
        if (aObject) return looseEquals(toStr(a), b)
        if (bObject) return looseEquals(a, toStr(b))
        // A number and a string.
        return jsToNumber(a) == jsToNumber(b)
    }

    /** `Object.is`, as the store compares values. */
    fun same(a: Any?, b: Any?): Boolean = when {
        a is Double && b is Double -> a.equals(b)
        a is String && b is String -> a == b
        a is Boolean && b is Boolean -> a == b
        else -> a === b
    }

    /** A plain object (not an array or one of the runtime shapes). */
    fun isObject(value: Any?): Boolean = value is Map<*, *>

    @Suppress("UNCHECKED_CAST")
    fun obj(value: Any?): Map<String, Any?>? = value as? Map<String, Any?>

    /** `value[key]` on any value: objects by key, arrays by index or `length`, strings by `length`. */
    fun get(value: Any?, key: String): Any? = when (value) {
        is Map<*, *> -> if (value.containsKey(key)) value[key] else Undefined
        is List<*> -> when {
            key == "length" -> value.size.toDouble()
            else -> key.toIntOrNull()?.let { value.getOrElse(it) { Undefined } } ?: Undefined
        }
        is String -> if (key == "length") value.length.toDouble() else key.toIntOrNull()?.let { i -> value.getOrNull(i)?.toString() } ?: Undefined
        is ElementNode -> when (key) {
            "type" -> "element"
            "typeName" -> value.typeName
            "props" -> value.props
            "partial" -> value.partial
            else -> Undefined
        }
        else -> Undefined
    }

    // ── JSON ─────────────────────────────────────────────────────────────────

    fun fromJson(element: JsonElement?): Any? = when (element) {
        null -> Undefined
        JsonNull -> null
        is JsonPrimitive -> when {
            element.isString -> element.content
            element.booleanOrNull != null -> element.booleanOrNull
            else -> element.doubleOrNull ?: element.content
        }
        is JsonArray -> element.map { fromJson(it) }
        is JsonObject -> LinkedHashMap<String, Any?>().apply { for ((key, value) in element) put(key, fromJson(value)) }
    }

    /**
     * `JSON.parse(JSON.stringify(value))` as a JsonElement: undefined keys are left out, undefined array items and
     * non-finite numbers become null. Runtime shapes are written the way lang-core's objects serialize.
     */
    fun toJson(value: Any?): JsonElement = when (value) {
        null, Undefined -> JsonNull
        is Boolean -> JsonPrimitive(value)
        is Double -> if (value.isFinite()) JsonPrimitive(jsonNumber(value)) else JsonNull
        is Number -> toJson(value.toDouble())
        is String -> JsonPrimitive(value)
        is List<*> -> JsonArray(value.map { toJson(it) })
        is Map<*, *> -> JsonObject(buildMap { for ((key, item) in value) if (item !== Undefined) put(key.toString(), toJson(item)) })
        is ElementNode -> value.toJson()
        is Ast -> value.toJson()
        is ActionPlan -> JsonObject(mapOf("steps" to JsonArray(value.steps.map { it.toJson() })))
        is ReactiveAssign -> JsonObject(mapOf("__reactive" to JsonPrimitive("assign"), "target" to JsonPrimitive(value.target), "expr" to value.expr.toJson()))
        else -> JsonPrimitive(toStr(value))
    }

    /** Whole numbers as integers in JSON, as JavaScript writes them. */
    private fun jsonNumber(value: Double): Number =
        if (value == Math.rint(value) && kotlin.math.abs(value) < 9.007199254740992E15) value.toLong() else value

    /** JSON.stringify with keys sorted at every level (the query cache key). */
    fun stableStringify(value: Any?): String = when (value) {
        Undefined -> "\"__undefined__\""
        null -> "null"
        is Double -> when {
            value.isNaN() -> "\"__NaN__\""
            value == Double.POSITIVE_INFINITY -> "\"__Inf__\""
            value == Double.NEGATIVE_INFINITY -> "\"__-Inf__\""
            else -> toJson(value).toString()
        }
        is List<*> -> value.joinToString(",", "[", "]") { stableStringify(it) }
        is Map<*, *> -> value.entries.sortedBy { it.key.toString() }
            .joinToString(",", "{", "}") { (key, item) -> JsonPrimitive(key.toString()).toString() + ":" + stableStringify(item) }
        else -> toJson(value).toString()
    }

    fun json(value: Any?): String = toJson(value).toString()
}
