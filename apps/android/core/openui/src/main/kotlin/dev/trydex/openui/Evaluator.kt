package dev.trydex.openui

import java.util.Collections
import java.util.WeakHashMap

/** A library function as the evaluator runs it: its JSON Schema `params` and `returns`, and its implementation. */
class RuntimeFunction(val params: Map<String, Any?>, val returns: Any?, val fn: (Map<String, Any?>) -> Any?)

/** What evaluating an expression reads from (EvaluationContext). */
data class EvaluationContext(
    val getState: (String) -> Any?,
    val resolveRef: (String) -> Any?,
    /** Extra scope for `$value` while a binding writes back. */
    val extraScope: Map<String, Any?>? = null,
    val functions: Map<String, RuntimeFunction> = emptyMap(),
    /** Custom actions' schemas (`{ params }`). */
    val actions: Map<String, Map<String, Any?>> = emptyMap(),
    val reportError: ((String) -> Unit)? = null,
)

/** Resolves AST nodes to values (runtime/evaluator.ts, evaluate-prop.ts, evaluate-tree.ts). */
object Evaluator {
    /** Custom steps made by real calls; one read from data isn't among them, so data can't pose as an action. */
    private val ownCustomSteps: MutableSet<ActionStep.Custom> = Collections.synchronizedSet(Collections.newSetFromMap(WeakHashMap()))

    fun evaluate(node: Ast, context: EvaluationContext, catalog: Catalog? = null): Any? = when (node) {
        is Ast.Str -> node.v
        is Ast.Num -> node.v
        is Ast.Bool -> node.v
        Ast.Null -> null
        is Ast.Ph -> null
        is Ast.StateRef -> context.extraScope?.get(node.n).takeUnless { Js.isNullish(it) } ?: context.getState(node.n)
        is Ast.Ref -> context.resolveRef(node.n)
        is Ast.RuntimeRef -> context.resolveRef(node.n)
        is Ast.Arr -> node.els.map { evaluate(it, context) }
        is Ast.Obj -> LinkedHashMap<String, Any?>().apply { for ((k, v) in node.entries) put(k, evaluate(v, context)) }
        is Ast.Comp -> comp(node, context, catalog)
        is Ast.BinOp -> binary(node, context)
        is Ast.UnaryOp -> when (node.op) {
            "!" -> !Js.truthy(evaluate(node.operand, context))
            "-" -> -Js.toNumber(evaluate(node.operand, context))
            else -> null
        }
        is Ast.Ternary -> if (Js.truthy(evaluate(node.cond, context))) evaluate(node.then, context) else evaluate(node.otherwise, context)
        is Ast.Member -> {
            val obj = evaluate(node.obj, context)
            when {
                Js.isNullish(obj) -> null
                // Array pluck: `rows.title` is every row's title.
                obj is List<*> -> if (node.field == "length") obj.size.toDouble() else obj.map { item ->
                    if (Js.isNullish(item)) null else Js.get(item, node.field).takeUnless { Js.isNullish(it) }
                }
                else -> Js.get(obj, node.field)
            }
        }
        is Ast.Index -> {
            val obj = evaluate(node.obj, context)
            val index = evaluate(node.index, context)
            when {
                Js.isNullish(obj) || Js.isNullish(index) -> null
                obj is List<*> -> Js.get(obj, Js.numberToString(Js.toNumber(index)))
                else -> Js.get(obj, Js.toStr(index))
            }
        }
        is Ast.Assign -> ReactiveAssign(node.target, node.value)
    }

    private fun binary(node: Ast.BinOp, context: EvaluationContext): Any? {
        if (node.op == "&&") {
            val left = evaluate(node.left, context)
            return if (Js.truthy(left)) evaluate(node.right, context) else left
        }
        if (node.op == "||") {
            val left = evaluate(node.left, context)
            return if (Js.truthy(left)) left else evaluate(node.right, context)
        }
        val left = evaluate(node.left, context)
        val right = evaluate(node.right, context)
        return when (node.op) {
            "+" -> if (left is String || right is String) {
                // null and undefined concatenate as "", not "null".
                Js.toStr(left.takeUnless { Js.isNullish(it) } ?: "") + Js.toStr(right.takeUnless { Js.isNullish(it) } ?: "")
            } else Js.toNumber(left) + Js.toNumber(right)
            "-" -> Js.toNumber(left) - Js.toNumber(right)
            "*" -> Js.toNumber(left) * Js.toNumber(right)
            // Division by zero is 0 in OpenUI Lang, not Infinity or NaN.
            "/" -> if (Js.toNumber(right) == 0.0) 0.0 else Js.toNumber(left) / Js.toNumber(right)
            "%" -> if (Js.toNumber(right) == 0.0) 0.0 else Js.toNumber(left).rem(Js.toNumber(right))
            "==" -> Js.looseEquals(left, right)
            "!=" -> !Js.looseEquals(left, right)
            ">" -> Js.toNumber(left) > Js.toNumber(right)
            "<" -> Js.toNumber(left) < Js.toNumber(right)
            ">=" -> Js.toNumber(left) >= Js.toNumber(right)
            "<=" -> Js.toNumber(left) <= Js.toNumber(right)
            else -> null
        }
    }

