package dev.trydex.openui

/** A problem the parser found in a program (ValidationError). */
data class ValidationError(
    val code: String,
    val component: String,
    val path: String,
    val message: String,
    val statementId: String?,
    val severity: String? = null,
)

/** A problem anywhere in the pipeline, worded for the model that wrote the program (OpenUIError). */
data class OpenUIError(
    /** parser, runtime, query, or mutation. */
    val source: String,
    val code: String,
    val message: String,
    val statementId: String? = null,
    val component: String? = null,
    val path: String? = null,
    val toolName: String? = null,
    val hint: String? = null,
    val severity: String? = null,
)

/** What materialization carries along (MaterializeCtx). */
internal class MaterializeCtx(
    val syms: Map<String, Ast>,
    val catalog: Catalog?,
    val errors: MutableList<ValidationError>,
    val unresolved: MutableList<String>,
    val visited: MutableSet<String>,
    val partial: Boolean,
    var currentStatementId: String?,
    val unreached: MutableSet<String>?,
)

/** An invalid value, after its problem was reported (lang-core's INVALID symbol). */
internal object Invalid

/** Schema-aware checks on materialized values (parser/validation.ts). */
internal object Validation {
    private val SCALAR_TYPES = listOf("string", "number", "boolean")

    fun schemaDefault(property: Any?): Any? = (property as? Map<*, *>)?.let { if (it.containsKey("default")) it["default"] else Undefined } ?: Undefined

    private fun refName(s: Map<*, *>): String? = (s["\$ref"] as? String)?.split('/')?.last()

    private fun isComposite(s: Map<*, *>) = s.containsKey("\$ref") || s.containsKey("anyOf") || s.containsKey("oneOf") || s.containsKey("allOf")

    private class ScalarInfo(val expectedType: String? = null, val enumValues: List<Any?>? = null)

    private fun scalarInfo(s: Map<*, *>): ScalarInfo = when {
        s["enum"] is List<*> -> ScalarInfo(enumValues = s["enum"] as List<*>)
        s.containsKey("const") -> ScalarInfo(enumValues = listOf(s["const"]))
        else -> when (s["type"]) {
            "string" -> ScalarInfo("string")
            "number", "integer" -> ScalarInfo("number")
            "boolean" -> ScalarInfo("boolean")
            else -> ScalarInfo()
        }
    }

    private fun typeFromSchema(property: Any?): String? {
        val p = property as? Map<*, *> ?: return null
        refName(p)?.let { return it }
        val leaf = scalarInfo(p)
        leaf.enumValues?.let { values -> return values.joinToString("|") { Js.json(it) } }
        leaf.expectedType?.let { return it }
        return p["type"] as? String
    }

    fun signature(component: String, params: List<ParamDef>): String =
        "$component(" + params.joinToString(", ") { p ->
            val type = typeFromSchema(p.schema)
            val marked = if (p.required) "${p.name}*" else p.name
            if (type != null) "$marked: $type" else marked
        } + ")"

    private fun mismatch(value: Any?, info: ScalarInfo): Pair<String, String>? {
        val actual = Js.typeOf(value)
        info.enumValues?.let { values ->
            if (actual !in SCALAR_TYPES) return null
            if (values.any { Js.same(it, value) || (it is Number && value is Number && it.toDouble() == value.toDouble()) }) return null
            return "one of [${values.joinToString(", ") { Js.json(it) }}]" to Js.json(value)
        }
        if (info.expectedType != null && info.expectedType != actual) return info.expectedType to Js.jsType(value)
        return null
    }

    sealed interface Issue {
        data class TypeMismatch(val expected: String, val actual: String) : Issue
        data class MissingRequired(val signature: String? = null) : Issue
        data class NullRequired(val signature: String? = null) : Issue
        data class UnknownComponent(val available: List<String>?) : Issue
        data object InlineReserved : Issue
        data class ExcessArgs(val declared: Int, val got: Int) : Issue
        data object UnknownFunction : Issue
        data class NoRoot(val reason: String) : Issue
    }

    private fun code(issue: Issue) = when (issue) {
        is Issue.TypeMismatch -> "type-mismatch"
        is Issue.MissingRequired -> "missing-required"
        is Issue.NullRequired -> "null-required"
        is Issue.UnknownComponent -> "unknown-component"
        Issue.InlineReserved -> "inline-reserved"
        is Issue.ExcessArgs -> "excess-args"
        Issue.UnknownFunction -> "unknown-function"
        is Issue.NoRoot -> "no-root"
    }

    private fun message(component: String, path: String, issue: Issue): String = when (issue) {
        is Issue.TypeMismatch -> "field \"$path\" expects ${issue.expected} but got ${issue.actual}"
        is Issue.MissingRequired -> "missing required field \"$path\"" + (issue.signature?.let { " — signature: $it" } ?: "")
        is Issue.NullRequired -> "required field \"$path\" cannot be null" + (issue.signature?.let { " — signature: $it" } ?: "")
        is Issue.UnknownComponent -> "Unknown component \"$component\" — not found in catalog or builtins" +
            (issue.available?.takeIf { it.isNotEmpty() }?.let { ". Available components: ${it.joinToString(", ")}" } ?: "")
        Issue.InlineReserved -> "$component() must be declared as a top-level statement, not used inline as a value"
        is Issue.ExcessArgs -> "$component takes ${issue.declared} arg(s), got ${issue.got} (${issue.got - issue.declared} excess dropped)"
        Issue.UnknownFunction -> "Unknown function \"@$component\": not a built-in or action step. The call evaluates to null"
        is Issue.NoRoot -> when (issue.reason) {
            "not-component" -> "root does not evaluate to a component"
            "fallback" -> "No root statement. Rendering the first statement that calls the root component $component"
            else -> if (component.isNotEmpty()) "No root statement, and no statement calls the root component $component" else "No root statement"
        }
    }

