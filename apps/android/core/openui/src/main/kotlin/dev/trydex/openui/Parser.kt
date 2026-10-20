package dev.trydex.openui

/** A Query() statement's args, kept as AST for the runtime. */
data class QueryStatement(
    val statementId: String,
    val toolAst: Ast?,
    val argsAst: Ast?,
    val defaultsAst: Ast?,
    val refreshAst: Ast?,
    val deps: List<String>?,
    val complete: Boolean,
)

data class MutationStatement(val statementId: String, val toolAst: Ast?, val argsAst: Ast?)

data class ParseMeta(
    val incomplete: Boolean,
    val unresolved: List<String>,
    val orphaned: List<String>,
    val statementCount: Int,
    val errors: List<ValidationError>,
)

/** One parse of a program (ParseResult). */
data class ParseResult(
    val root: ElementNode?,
    /** Set when the entry picks a component at runtime (`root = $t ? A : B`). */
    val rootExpression: Ast? = null,
    val meta: ParseMeta,
    /** `$variable` declarations and their defaults. */
    val stateDeclarations: Map<String, Any?>,
    val queryStatements: List<QueryStatement>,
    val mutationStatements: List<MutationStatement>,
)

/** Parses OpenUI Lang (parser/parser.ts). */
class OpenUIParser(private val catalog: Catalog) {
    private sealed interface Statement {
        val id: String
        data class Value(override val id: String, val expr: Ast) : Statement
        data class State(override val id: String, val init: Ast) : Statement
        data class Query(override val id: String, val args: List<Ast>, val expr: Ast, val deps: List<String>?) : Statement
        data class Mutation(override val id: String, val args: List<Ast>, val expr: Ast) : Statement
    }

    private class PartialRef(val name: String, val statements: Set<Statement>)

    fun parse(input: String): ParseResult {
        val trimmed = preprocess(input)
        if (trimmed.isEmpty()) return empty()
        val closed = Statements.autoClose(trimmed)
        val raw = Statements.split(Lexer.tokenize(closed.text))
        if (raw.isEmpty()) return empty(closed.wasIncomplete)
        val map = LinkedHashMap<String, Statement>()
        for (s in raw) {
            // Re-declaring a name replaces it but keeps its first position, as a JS Map does.
            map[s.id] = classify(s, ExpressionParser.parse(s.tokens))
        }
        return build(map, closed.wasIncomplete, map.size)
    }

    private fun empty(incomplete: Boolean = true) =
        ParseResult(null, null, ParseMeta(incomplete, emptyList(), emptyList(), 0, emptyList()), emptyMap(), emptyList(), emptyList())

    private fun classify(raw: Statements.Raw, expr: Ast): Statement {
        if (expr is Ast.Comp && expr.name == Builtins.QUERY) {
            val deps = queryDeps(expr.args.getOrNull(1))
            return Statement.Query(raw.id, expr.args, expr, deps.ifEmpty { null })
        }
        if (expr is Ast.Comp && expr.name == Builtins.MUTATION) return Statement.Mutation(raw.id, expr.args, expr)
        if (raw.idType == T.StateVar) return Statement.State(raw.id, expr)
        return Statement.Value(raw.id, expr)
    }

    private fun queryDeps(node: Ast?): List<String> {
        if (node == null) return emptyList()
        val refs = LinkedHashSet<String>()
        Ast.walk(node) { if (it is Ast.StateRef) refs += it.n }
        return refs.toList()
    }

    private fun isComponentCall(node: Ast?): Boolean =
        node is Ast.Comp && !node.fn && !Builtins.isBuiltin(node.name) && !Builtins.isReserved(node.name)

    private fun pickEntry(map: Map<String, Statement>): Pair<String, Boolean>? {
        if (map.containsKey("root")) return "root" to false
        for (s in map.values) {
            if (s is Statement.Value && isComponentCall(s.expr) && (s.expr as Ast.Comp).name == catalog.root) return s.id to true
        }
        return null
    }

    private fun resolvesToComponentCall(start: Ast?, syms: Map<String, Ast>): Boolean {
        var node = start
        val seen = HashSet<String>()
        while (node is Ast.Ref && seen.add(node.n)) node = syms[node.n]
        return isComponentCall(node)
    }

    private fun containsComponent(node: Ast): Boolean {
        var found = false
        Ast.walk(node) { if (isComponentCall(it)) found = true }
        return found
    }