    private fun comp(node: Ast.Comp, context: EvaluationContext, catalog: Catalog?): Any? {
        val name = node.name
        if (Builtins.isFunction(name)) {
            if (Builtins.CALLS[name]?.lazy == true) return lazyBuiltin(name, node.args, context, catalog)
            return Builtins.call(name, evaluateArgs(node, context))
        }
        if (Builtins.isStep(name)) return actionCall(node, context)
        context.functions[name]?.let { return callFunction(name, it, node, context) }
        context.actions[name]?.let { def ->
            val params = Js.obj(def["params"]) ?: emptyMap()
            val args = callArgs(node, context, params)
            if (missesRequired(args, params)) return ActionPlan(emptyList())
            val checked = checkValue(args, params, name, "", context, strict = true)
            if (checked === Invalid) return ActionPlan(emptyList())
            @Suppress("UNCHECKED_CAST")
            val step = ActionStep.Custom(name, checked as Map<String, Any?>)
            ownCustomSteps += step
            return ActionPlan(listOf(step))
        }
        val mapped = node.mappedProps ?: return null
        val props = LinkedHashMap<String, Any?>()
        for ((key, value) in mapped) {
            val reactive = catalog?.isReactive(name, key) == true
            props[key] = when {
                value is Ast.StateRef && reactive -> ReactiveAssign(value.n, Ast.StateRef("\$value"))
                value is Ast.StateRef -> if (catalog != null) context.getState(value.n) else value
                else -> evaluate(value, context, catalog)
            }
        }
        if (catalog != null) {
            for ((key, value) in props.entries.toList()) {
                props[key] = when (value) {
                    is ElementNode -> evaluateElement(value, context, catalog, null)
                    is List<*> -> value.map { if (it is ElementNode) evaluateElement(it, context, catalog, null) else it }
                    else -> value
                }
            }
        }
        return ElementNode(name, props, partial = false, hasDynamicProps = true)
    }

    private fun evaluateArgs(node: Ast.Comp, context: EvaluationContext, params: List<ParamDef> = Builtins.CALLS[node.name]?.params ?: emptyList()): LinkedHashMap<String, Any?> {
        val named = node.mappedProps ?: Materialize.nameArgs(node.args, params)
        val args = LinkedHashMap<String, Any?>()
        for ((key, value) in named) args[key] = evaluate(value, context)
        return args
    }

    /** A library call's args; an explicit null for an optional param is left out so its default applies. */
    private fun callArgs(node: Ast.Comp, context: EvaluationContext, params: Map<String, Any?>): LinkedHashMap<String, Any?> {
        val names = Js.obj(params["properties"])?.keys ?: emptySet()
        val required = (params["required"] as? List<*>)?.map { it.toString() } ?: emptyList()
        val args = evaluateArgs(node, context, names.map { ParamDef(it, false) })
        for (key in args.keys.toList()) if (args[key] == null && key !in required) args.remove(key)
        return args
    }

    private fun checkValue(value: Any?, schema: Any?, name: String, path: String, context: EvaluationContext, strict: Boolean = false): Any? {
        val ctx = MaterializeCtx(emptyMap(), null, ArrayList(), ArrayList(), HashSet(), false, null, null)
        val checked = Validation.validate(value, schema, name, path, ctx)
        for (error in ctx.errors) context.reportError?.invoke("@$name: ${error.message}")
        return if (strict && ctx.errors.isNotEmpty()) Invalid else checked
    }

    private fun missesRequired(args: Map<String, Any?>, params: Map<String, Any?>): Boolean {
        val required = (params["required"] as? List<*>)?.map { it.toString() } ?: return false
        val properties = Js.obj(params["properties"]) ?: emptyMap()
        return required.any { key -> Js.isNullish(args[key] ?: if (args.containsKey(key)) null else Undefined) && Validation.schemaDefault(properties[key]) === Undefined }
    }

    private fun callFunction(name: String, def: RuntimeFunction, node: Ast.Comp, context: EvaluationContext): Any? {
        val raw = callArgs(node, context, def.params)
        if (missesRequired(raw, def.params)) return null
        val args = checkValue(raw, def.params, name, "", context)
        if (args === Invalid) return null
        val result = try {
            @Suppress("UNCHECKED_CAST")
            def.fn(args as Map<String, Any?>)
        } catch (error: Exception) {
            context.reportError?.invoke("@$name threw: ${error.message ?: error.toString()}")
            return null
        }
        if (def.returns == null) return result
        val checked = checkValue(result, def.returns, name, "/returns", context)
        return if (checked === Invalid) null else checked.takeUnless { Js.isNullish(it) }
    }

