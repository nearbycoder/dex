package dev.trydex.openui

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** OpenUI Lang's expression tree (ASTNode in lang-core's parser/ast.ts); `k` names match its discriminants. */
sealed interface Ast {
    /** A component, built-in, function, action step, Query, or Mutation call. `mappedProps` are its args by name. */
    class Comp(val name: String, val args: List<Ast>, var mappedProps: Map<String, Ast>? = null, val fn: Boolean = false) : Ast {
        fun copy(args: List<Ast> = this.args, mappedProps: Map<String, Ast>? = this.mappedProps) = Comp(name, args, mappedProps, fn)
        override fun equals(other: Any?) = other is Comp && other.name == name && other.args == args && other.mappedProps == mappedProps && other.fn == fn
        override fun hashCode() = name.hashCode() * 31 + args.hashCode()
        override fun toString() = "Comp($name, $args)"
    }

    data class Str(val v: String) : Ast
    data class Num(val v: Double) : Ast
    data class Bool(val v: Boolean) : Ast
    data object Null : Ast
    data class Arr(val els: List<Ast>) : Ast
    data class Obj(val entries: List<Pair<String, Ast>>) : Ast
    data class Ref(val n: String) : Ast
    /** A placeholder for a reference that couldn't be resolved. */
    data class Ph(val n: String) : Ast
    data class StateRef(val n: String) : Ast
    /** A Query or Mutation result, read at runtime. `refType` is "query" or "mutation". */
    data class RuntimeRef(val n: String, val refType: String) : Ast
    data class BinOp(val op: String, val left: Ast, val right: Ast) : Ast
    data class UnaryOp(val op: String, val operand: Ast) : Ast
    data class Ternary(val cond: Ast, val then: Ast, val otherwise: Ast) : Ast
    data class Member(val obj: Ast, val field: String) : Ast
    data class Index(val obj: Ast, val index: Ast) : Ast
    data class Assign(val target: String, val value: Ast) : Ast

    /** The node as lang-core's object (for goldens and saved state). */
    fun toJson(): JsonElement {
        fun o(vararg pairs: Pair<String, JsonElement>) = JsonObject(linkedMapOf(*pairs))
        fun k(kind: String) = "k" to JsonPrimitive(kind)
        fun s(value: String) = JsonPrimitive(value)
        return when (this) {
            is Comp -> JsonObject(buildMap {
                put("k", s("Comp"))
                put("name", s(name))
                put("args", JsonArray(args.map { it.toJson() }))
                mappedProps?.let { props -> put("mappedProps", JsonObject(props.mapValues { it.value.toJson() })) }
                if (fn) put("fn", JsonPrimitive(true))
            })
            is Str -> o(k("Str"), "v" to s(v))
            is Num -> o(k("Num"), "v" to Js.toJson(v))
            is Bool -> o(k("Bool"), "v" to JsonPrimitive(v))
            Null -> o(k("Null"))
            is Arr -> o(k("Arr"), "els" to JsonArray(els.map { it.toJson() }))
            is Obj -> o(k("Obj"), "entries" to JsonArray(entries.map { (key, value) -> JsonArray(listOf(s(key), value.toJson())) }))
            is Ref -> o(k("Ref"), "n" to s(n))
            is Ph -> o(k("Ph"), "n" to s(n))
            is StateRef -> o(k("StateRef"), "n" to s(n))
            is RuntimeRef -> o(k("RuntimeRef"), "n" to s(n), "refType" to s(refType))
            is BinOp -> o(k("BinOp"), "op" to s(op), "left" to left.toJson(), "right" to right.toJson())
            is UnaryOp -> o(k("UnaryOp"), "op" to s(op), "operand" to operand.toJson())
            is Ternary -> o(k("Ternary"), "cond" to cond.toJson(), "then" to then.toJson(), "else" to otherwise.toJson())
            is Member -> o(k("Member"), "obj" to obj.toJson(), "field" to s(field))
            is Index -> o(k("Index"), "obj" to obj.toJson(), "index" to index.toJson())
            is Assign -> o(k("Assign"), "target" to s(target), "value" to value.toJson())
        }
    }