    private fun build(map: Map<String, Statement>, incomplete: Boolean, count: Int, partialRef: PartialRef? = null): ParseResult {
        val entry = pickEntry(map)
        val syms = LinkedHashMap<String, Ast>()
        for ((id, s) in map) syms[id] = when (s) {
            is Statement.State -> s.init
            is Statement.Value -> s.expr
            is Statement.Query -> s.expr
            is Statement.Mutation -> s.expr
        }
        val unreached = LinkedHashSet<String>()
        for ((id, s) in map) {
            if (id == entry?.first) continue
            if (s !is Statement.Value) continue
            unreached += id
        }
        val ctx = MaterializeCtx(syms, catalog, ArrayList(), ArrayList(), HashSet(), incomplete, entry?.first, unreached)
        var root: ElementNode? = null
        var rootExpression: Ast? = null
        if (entry != null) {
            val materialized = Materialize.value(syms.getValue(entry.first), ctx)
            if (materialized is ElementNode) {
                root = materialized
                root.statementId = entry.first
            } else if (materialized is Ast && containsComponent(materialized)) {
                rootExpression = materialized
            }
        }

        val states = LinkedHashMap<String, Any?>()
        val queries = ArrayList<QueryStatement>()
        val mutations = ArrayList<MutationStatement>()
        for (s in map.values) {
            when (s) {
                is Statement.State -> states[s.id] = Materialize.value(s.init, ctx)
                is Statement.Query -> {
                    Materialize.nameRawCallArgs(s.args, ctx, s.id)
                    queries += QueryStatement(s.id, s.args.getOrNull(0), s.args.getOrNull(1), s.args.getOrNull(2), s.args.getOrNull(3), s.deps, true)
                }
                is Statement.Mutation -> {
                    Materialize.nameRawCallArgs(s.args, ctx, s.id)
                    mutations += MutationStatement(s.id, s.args.getOrNull(0), s.args.getOrNull(1))
                }
                is Statement.Value -> Unit
            }
        }
        // Any $variable used but not declared gets a null default.
        for (s in map.values) {
            val nodes = when (s) {
                is Statement.State -> listOf(s.init)
                is Statement.Value -> listOf(s.expr)
                is Statement.Query -> s.args
                is Statement.Mutation -> s.args
            }
            for (node in nodes) for (dep in queryDeps(node)) {
                if (dep == partialRef?.name && s in partialRef.statements) continue
                if (!states.containsKey(dep)) states[dep] = null
            }
        }

        ctx.currentStatementId = entry?.first
        val component = catalog.root ?: ""
        when {
            entry == null -> Validation.push(ctx, component, "", Validation.Issue.NoRoot("missing"))
            root == null && rootExpression == null && !resolvesToComponentCall(syms[entry.first], syms) ->
                Validation.push(ctx, component, "", Validation.Issue.NoRoot("not-component"))
            entry.second -> Validation.push(ctx, component, "", Validation.Issue.NoRoot(if (root != null) "fallback" else "missing"))
        }
        val orphaned = if (entry != null) unreached.toList() else emptyList()
        return ParseResult(
            root = root,
            rootExpression = rootExpression,
            meta = ParseMeta(incomplete, ctx.unresolved.toList(), orphaned, count, ctx.errors.toList()),
            stateDeclarations = states,
            queryStatements = queries,
            mutationStatements = mutations,
        )
    }