    /** An evaluated action plan, or data shaped like one (`{ steps: [...] }`). */
    fun isActionPlan(value: Any?) = value is ActionPlan || (value is Map<*, *> && value["steps"] is List<*>)

    /** Steps from data (legacy JSON steps): only those that can't do anything a program couldn't already. */
    private fun stepFromData(value: Any?): ActionStep? {
        val map = value as? Map<*, *> ?: return null
        return when (map["type"]) {
            "run" -> (map["statementId"] as? String)?.let { ActionStep.Run(it, map["refType"] as? String ?: "query") }
            "continue_conversation" -> ActionStep.ToAssistant(Js.toStr(map["message"] ?: ""), if (map.containsKey("context")) map["context"] else Undefined)
            "open_url" -> (map["url"] as? String)?.let { ActionStep.OpenUrl(it) }
            "reset" -> (map["targets"] as? List<*>)?.mapNotNull { it as? String }?.takeIf { it.isNotEmpty() }?.let { ActionStep.Reset(it) }
            else -> null
        }
    }

    /** A plan's steps, without custom steps no real call made. */
    fun ownSteps(plan: Any?): ActionPlan = when (plan) {
        is ActionPlan -> if (plan.steps.all { it !is ActionStep.Custom || it in ownCustomSteps }) plan
            else ActionPlan(plan.steps.filter { it !is ActionStep.Custom || it in ownCustomSteps })
        is Map<*, *> -> ActionPlan((plan["steps"] as? List<*>).orEmpty().mapNotNull { if (it is ActionStep) it else stepFromData(it) }
            .filter { it !is ActionStep.Custom || it in ownCustomSteps })
        else -> ActionPlan(emptyList())
    }

    private fun flattenPlans(values: List<*>): ActionPlan = ownSteps(ActionPlan(values.flatMap { v ->
        when {
            v is ActionPlan -> v.steps
            v is Map<*, *> && v["steps"] is List<*> -> ownSteps(v).steps
            v is ActionStep -> listOf(v)
            v is Map<*, *> && v.containsKey("type") -> listOfNotNull(stepFromData(v))
            else -> emptyList()
        }
    }))

    private fun actionCall(node: Ast.Comp, context: EvaluationContext): ActionPlan {
        if (node.name == "Action") {
            val list = node.args.firstOrNull()?.let { evaluate(it, context) } ?: emptyList<Any?>()
            return flattenPlans(list as? List<*> ?: emptyList<Any?>())
        }
        val step = Builtins.step(node.name, evaluateArgs(node, context)) ?: lazyStep(node.name, node.args)
        return ActionPlan(listOfNotNull(step))
    }

    private fun lazyStep(name: String, args: List<Ast>): ActionStep? = when (name) {
        "Run" -> (args.firstOrNull() as? Ast.RuntimeRef)?.let { ActionStep.Run(it.n, it.refType) }
        "Set" -> if (args.size >= 2 && args[0] is Ast.StateRef) ActionStep.SetState((args[0] as Ast.StateRef).n, args[1]) else null
        "Reset" -> args.filterIsInstance<Ast.StateRef>().map { it.n }.takeIf { it.isNotEmpty() }?.let { ActionStep.Reset(it) }
        else -> null
    }

    /** Replaces a loop variable with its value throughout a template, so deferred steps keep it (substituteRef). */
    fun substitute(node: Ast, name: String, value: Any?): Ast = when (node) {
        is Ast.Ref -> if (node.n == name) Ast.literal(value) else node
        is Ast.Member -> {
            val obj = substitute(node.obj, name, value)
            if (obj is Ast.Obj) obj.entries.firstOrNull { it.first == node.field }?.second ?: Ast.Member(obj, node.field)
            else Ast.Member(obj, node.field)
        }
        is Ast.Index -> Ast.Index(substitute(node.obj, name, value), substitute(node.index, name, value))
        is Ast.BinOp -> Ast.BinOp(node.op, substitute(node.left, name, value), substitute(node.right, name, value))
        is Ast.UnaryOp -> Ast.UnaryOp(node.op, substitute(node.operand, name, value))
        is Ast.Ternary -> Ast.Ternary(substitute(node.cond, name, value), substitute(node.then, name, value), substitute(node.otherwise, name, value))
        is Ast.Arr -> Ast.Arr(node.els.map { substitute(it, name, value) })
        is Ast.Obj -> Ast.Obj(node.entries.map { (k, v) -> k to substitute(v, name, value) })
        is Ast.Comp -> node.copy(
            args = node.args.map { substitute(it, name, value) },
            mappedProps = node.mappedProps?.mapValues { substitute(it.value, name, value) },
        )
        is Ast.Assign -> Ast.Assign(node.target, substitute(node.value, name, value))
        else -> node
    }

