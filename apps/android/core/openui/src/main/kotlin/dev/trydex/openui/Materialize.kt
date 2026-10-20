package dev.trydex.openui

import java.util.Collections
import java.util.IdentityHashMap

/**
 * Schema-aware lowering (parser/materialize.ts): resolves references, maps positional args to named props, validates
 * them, applies defaults, turns literals into plain values, and keeps runtime expressions as [Ast] for the evaluator.
 */
internal object Materialize {
    private fun calls(ctx: MaterializeCtx): Map<String, CallDef> = ctx.catalog?.calls ?: Builtins.CALLS

    fun containsDynamic(value: Any?): Boolean = when (value) {
        null, Undefined -> false
        is Ast -> true
        is List<*> -> value.any { containsDynamic(it) }
        is ElementNode -> value.props.values.any { containsDynamic(it) }
        // A `{steps: [...]}` literal is evaluated too, so data can't pose as custom action steps.
        is Map<*, *> -> value["steps"] is List<*> || value.values.any { containsDynamic(it) }
        else -> false
    }

    private enum class Mode { Value, Expr }

    private fun resolveRef(name: String, ctx: MaterializeCtx, mode: Mode): Any? {
        if (name in ctx.visited || !ctx.syms.containsKey(name)) {
            ctx.unresolved += name
            return if (mode == Mode.Expr) Ast.Ph(name) else null
        }
        val target = ctx.syms.getValue(name)
        ctx.unreached?.remove(name)
        if (target is Ast.Comp && Builtins.isReserved(target.name)) {
            return Ast.RuntimeRef(name, if (target.name == Builtins.MUTATION) "mutation" else "query")
        }
        ctx.visited += name
        val previous = ctx.currentStatementId
        ctx.currentStatementId = name
        try {
            val result = if (mode == Mode.Value) value(target, ctx) else expr(target, ctx)
            if (mode == Mode.Value && result is ElementNode) result.statementId = name
            return result
        } finally {
            ctx.currentStatementId = previous
            ctx.visited -= name
        }
    }

    private fun isRuntimeCall(name: String, ctx: MaterializeCtx) = calls(ctx).containsKey(name) || Builtins.isReserved(name)

    fun nameArgs(args: List<Ast>, params: List<ParamDef>): LinkedHashMap<String, Ast> {
        val named = LinkedHashMap<String, Ast>()
        for (i in 0 until minOf(params.size, args.size)) named[params[i].name] = args[i]
        return named
    }

    /** A library call's args by name, checked like props; null when one is invalid (the call becomes null). */
    fun mapCallArgs(name: String, args: List<Ast>, def: CallDef, ctx: MaterializeCtx): Map<String, Ast>? {
        val params = def.params
        if (args.size > params.size) Validation.push(ctx, name, "", Validation.Issue.ExcessArgs(params.size, args.size))
        val mapped = nameArgs(args, params)
        var invalid = false
        val errorsBefore = ctx.errors.size
        for (p in params) {
            val arg = mapped[p.name]
            val lit = if (arg != null) Ast.literalValue(arg) else Literal(Undefined)
            if (lit == null) continue
            if (Js.isNullish(lit.v)) {
                if (!p.required || p.defaultValue !== Undefined) continue
                Validation.push(
                    ctx, name, "/${p.name}",
                    if (arg != null) Validation.Issue.NullRequired(Validation.signature(name, params)) else Validation.Issue.MissingRequired(Validation.signature(name, params)),
                )
                invalid = true
                continue
            }
            var next = Validation.validate(lit.v, p.schema, name, "/${p.name}", ctx)
            if (next === Invalid) next = Validation.resolveInvalid(p.required, p.defaultValue)
            when {
                next === Invalid -> invalid = true
                next === Undefined -> mapped.remove(p.name)
                next !== lit.v -> mapped[p.name] = Ast.literal(next)
            }
        }
        // An action never runs with a value the model didn't write.
        if (def.kind == "action" && ctx.errors.size > errorsBefore) invalid = true
        return if (invalid) null else mapped
    }