    /**
     * An incremental parser for a program that's still streaming in: completed statements are parsed once and
     * cached; the trailing statement is closed up and parsed on every update (createStreamParser).
     */
    inner class Stream {
        private var buffer = ""
        private var cleaned = ""
        private var completedEnd = 0
        private val completed = LinkedHashMap<String, Statement>()
        private var completedCount = 0

        private fun add(text: String) {
            val t = text.trim()
            if (t.isEmpty()) return
            for (s in Statements.split(Lexer.tokenize(t))) {
                completed[s.id] = classify(s, ExpressionParser.parse(s.tokens))
                completedCount++
            }
        }

        private fun refresh() {
            val next = preprocess(buffer)
            if (!next.startsWith(cleaned.substring(0, minOf(completedEnd, cleaned.length)))) {
                completedEnd = 0
                completed.clear()
                completedCount = 0
            }
            cleaned = next
        }

        private fun scan(): Int {
            var depth = 0
            var ternaryDepth = 0
            var inString: Char? = null
            var escape = false
            var start = completedEnd
            var i = completedEnd
            while (i < cleaned.length) {
                val c = cleaned[i]
                if (escape) {
                    escape = false
                    i++
                    continue
                }
                if (c == '\\' && inString != null) {
                    escape = true
                    i++
                    continue
                }
                if (inString != null) {
                    if (c == inString) inString = null
                    i++
                    continue
                }
                when {
                    c == '"' || c == '\'' -> inString = c
                    c == '(' || c == '[' || c == '{' -> depth++
                    c == ')' || c == ']' || c == '}' -> depth = maxOf(0, depth - 1)
                    c == '?' && depth == 0 -> ternaryDepth++
                    c == ':' && depth == 0 && ternaryDepth > 0 -> ternaryDepth--
                    c == '\n' && depth <= 0 && ternaryDepth <= 0 -> {
                        var peek = i + 1
                        while (peek < cleaned.length && cleaned[peek] in " \t\r\n") peek++
                        if (peek < cleaned.length && (cleaned[peek] == '?' || (cleaned[peek] == ':' && ternaryDepth > 0))) {
                            i++
                            continue
                        }
                        val t = cleaned.substring(start, i).trim()
                        if (t.isNotEmpty()) add(t)
                        start = i + 1
                        completedEnd = i + 1
                    }
                }
                i++
            }
            return start
        }

        fun result(complete: Boolean = false): ParseResult {
            refresh()
            val pendingStart = scan()
            val pending = cleaned.substring(minOf(pendingStart, cleaned.length)).trim()
            if (pending.isEmpty()) {
                if (completedCount == 0) return empty()
                return build(completed, false, completedCount)
            }
            val closed = Statements.autoClose(pending)
            val raw = Statements.split(Lexer.tokenize(closed.text))
            if (raw.isEmpty()) {
                if (completedCount == 0) return empty(closed.wasIncomplete)
                return build(completed, closed.wasIncomplete, completedCount)
            }
            val all = LinkedHashMap(completed)
            val pendingStatements: MutableSet<Statement> = Collections.newSetFromMap(java.util.IdentityHashMap())
            for (s in raw) {
                if (completed.containsKey(s.id) && closed.wasIncomplete) continue
                val statement = classify(s, ExpressionParser.parse(s.tokens))
                all[s.id] = statement
                pendingStatements += statement
            }
            // A `$name` ending the text may still be growing (`$d` of `$dishes`).
            val tail = if (complete) null else Regex("\\$\\w+$").find(buffer)?.value
            val tailName = tail?.takeIf {
                pending.endsWith(it) && !Regex(Regex.escape(it) + "(?!\\w)").containsMatchIn(pending.dropLast(it.length))
            }
            return build(all, closed.wasIncomplete, completedCount + raw.size, tailName?.let { PartialRef(it, pendingStatements) })
        }

        fun push(chunk: String, complete: Boolean = false): ParseResult {
            buffer += chunk
            return result(complete)
        }

        /** Sets the whole text so far; a text that isn't a continuation starts over. */
        fun set(text: String, complete: Boolean = false): ParseResult {
            if (text.length < buffer.length || !text.startsWith(buffer)) reset()
            buffer = text
            return result(complete)
        }

        private fun reset() {
            buffer = ""
            cleaned = ""
            completedEnd = 0
            completed.clear()
            completedCount = 0
        }
    }

    fun stream() = Stream()

