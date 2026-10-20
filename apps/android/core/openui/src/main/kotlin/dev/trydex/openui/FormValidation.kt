package dev.trydex.openui

import java.net.URI

/** A field's validation rule (`{required: true, minLength: 3}` → required, minLength:3). */
data class Rule(val type: String, val arg: Any? = null)

/** Form field validation (lang-core's utils/validation.ts). */
object FormValidation {
    /** Rules from a structured object; false, null, and missing values are skipped. */
    fun parse(rules: Any?): List<Rule> {
        val map = rules as? Map<*, *> ?: return emptyList()
        return map.mapNotNull { (key, value) ->
            when (value) {
                false, null, Undefined -> null
                true -> Rule(key.toString())
                else -> Rule(key.toString(), value)
            }
        }
    }

    private fun isEmpty(value: Any?): Boolean = when (value) {
        null, Undefined, "" -> true
        is List<*> -> value.isEmpty()
        is Map<*, *> -> if (value.containsKey("value")) isEmpty(value["value"]) else value.isEmpty()
        else -> false
    }

    private val EMAIL = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")

    private fun number(value: Any?): Double? = when (value) {
        is Double -> value
        is Number -> value.toDouble()
        else -> Js.toStr(value).trim().let { text -> Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?").find(text)?.value?.toDoubleOrNull() }
    }

    private fun numberText(value: Any?) = Js.numberToString(Js.toNumber(value))

    /** The first rule a value breaks, as the message shown under the field; null when it passes them all. */
    fun validate(value: Any?, rules: List<Rule>): String? {
        for (rule in rules) {
            val error = when (rule.type) {
                "required" -> when {
                    isEmpty(value) -> "This field is required"
                    value is Map<*, *> && value.isNotEmpty() && value.values.all { it is Boolean } && value.values.none { it == true } ->
                        "At least one option is required"
                    else -> null
                }
                "email" -> if (isEmpty(value)) null else if (value !is String || !EMAIL.matches(value)) "Please enter a valid email" else null
                "url" -> if (isEmpty(value)) null else if (value !is String || !isUrl(value)) "Please enter a valid URL" else null
                "numeric" -> when {
                    isEmpty(value) -> null
                    value is Number && !value.toDouble().isNaN() -> null
                    value is String && number(value) != null && value.isNotBlank() -> null
                    else -> "Must be a number"
                }
                "min" -> if (isEmpty(value)) null else number(value)?.let { n -> if (n >= Js.toNumber(rule.arg)) null else "Must be at least ${numberText(rule.arg)}" }
                "max" -> if (isEmpty(value)) null else number(value)?.let { n -> if (n <= Js.toNumber(rule.arg)) null else "Must be no more than ${numberText(rule.arg)}" }
                "minLength" -> if (isEmpty(value) || value !is String) null
                    else if (value.length >= Js.toNumber(rule.arg)) null else "Must be at least ${numberText(rule.arg)} characters"
                "maxLength" -> if (isEmpty(value) || value !is String) null
                    else if (value.length <= Js.toNumber(rule.arg)) null else "Must be no more than ${numberText(rule.arg)} characters"
                "pattern" -> if (isEmpty(value) || value !is String || rule.arg !is String) null
                    else runCatching { Regex(rule.arg).containsMatchIn(value) }.getOrDefault(true).let { if (it) null else "Invalid format" }
                else -> null
            }
            if (error != null) return error
        }
        return null
    }

    /** What `new URL(value)` accepts: an absolute URL with a scheme. */
    private fun isUrl(value: String) = runCatching { URI(value.trim()).let { it.scheme != null && (it.host != null || it.isOpaque || it.path != null) } }.getOrDefault(false)
}