    private fun materializeCall(node: Ast.Comp, ctx: MaterializeCtx, arg: (Ast) -> Ast): Ast {
        val args = node.args.map(arg)
        val def = calls(ctx)[node.name]
        if (def == null || def.lazy) return node.copy(args = args)
        val mapped = if (def.builtin) nameArgs(args, def.params) else mapCallArgs(node.name, args, def, ctx)
        if (mapped != null) return node.copy(args = args, mappedProps = mapped)
        // An invalid action step is an empty plan.
        return if (def.kind == "action") Ast.Comp("Action", listOf(Ast.Arr(emptyList()))) else Ast.Null
    }

    /** Names the args of calls inside Query/Mutation args in place; an invalid library call keeps raw names. */
    fun nameRawCallArgs(args: List<Ast>, ctx: MaterializeCtx, statementId: String) {
        val previous = ctx.currentStatementId
        ctx.currentStatementId = statementId
        val seen: MutableSet<Ast> = Collections.newSetFromMap(IdentityHashMap())
        for (arg in args) {
            Ast.walk(arg) { node ->
                if (node !is Ast.Comp || !seen.add(node)) return@walk
                val def = calls(ctx)[node.name] ?: return@walk
                if (def.lazy) return@walk
                val checked = if (def.builtin) null else mapCallArgs(node.name, node.args, def, ctx)
                node.mappedProps = checked ?: nameArgs(node.args, def.params)
            }
        }
        ctx.currentStatementId = previous
    }

    private fun lazyBuiltin(node: Ast.Comp, ctx: MaterializeCtx, scoped: Set<String>): Ast? {
        val def = calls(ctx)[node.name]
        if (def?.kind != "function" || !def.lazy || node.args.size < 3) return null
        val variable = when (val v = node.args[1]) {
            is Ast.Ref -> v.n
            is Ast.Str -> v.v
            else -> null
        } ?: return null
        val nextScoped = scoped + variable
        return node.copy(args = node.args.mapIndexed { i, a -> if (i == 1) a else expr(a, ctx, nextScoped) })
    }

    fun expr(node: Ast, ctx: MaterializeCtx, scoped: Set<String> = emptySet()): Ast = when (node) {
        is Ast.Ref -> if (node.n in scoped) node else resolveRef(node.n, ctx, Mode.Expr) as Ast
        is Ast.Ph -> node
        is Ast.Comp -> {
            if (node.fn && !isRuntimeCall(node.name, ctx)) {
                Validation.push(ctx, node.name, "", Validation.Issue.UnknownFunction)
                Ast.Null
            } else {
                lazyBuiltin(node, ctx, scoped) ?: if (isRuntimeCall(node.name, ctx)) {
                    materializeCall(node, ctx) { expr(it, ctx, scoped) }
                } else {
                    val args = node.args.map { expr(it, ctx, scoped) }
                    val def = ctx.catalog?.components?.get(node.name)
                    if (def != null) {
                        val mapped = LinkedHashMap<String, Ast>()
                        for (i in 0 until minOf(def.size, args.size)) mapped[def[i].name] = args[i]
                        node.copy(args = args, mappedProps = mapped)
                    } else {
                        Validation.push(ctx, node.name, "", Validation.Issue.UnknownComponent(ctx.catalog?.components?.keys?.toList()))
                        node.copy(args = args)
                    }
                }
            }
        }
        is Ast.Arr -> Ast.Arr(node.els.map { expr(it, ctx, scoped) })
        is Ast.Obj -> Ast.Obj(node.entries.map { (k, v) -> k to expr(v, ctx, scoped) })
        is Ast.BinOp -> Ast.BinOp(node.op, expr(node.left, ctx, scoped), expr(node.right, ctx, scoped))
        is Ast.UnaryOp -> Ast.UnaryOp(node.op, expr(node.operand, ctx, scoped))
        is Ast.Ternary -> Ast.Ternary(expr(node.cond, ctx, scoped), expr(node.then, ctx, scoped), expr(node.otherwise, ctx, scoped))
        is Ast.Member -> Ast.Member(expr(node.obj, ctx, scoped), node.field)
        is Ast.Index -> Ast.Index(expr(node.obj, ctx, scoped), expr(node.index, ctx, scoped))
        is Ast.Assign -> Ast.Assign(node.target, expr(node.value, ctx, scoped))
        else -> node
    }