    companion object {
        private fun skipString(input: String, start: Int): Int {
            if (input.getOrNull(start) != '"') return start
            var i = start + 1
            while (i < input.length) {
                when (input[i]) {
                    '\\' -> i += 2
                    '"' -> return i + 1
                    else -> i++
                }
            }
            return i
        }

        private fun fenceAt(input: String, i: Int) = i + 2 < input.length && input[i] == '`' && input[i + 1] == '`' && input[i + 2] == '`'

        /** The code inside markdown fences, or the input as is (stripFences). */
        fun stripFences(input: String): String {
            val blocks = ArrayList<String>()
            var i = 0
            while (i < input.length) {
                var fenceStart = -1
                while (i < input.length) {
                    val next = skipString(input, i)
                    if (next > i) {
                        i = next
                        continue
                    }
                    if (fenceAt(input, i)) {
                        fenceStart = i
                        break
                    }
                    i++
                }
                if (fenceStart == -1) break
                var j = fenceStart + 3
                while (j < input.length && input[j] != '\n') j++
                if (j >= input.length) {
                    blocks += input.substring(fenceStart + 3).replaceFirst(Regex("^[^\\n]*\\n?"), "")
                    i = input.length
                    break
                }
                j++
                var close = -1
                var k = j
                while (k < input.length) {
                    val next = skipString(input, k)
                    if (next > k) {
                        k = next
                        continue
                    }
                    if (fenceAt(input, k)) {
                        close = k
                        break
                    }
                    k++
                }
                if (close != -1) {
                    blocks += input.substring(j, close)
                    i = close + 3
                } else {
                    blocks += input.substring(minOf(j, input.length))
                    i = input.length
                }
            }
            if (blocks.isNotEmpty()) return blocks.joinToString("\n")
            if (input.startsWith("```")) {
                var j = 3
                while (j < input.length && input[j] != '\n') j++
                val start = if (j < input.length) j + 1 else 3
                val body = input.substring(minOf(start, input.length))
                val trailing = body.lastIndexOf("```")
                return if (trailing != -1) body.substring(0, trailing) else body
            }
            return input
        }

        /** Drops `//` and `#` line comments outside strings. */
        fun stripComments(input: String): String {
            var inString: Char? = null
            return input.split("\n").joinToString("\n") { line ->
                var i = 0
                var cut: String? = null
                while (i < line.length) {
                    val c = line[i]
                    if (inString != null) {
                        if (c == '\\' && i + 1 < line.length) {
                            i += 2
                            continue
                        }
                        if (c == inString) inString = null
                        i++
                        continue
                    }
                    if (c == '"' || c == '\'') {
                        inString = c
                        i++
                        continue
                    }
                    if (c == '/' && line.getOrNull(i + 1) == '/') {
                        cut = line.substring(0, i).trimEnd()
                        break
                    }
                    if (c == '#') {
                        cut = line.substring(0, i).trimEnd()
                        break
                    }
                    i++
                }
                cut ?: line
            }
        }

        fun preprocess(input: String): String = stripComments(stripFences(input.trim())).trim()
    }
}

private typealias Collections = java.util.Collections

/** The result as lang-core writes it with JSON.stringify (for goldens and debugging). */
fun ParseResult.toJson(): kotlinx.serialization.json.JsonObject {
    fun s(value: String?) = value?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull
    fun ast(node: Ast?) = node?.toJson() ?: kotlinx.serialization.json.JsonNull
    return kotlinx.serialization.json.buildJsonObject {
        put("root", root?.toJson() ?: kotlinx.serialization.json.JsonNull)
        rootExpression?.let { put("rootExpression", it.toJson()) }
        put("meta", kotlinx.serialization.json.buildJsonObject {
            put("incomplete", kotlinx.serialization.json.JsonPrimitive(meta.incomplete))
            put("unresolved", kotlinx.serialization.json.JsonArray(meta.unresolved.map { s(it) }))
            put("orphaned", kotlinx.serialization.json.JsonArray(meta.orphaned.map { s(it) }))
            put("statementCount", kotlinx.serialization.json.JsonPrimitive(meta.statementCount))
            put("errors", kotlinx.serialization.json.JsonArray(meta.errors.map { e ->
                kotlinx.serialization.json.buildJsonObject {
                    put("code", s(e.code))
                    put("component", s(e.component))
                    put("path", s(e.path))
                    put("message", s(e.message))
                    e.statementId?.let { put("statementId", s(it)) }
                    e.severity?.let { put("severity", s(it)) }
                }
            }))
        })
        put("stateDeclarations", Js.toJson(stateDeclarations))
        put("queryStatements", kotlinx.serialization.json.JsonArray(queryStatements.map { q ->
            kotlinx.serialization.json.buildJsonObject {
                put("statementId", s(q.statementId))
                put("toolAST", ast(q.toolAst))
                put("argsAST", ast(q.argsAst))
                put("defaultsAST", ast(q.defaultsAst))
                put("refreshAST", ast(q.refreshAst))
                q.deps?.let { deps -> put("deps", kotlinx.serialization.json.JsonArray(deps.map { s(it) })) }
                put("complete", kotlinx.serialization.json.JsonPrimitive(q.complete))
            }
        }))
        put("mutationStatements", kotlinx.serialization.json.JsonArray(mutationStatements.map { m ->
            kotlinx.serialization.json.buildJsonObject {
                put("statementId", s(m.statementId))
                put("toolAST", ast(m.toolAst))
                put("argsAST", ast(m.argsAst))
            }
        }))
    }
}