    companion object {
        /** Runtime expression nodes survive the parser's lowering and are resolved by the evaluator. */
        fun isRuntimeExpr(node: Ast) = when (node) {
            is StateRef, is RuntimeRef, is BinOp, is UnaryOp, is Ternary, is Member, is Index, is Assign -> true
            else -> false
        }

        fun walk(node: Ast, visit: (Ast) -> Unit) {
            visit(node)
            when (node) {
                is Comp -> {
                    node.args.forEach { walk(it, visit) }
                    node.mappedProps?.values?.forEach { walk(it, visit) }
                }
                is Arr -> node.els.forEach { walk(it, visit) }
                is Obj -> node.entries.forEach { walk(it.second, visit) }
                is BinOp -> { walk(node.left, visit); walk(node.right, visit) }
                is UnaryOp -> walk(node.operand, visit)
                is Ternary -> { walk(node.cond, visit); walk(node.then, visit); walk(node.otherwise, visit) }
                is Member -> walk(node.obj, visit)
                is Index -> { walk(node.obj, visit); walk(node.index, visit) }
                is Assign -> walk(node.value, visit)
                else -> Unit
            }
        }

        /** A plain value as AST (toLiteralAST). */
        fun literal(value: Any?): Ast = when (value) {
            null, Undefined -> Null
            is String -> Str(value)
            is Double -> Num(value)
            is Number -> Num(value.toDouble())
            is Boolean -> Bool(value)
            is List<*> -> Arr(value.map { literal(it) })
            is Map<*, *> -> Obj(value.entries.map { (key, item) -> key.toString() to literal(item) })
            else -> Null
        }

        /** The value of a literal node, or null (Kotlin's) if it holds a reference or call (literalValue). */
        fun literalValue(node: Ast): Literal? = when (node) {
            is Str -> Literal(node.v)
            is Num -> Literal(node.v)
            is Bool -> Literal(node.v)
            Null -> Literal(null)
            is Arr -> {
                val values = node.els.map { literalValue(it) ?: return null }
                Literal(values.map { it.v })
            }
            is Obj -> {
                val values = LinkedHashMap<String, Any?>()
                for ((key, item) in node.entries) values[key] = (literalValue(item) ?: return null).v
                Literal(values)
            }
            else -> null
        }
    }
}

/** A literal's value (`{ v }` in lang-core: a wrapper so that a null value differs from "not a literal"). */
data class Literal(val v: Any?)

/** A component instance: its library name and its props, named from the positional args. */
class ElementNode(
    val typeName: String,
    val props: Map<String, Any?>,
    val partial: Boolean,
    /** False when every prop is a plain value, so evaluation can skip it. */
    val hasDynamicProps: Boolean? = null,
    var statementId: String? = null,
) {
    fun copy(props: Map<String, Any?> = this.props) = ElementNode(typeName, props, partial, hasDynamicProps, statementId)

    fun toJson(): JsonElement = JsonObject(buildMap {
        put("type", JsonPrimitive("element"))
        statementId?.let { put("statementId", JsonPrimitive(it)) }
        put("typeName", JsonPrimitive(typeName))
        put("props", Js.toJson(props))
        put("partial", JsonPrimitive(partial))
        hasDynamicProps?.let { put("hasDynamicProps", JsonPrimitive(it)) }
    })

    override fun equals(other: Any?) = other is ElementNode && other.typeName == typeName && other.props == props &&
        other.partial == partial && other.statementId == statementId

    override fun hashCode() = typeName.hashCode() * 31 + props.hashCode()
    override fun toString() = "ElementNode($typeName, $props)"
}

/** One step of a button's plan (ActionStep). */
sealed interface ActionStep {
    data class Run(val statementId: String, val refType: String) : ActionStep
    data class ToAssistant(val message: String, val context: Any? = Undefined) : ActionStep
    data class OpenUrl(val url: String) : ActionStep
    data class SetState(val target: String, val valueAst: Ast) : ActionStep
    data class Reset(val targets: List<String>) : ActionStep
    /** A library action (Dex's OpenChat, OpenFile, OpenMachine, Copy). */
    class Custom(val name: String, val params: Map<String, Any?>) : ActionStep

    fun toJson(): JsonElement = when (this) {
        is Run -> JsonObject(mapOf("type" to JsonPrimitive("run"), "statementId" to JsonPrimitive(statementId), "refType" to JsonPrimitive(refType)))
        is ToAssistant -> JsonObject(buildMap {
            put("type", JsonPrimitive("continue_conversation"))
            put("message", JsonPrimitive(message))
            if (context !== Undefined) put("context", Js.toJson(context))
        })
        is OpenUrl -> JsonObject(mapOf("type" to JsonPrimitive("open_url"), "url" to JsonPrimitive(url)))
        is SetState -> JsonObject(mapOf("type" to JsonPrimitive("set"), "target" to JsonPrimitive(target), "valueAST" to valueAst.toJson()))
        is Reset -> JsonObject(mapOf("type" to JsonPrimitive("reset"), "targets" to JsonArray(targets.map { JsonPrimitive(it) })))
        is Custom -> JsonObject(mapOf("type" to JsonPrimitive("custom_action"), "name" to JsonPrimitive(name), "params" to Js.toJson(params)))
    }
}

/** What a button does when pressed: its steps, in order. */
data class ActionPlan(val steps: List<ActionStep>)

/** A two-way binding: setting the prop writes `expr` (with `$value`) to the `$variable` named `target`. */
data class ReactiveAssign(val target: String, val expr: Ast)