    /** Lowers a statement's value: ElementNode, AST (runtime), plain value, or null. */
    fun value(node: Ast, ctx: MaterializeCtx): Any? = when (node) {
        is Ast.Ref -> resolveRef(node.n, ctx, Mode.Value)
        is Ast.Str -> node.v
        is Ast.Num -> node.v
        is Ast.Bool -> node.v
        Ast.Null -> null
        is Ast.Ph -> null
        is Ast.Arr -> {
            val items = ArrayList<Any?>()
            for (e in node.els) {
                if (e is Ast.Ph) continue
                val v = value(e, ctx)
                if (v == null && (e is Ast.Comp || e is Ast.Ref)) continue
                items += v
            }
            items
        }
        is Ast.Obj -> LinkedHashMap<String, Any?>().apply { for ((k, v) in node.entries) put(k, value(v, ctx)) }
        is Ast.Comp -> component(node, ctx)
        else -> if (Ast.isRuntimeExpr(node)) expr(node, ctx) else node
    }

    private fun component(node: Ast.Comp, ctx: MaterializeCtx): Any? {
        val name = node.name
        if (node.fn && !isRuntimeCall(name, ctx)) {
            Validation.push(ctx, name, "", Validation.Issue.UnknownFunction)
            return null
        }
        if (Builtins.isReserved(name)) {
            Validation.push(ctx, name, "", Validation.Issue.InlineReserved)
            return null
        }
        if (isRuntimeCall(name, ctx)) return lazyBuiltin(node, ctx, emptySet()) ?: materializeCall(node, ctx) { expr(it, ctx) }

        val def = ctx.catalog?.components?.get(name)
        if (def == null) {
            Validation.push(ctx, name, "", Validation.Issue.UnknownComponent(ctx.catalog?.components?.keys?.toList()))
            return null
        }
        val props = LinkedHashMap<String, Any?>()
        var drop = false
        for (i in 0 until minOf(def.size, node.args.size)) {
            val param = def[i]
            val v = value(node.args[i], ctx)
            props[param.name] = v
            if (param.schema == null) continue
            var next = Validation.validate(v, param.schema, name, "/${param.name}", ctx)
            if (next === Invalid) {
                next = Validation.resolveInvalid(param.required, param.defaultValue)
                if (next === Invalid) drop = true else if (next === Undefined) props.remove(param.name)
            }
            if (next !== Invalid && next !== Undefined) props[param.name] = next
        }
        if (node.args.size > def.size) Validation.push(ctx, name, "", Validation.Issue.ExcessArgs(def.size, node.args.size))
        val missing = def.filter { it.required && (!props.containsKey(it.name) || props[it.name] == null) }
        if (missing.isNotEmpty()) {
            val stillInvalid = missing.filter { p ->
                if (p.defaultValue !== Undefined) {
                    props[p.name] = p.defaultValue
                    false
                } else true
            }
            if (stillInvalid.isNotEmpty()) {
                for (p in stillInvalid) {
                    Validation.push(
                        ctx, name, "/${p.name}",
                        if (props.containsKey(p.name)) Validation.Issue.NullRequired(Validation.signature(name, def))
                        else Validation.Issue.MissingRequired(Validation.signature(name, def)),
                    )
                }
                return null
            }
        }
        if (drop) return null
        return ElementNode(name, props, ctx.partial, props.values.any { containsDynamic(it) })
    }
}
