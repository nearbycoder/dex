package dev.trydex.openui

import java.text.Collator
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.pow

/** A parameter of a component, function, or action (ParamDef). */
data class ParamDef(
    val name: String,
    val required: Boolean,
    /** The schema's `default`, or [Undefined]. */
    val defaultValue: Any? = Undefined,
    /** The parameter's JSON Schema, as a JS value; null when there is none. */
    val schema: Any? = null,
)

data class CallDef(val kind: String, val params: List<ParamDef>, val builtin: Boolean = false, val lazy: Boolean = false)

/** Built-in functions and action steps, and the reserved Query/Mutation calls (parser/builtins.ts). */
object Builtins {
    private fun names(vararg params: String) = params.map { ParamDef(it, false) }

    /** Built-in functions (callable as `@Name(...)`), with their params in positional order. */
    private val FUNCTIONS: Map<String, List<ParamDef>> = linkedMapOf(
        "Count" to names("array"),
        "First" to names("array"),
        "Last" to names("array"),
        "Sum" to names("numbers"),
        "Avg" to names("numbers"),
        "Min" to names("numbers"),
        "Max" to names("numbers"),
        "Sort" to names("array", "field", "direction"),
        "Filter" to names("array", "field", "operator", "value"),
        "Round" to names("number", "decimals"),
        "Abs" to names("number"),
        "Floor" to names("number"),
        "Ceil" to names("number"),
        "Each" to names("array", "varName", "template"),
    )

    private val STEPS: Map<String, List<ParamDef>> = linkedMapOf(
        "Run" to names("ref"),
        "ToAssistant" to names("message", "context"),
        "OpenUrl" to names("url"),
        "Set" to names("variable", "value"),
        "Reset" to names("variable"),
    )

    private val LAZY = setOf("Each", "Run", "Set", "Reset", "Action")

    val CALLS: Map<String, CallDef> = buildMap {
        for ((name, params) in FUNCTIONS) put(name, CallDef("function", params, builtin = true, lazy = name in LAZY))
        for ((name, params) in STEPS) put(name, CallDef("action", params, builtin = true, lazy = name in LAZY))
        put("Action", CallDef("action", listOf(ParamDef("steps", true)), builtin = true, lazy = true))
    }

    fun isBuiltin(name: String) = name in CALLS
    fun isFunction(name: String) = name in FUNCTIONS
    fun isStep(name: String) = CALLS[name]?.kind == "action"

    const val QUERY = "Query"
    const val MUTATION = "Mutation"
    fun isReserved(name: String) = name == QUERY || name == MUTATION

    /** Resolves a dot path on a value ("state.name" → value.state.name). */
    private fun field(value: Any?, path: String): Any? {
        if (path.isEmpty() || Js.isNullish(value)) return Undefined
        var current = value
        for (part in path.split('.')) {
            if (Js.isNullish(current)) return Undefined
            current = Js.get(current, part)
        }
        return current
    }

    private fun sum(values: List<*>) = values.fold(0.0) { total, item -> total + Js.toNumber(item) }

    private val collator: Collator = Collator.getInstance(Locale.ENGLISH)

    private fun isNumeric(value: Any?) = value is Double || (value is String && value != "" && !Js.numberOf(value).isNaN())

    /** Runs a non-lazy built-in function on its (already evaluated) named args. */
    fun call(name: String, args: Map<String, Any?>): Any? {
        fun arg(key: String) = args[key] ?: if (args.containsKey(key)) null else Undefined
        return when (name) {
            "Count" -> (arg("array") as? List<*>)?.size?.toDouble() ?: 0.0
            "First" -> (arg("array") as? List<*>)?.firstOrNull()?.takeUnless { Js.isNullish(it) }
            "Last" -> (arg("array") as? List<*>)?.lastOrNull()?.takeUnless { Js.isNullish(it) }
            "Sum" -> (arg("numbers") as? List<*>)?.let { sum(it) } ?: 0.0
            "Avg" -> (arg("numbers") as? List<*>)?.takeIf { it.isNotEmpty() }?.let { sum(it) / it.size } ?: 0.0
            "Min" -> (arg("numbers") as? List<*>)?.takeIf { it.isNotEmpty() }?.let { list ->
                list.fold(Js.toNumber(list[0])) { acc, item -> minOf(acc, Js.toNumber(item)) }
            } ?: 0.0
            "Max" -> (arg("numbers") as? List<*>)?.takeIf { it.isNotEmpty() }?.let { list ->
                list.fold(Js.toNumber(list[0])) { acc, item -> maxOf(acc, Js.toNumber(item)) }
            } ?: 0.0
            "Sort" -> {
                val array = arg("array") as? List<*> ?: return arg("array")
                val path = Js.toStr(arg("field").takeUnless { Js.isNullish(it) } ?: "")
                val descending = Js.toStr(arg("direction").takeUnless { Js.isNullish(it) } ?: "asc") == "desc"
                array.sortedWith { a, b ->
                    val av = if (path.isNotEmpty()) field(a, path) else a
                    val bv = if (path.isNotEmpty()) field(b, path) else b
                    val order = if (isNumeric(av) && isNumeric(bv)) {
                        Js.toNumber(av).compareTo(Js.toNumber(bv))
                    } else {
                        collator.compare(Js.toStr(av.takeUnless { Js.isNullish(it) } ?: ""), Js.toStr(bv.takeUnless { Js.isNullish(it) } ?: ""))
                    }
                    if (descending) -order else order
                }
            }
            "Filter" -> {
                val array = arg("array") as? List<*> ?: return emptyList<Any?>()
                val path = Js.toStr(arg("field").takeUnless { Js.isNullish(it) } ?: "")
                val operator = Js.toStr(arg("operator").takeUnless { Js.isNullish(it) } ?: "==")
                val value = arg("value")
                array.filter { item ->
                    val v = if (path.isNotEmpty()) field(item, path) else item
                    when (operator) {
                        "==" -> Js.looseEquals(v, value)
                        "!=" -> !Js.looseEquals(v, value)
                        ">" -> Js.toNumber(v) > Js.toNumber(value)
                        "<" -> Js.toNumber(v) < Js.toNumber(value)
                        ">=" -> Js.toNumber(v) >= Js.toNumber(value)
                        "<=" -> Js.toNumber(v) <= Js.toNumber(value)
                        "contains" -> Js.toStr(v.takeUnless { Js.isNullish(it) } ?: "").contains(Js.toStr(value.takeUnless { Js.isNullish(it) } ?: ""))
                        else -> false
                    }
                }
            }
            "Round" -> {
                val number = Js.toNumber(arg("number"))
                val decimals = arg("decimals").let { if (Js.isNullish(it)) 0.0 else Js.toNumber(it) }
                val factor = 10.0.pow(decimals)
                floor(number * factor + 0.5) / factor
            }
            "Abs" -> kotlin.math.abs(Js.toNumber(arg("number")))
            "Floor" -> floor(Js.toNumber(arg("number")))
            "Ceil" -> ceil(Js.toNumber(arg("number")))
            else -> null
        }
    }

    /** A non-lazy built-in step from its named args. */
    fun step(name: String, args: Map<String, Any?>): ActionStep? = when (name) {
        "ToAssistant" -> ActionStep.ToAssistant(
            message = Js.toStr(args["message"].takeUnless { Js.isNullish(it) } ?: ""),
            context = args["context"].let { if (Js.isNullish(it)) Undefined else it },
        )
        "OpenUrl" -> ActionStep.OpenUrl(Js.toStr(args["url"].takeUnless { Js.isNullish(it) } ?: ""))
        else -> null
    }
}