    fun push(ctx: MaterializeCtx, component: String, path: String, issue: Issue) {
        ctx.errors += ValidationError(
            code = code(issue),
            component = component,
            path = path,
            message = message(component, path, issue),
            statementId = ctx.currentStatementId,
            severity = if (issue is Issue.NoRoot && issue.reason == "fallback") "warning" else null,
        )
    }

    /** An invalid value's replacement: its default, else [Invalid] when required, else [Undefined] (leave it out). */
    fun resolveInvalid(required: Boolean, defaultValue: Any?): Any? =
        if (defaultValue !== Undefined) defaultValue else if (required) Invalid else Undefined

    private fun validateElementPosition(element: ElementNode, s: Map<*, *>, component: String, path: String, ctx: MaterializeCtx): Boolean {
        if (isComposite(s)) return false
        if (s["type"] is String || s["enum"] is List<*> || s.containsKey("const")) {
            push(ctx, component, path, Issue.TypeMismatch(s["type"] as? String ?: "a literal value", "component \"${element.typeName}\""))
            return true
        }
        return false
    }

    private fun slotRefNames(s: Map<*, *>): List<String?> {
        val options = (s["anyOf"] ?: s["oneOf"]) as? List<*> ?: listOf(s)
        return options.map { (it as? Map<*, *>)?.let(::refName) }
    }

    private fun isOnlyComponentSlot(s: Map<*, *>, ctx: MaterializeCtx): Boolean {
        val names = slotRefNames(s)
        return names.isNotEmpty() && names.all { it != null && ctx.catalog?.components?.containsKey(it) == true }
    }

    private fun validateObject(value: Any?, s: Map<*, *>, component: String, path: String, ctx: MaterializeCtx): Any? {
        if (value !is Map<*, *>) {
            push(ctx, component, path, Issue.TypeMismatch("object", Js.jsType(value)))
            return Invalid
        }
        @Suppress("UNCHECKED_CAST")
        val obj = value as Map<String, Any?>
        var out: LinkedHashMap<String, Any?>? = null
        val props = (s["properties"] as? Map<*, *>) ?: emptyMap<String, Any?>()
        val required = (s["required"] as? List<*>)?.map { it.toString() } ?: emptyList()
        var invalid = false
        if (!ctx.partial) {
            for (key in required) {
                val present = obj.containsKey(key)
                if (!present || Js.isNullish(obj[key])) {
                    val fallback = schemaDefault(props[key])
                    if (fallback !== Undefined) {
                        (out ?: LinkedHashMap(obj).also { out = it })[key] = fallback
                        continue
                    }
                    push(ctx, component, "$path/$key", if (present) Issue.NullRequired() else Issue.MissingRequired())
                    invalid = true
                }
            }
        }
        for ((rawKey, sub) in props) {
            val key = rawKey.toString()
            if (!obj.containsKey(key)) continue
            var next = validate(obj[key], sub, component, "$path/$key", ctx)
            if (next === Invalid) {
                next = resolveInvalid(key in required, schemaDefault(sub))
                if (next === Invalid) {
                    invalid = true
                    continue
                }
            }
            if (next === obj[key]) continue
            val copy = out ?: LinkedHashMap(obj).also { out = it }
            if (next === Undefined) copy.remove(key) else copy[key] = next
        }
        return if (invalid) Invalid else out ?: obj
    }

    private fun validateArray(value: Any?, s: Map<*, *>, component: String, path: String, ctx: MaterializeCtx): Any? {
        if (value !is List<*>) {
            push(ctx, component, path, Issue.TypeMismatch("array", Js.jsType(value)))
            return Invalid
        }
        val items = s["items"] as? Map<*, *> ?: return value
        var out: ArrayList<Any?>? = null
        for (i in value.indices) {
            val next = validate(value[i], items, component, "$path/$i", ctx)
            if (next !== value[i] && out == null) out = ArrayList(value.subList(0, i))
            if (out != null && next !== Invalid) out.add(next)
        }
        return out ?: value
    }

    private fun validateLeaf(value: Any?, s: Map<*, *>, component: String, path: String, ctx: MaterializeCtx): Boolean {
        val leaf = scalarInfo(s)
        if (leaf.expectedType == null && leaf.enumValues == null) return false
        if (leaf.enumValues != null && ctx.partial) return false
        val wrong = mismatch(value, leaf) ?: return false
        push(ctx, component, path, Issue.TypeMismatch(wrong.first, wrong.second))
        return true
    }

    /** Checks a value against a schema fragment; returns it, a cleaned copy, or [Invalid] (validateSchemaValue). */
    fun validate(value: Any?, schema: Any?, component: String, path: String, ctx: MaterializeCtx): Any? {
        val s = schema as? Map<*, *> ?: return value
        if (Js.isNullish(value)) return value
        if (value is Ast) return value
        if (value is ElementNode) return if (validateElementPosition(value, s, component, path, ctx)) Invalid else value
        if (isComposite(s)) {
            if (!isOnlyComponentSlot(s, ctx)) return value
            val actual = when (value) {
                is List<*> -> "array"
                is Map<*, *> -> "plain object"
                else -> Js.typeOf(value)
            }
            push(ctx, component, path, Issue.TypeMismatch(slotRefNames(s).joinToString(" | "), actual))
            return Invalid
        }
        return when (s["type"]) {
            "object" -> validateObject(value, s, component, path, ctx)
            "array" -> validateArray(value, s, component, path, ctx)
            else -> if (validateLeaf(value, s, component, path, ctx)) Invalid else value
        }
    }
}