    private fun lazyBuiltin(name: String, args: List<Ast>, context: EvaluationContext, catalog: Catalog?): Any? {
        if (name != "Each") return null
        if (args.size < 3) return emptyList<Any?>()
        val array = evaluate(args[0], context) as? List<*> ?: return emptyList<Any?>()
        val variable = when (val v = args[1]) {
            is Ast.Ref -> v.n
            is Ast.Str -> v.v
            else -> null
        } ?: return emptyList<Any?>()
        val template = args[2]
        return array.map { item ->
            val substituted = substitute(template, variable, item)
            val child = context.copy(resolveRef = { ref -> if (ref == variable) item else context.resolveRef(ref) })
            val result = evaluate(substituted, child, catalog)
            if (catalog != null && result is ElementNode) evaluateElement(result, child, catalog, null) else result
        }
    }

    // ── Props ────────────────────────────────────────────────────────────────

    /** One prop's value, with bindings, nested components, lists, and plans handled (evaluatePropCore). */
    private fun prop(value: Any?, context: EvaluationContext, catalog: Catalog, reactive: Boolean, errors: MutableList<OpenUIError>?): Any? {
        val result = propValue(value, context, catalog, reactive, errors)
        return if (isActionPlan(result)) ownSteps(result) else result
    }

    private fun propValue(value: Any?, context: EvaluationContext, catalog: Catalog, reactive: Boolean, errors: MutableList<OpenUIError>?): Any? {
        if (value == null || value === Undefined) return value
        if (value is String || value is Number || value is Boolean) return value
        if (value is Ast) {
            if (value is Ast.StateRef && reactive) return ReactiveAssign(value.n, Ast.StateRef("\$value"))
            val result = evaluate(value, context, catalog)
            return when {
                result is ElementNode -> evaluateElement(result, context, catalog, errors)
                result is List<*> -> result.map { if (it is ElementNode) evaluateElement(it, context, catalog, errors) else it }
                result is ReactiveAssign && !reactive -> context.getState(result.target).takeUnless { Js.isNullish(it) }
                else -> result
            }
        }
        if (value is List<*>) return value.map { prop(it, context, catalog, reactive, errors) }
        if (value is ElementNode) return evaluateElement(value, context, catalog, errors)
        if (isActionPlan(value)) return value
        if (value is Map<*, *>) {
            val needsEval = value.values.any { it != null && it !== Undefined && it !is String && it !is Number && it !is Boolean }
            if (!needsEval) return value
            return LinkedHashMap<String, Any?>().apply { for ((k, v) in value) put(k.toString(), prop(v, context, catalog, reactive, errors)) }
        }
        return value
    }

    /**
     * An element with its props evaluated (evaluateElementProps). With an `errors` list, a prop that throws keeps its
     * raw value and is reported there; so is a library function call that fails.
     */
    fun evaluateElement(el: ElementNode, context: EvaluationContext, catalog: Catalog, errors: MutableList<OpenUIError>?): ElementNode {
        if (el.hasDynamicProps == false) return el
        var key = ""
        fun report(message: String) {
            errors?.add(
                OpenUIError(
                    source = "runtime",
                    code = "runtime-error",
                    component = el.typeName,
                    statementId = el.statementId,
                    message = "Evaluating prop \"$key\" on ${el.typeName} failed: $message",
                    hint = "Check the expression used for prop \"$key\"",
                ),
            )
        }
        val propContext = if (errors != null && (context.functions.isNotEmpty() || context.actions.isNotEmpty())) {
            context.copy(reportError = { report(it) })
        } else context
        val evaluated = LinkedHashMap<String, Any?>()
        for ((propKey, value) in el.props) {
            key = propKey
            evaluated[propKey] = try {
                prop(value, propContext, catalog, catalog.isReactive(el.typeName, propKey), errors)
            } catch (error: Exception) {
                if (errors == null) throw error
                report(error.message ?: error.toString())
                value
            }
        }
        return el.copy(props = evaluated)
    }

    /** The root, or the component a runtime entry picks; null (with an error) if it isn't one (evaluateRoot). */
    fun evaluateRoot(result: ParseResult, context: EvaluationContext, catalog: Catalog, errors: MutableList<OpenUIError>): ElementNode? {
        result.root?.let { return evaluateElement(it, context, catalog, errors) }
        val expression = result.rootExpression ?: return null
        val value = evaluate(expression, context, catalog)
        if (value is ElementNode) return evaluateElement(value, context, catalog, errors)
        errors += OpenUIError(source = "runtime", code = "no-root", statementId = "root", message = "root does not evaluate to a component")
        return null
    }
}
