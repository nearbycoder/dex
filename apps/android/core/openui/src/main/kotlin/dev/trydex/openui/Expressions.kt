package dev.trydex.openui

/** A Pratt parser for OpenUI Lang expressions (parser/expressions.ts). */
internal class ExpressionParser(private val tokens: List<Token>) {
    private var pos = 0

    private fun cur() = tokens.getOrElse(pos) { Token(T.EOF) }
    private fun adv(): Token = cur().also { pos++ }
    private fun eat(kind: T) {
        if (cur().t == kind) pos++
    }

    private fun infixPrecedence(token: Token) = when (token.t) {
        T.Question -> TERNARY
        T.Or -> OR
        T.And -> AND
        T.EqEq, T.NotEq -> EQ
        T.Greater, T.Less, T.GreaterEq, T.LessEq -> CMP
        T.Plus, T.Minus -> ADD
        T.Star, T.Slash, T.Percent -> MUL
        T.Dot, T.LBrack -> MEMBER
        else -> 0
    }

    fun parse(): Ast = expression(0)

    private fun expression(min: Int = 0): Ast {
        var left = prefix()
        while (infixPrecedence(cur()) > min) left = infix(left)
        return left
    }

    private fun prefix(): Ast {
        val token = cur()
        return when (token.t) {
            T.Str -> { adv(); Ast.Str(token.v as String) }
            T.Num -> { adv(); Ast.Num(token.v as Double) }
            T.True -> { adv(); Ast.Bool(true) }
            T.False -> { adv(); Ast.Bool(false) }
            T.Null -> { adv(); Ast.Null }
            T.LBrack -> array()
            T.LBrace -> obj()
            T.StateVar -> {
                val name = token.v as String
                adv()
                if (cur().t == T.Equals) {
                    adv()
                    Ast.Assign(name, expression(0))
                } else Ast.StateRef(name)
            }
            T.Type -> {
                val name = token.v as String
                // Built-ins need the @ prefix; only Action is a plain call.
                if (tokens.getOrNull(pos + 1)?.t == T.LParen && (!Builtins.isBuiltin(name) || name == "Action")) call()
                else {
                    adv()
                    Ast.Ref(name)
                }
            }
            T.BuiltinCall -> {
                if (tokens.getOrNull(pos + 1)?.t == T.LParen) {
                    val call = call()
                    if (!Builtins.isBuiltin(call.name)) Ast.Comp(call.name, call.args, call.mappedProps, fn = true) else call
                } else {
                    adv()
                    Ast.Ref(token.v as String)
                }
            }
            T.Ident -> { adv(); Ast.Ref(token.v as String) }
            T.Not -> { adv(); Ast.UnaryOp("!", expression(UNARY)) }
            T.Minus -> { adv(); Ast.UnaryOp("-", expression(UNARY)) }
            T.LParen -> {
                adv()
                val inner = expression(0)
                eat(T.RParen)
                inner
            }
            else -> { adv(); Ast.Null }
        }
    }

    private fun infix(left: Ast): Ast {
        val token = cur()
        fun binary(op: String, precedence: Int): Ast {
            adv()
            return Ast.BinOp(op, left, expression(precedence))
        }
        return when (token.t) {
            T.Plus -> binary("+", ADD)
            T.Minus -> binary("-", ADD)
            T.Star -> binary("*", MUL)
            T.Slash -> binary("/", MUL)
            T.Percent -> binary("%", MUL)
            T.EqEq -> binary("==", EQ)
            T.NotEq -> binary("!=", EQ)
            T.Greater -> binary(">", CMP)
            T.Less -> binary("<", CMP)
            T.GreaterEq -> binary(">=", CMP)
            T.LessEq -> binary("<=", CMP)
            T.And -> binary("&&", AND)
            T.Or -> binary("||", OR)
            T.Question -> {
                adv()
                val then = expression(0)
                eat(T.Colon)
                Ast.Ternary(left, then, expression(0))
            }
            T.Dot -> {
                adv()
                val field = cur()
                val name = when (field.t) {
                    T.Ident, T.Type, T.Str -> { adv(); field.v.toString() }
                    T.Num -> { adv(); Js.numberToString(field.v as Double) }
                    T.StateVar -> { adv(); (field.v as String).removePrefix("$") }
                    else -> { adv(); "?" }
                }
                Ast.Member(left, name)
            }
            T.LBrack -> {
                adv()
                val index = expression(0)
                eat(T.RBrack)
                Ast.Index(left, index)
            }
            else -> left
        }
    }

    private fun call(): Ast.Comp {
        val name = cur().v as String
        adv()
        eat(T.LParen)
        val args = ArrayList<Ast>()
        while (cur().t != T.RParen && cur().t != T.EOF) {
            args += expression(0)
            if (cur().t == T.Comma) adv()
        }
        eat(T.RParen)
        return Ast.Comp(name, args)
    }

    private fun array(): Ast {
        adv()
        val els = ArrayList<Ast>()
        while (cur().t != T.RBrack && cur().t != T.EOF) {
            els += expression(0)
            if (cur().t == T.Comma) adv()
        }
        eat(T.RBrack)
        return Ast.Arr(els)
    }

    private fun obj(): Ast {
        adv()
        val entries = ArrayList<Pair<String, Ast>>()
        while (cur().t != T.RBrace && cur().t != T.EOF) {
            val keyToken = cur()
            val key = when (keyToken.t) {
                T.Ident, T.Str, T.Type -> { adv(); keyToken.v.toString() }
                T.Num -> { adv(); Js.numberToString(keyToken.v as Double) }
                T.StateVar -> { adv(); (keyToken.v as String).removePrefix("$") }
                else -> { adv(); "?" }
            }
            eat(T.Colon)
            entries += key to expression(0)
            if (cur().t == T.Comma) adv()
        }
        eat(T.RBrace)
        return Ast.Obj(entries)
    }

    companion object {
        const val TERNARY = 1
        const val OR = 2
        const val AND = 3
        const val EQ = 4
        const val CMP = 5
        const val ADD = 6
        const val MUL = 7
        const val UNARY = 8
        const val MEMBER = 9

        fun parse(tokens: List<Token>): Ast = ExpressionParser(tokens).parse()
    }
}

/** Splits the token stream into `name = expression` statements and closes what streaming left open (statements.ts). */
internal object Statements {
    data class Raw(val id: String, val idType: T, val tokens: List<Token>)

    data class Closed(val text: String, val wasIncomplete: Boolean)

    fun autoClose(input: String): Closed {
        val stack = ArrayList<Char>()
        var inString: Char? = null
        var escape = false
        for (c in input) {
            if (escape) {
                escape = false
                continue
            }
            if (c == '\\' && inString != null) {
                escape = true
                continue
            }
            if (inString != null) {
                if (c == inString) inString = null
                continue
            }
            when (c) {
                '"', '\'' -> inString = c
                '(', '[', '{' -> stack += c
                ')' -> if (stack.lastOrNull() == '(') stack.removeAt(stack.lastIndex)
                ']' -> if (stack.lastOrNull() == '[') stack.removeAt(stack.lastIndex)
                '}' -> if (stack.lastOrNull() == '{') stack.removeAt(stack.lastIndex)
            }
        }
        val incomplete = inString != null || stack.isNotEmpty()
        if (!incomplete) return Closed(input, false)
        val out = StringBuilder(input)
        if (inString != null) {
            if (escape) out.append('\\')
            out.append(inString)
        }
        for (j in stack.indices.reversed()) out.append(if (stack[j] == '(') ')' else if (stack[j] == '[') ']' else '}')
        return Closed(out.toString(), true)
    }

    fun split(tokens: List<Token>): List<Raw> {
        val statements = ArrayList<Raw>()
        var pos = 0
        fun skipLine() {
            while (pos < tokens.size && tokens[pos].t != T.Newline && tokens[pos].t != T.EOF) pos++
        }
        while (pos < tokens.size) {
            while (pos < tokens.size && tokens[pos].t == T.Newline) pos++
            if (pos >= tokens.size || tokens[pos].t == T.EOF) break
            val token = tokens[pos]
            if (token.t != T.Ident && token.t != T.Type && token.t != T.StateVar) {
                skipLine()
                continue
            }
            val id = token.v as String
            pos++
            if (pos >= tokens.size || tokens[pos].t != T.Equals) {
                skipLine()
                continue
            }
            pos++
            val expr = ArrayList<Token>()
            var depth = 0
            var ternaryDepth = 0
            while (pos < tokens.size && tokens[pos].t != T.EOF) {
                val kind = tokens[pos].t
                if (kind == T.Newline && depth <= 0 && ternaryDepth <= 0) {
                    var peek = pos + 1
                    while (peek < tokens.size && tokens[peek].t == T.Newline) peek++
                    val next = tokens.getOrNull(peek)?.t ?: T.EOF
                    if (next == T.Question || (next == T.Colon && ternaryDepth > 0)) {
                        pos++
                        continue
                    }
                    break
                }
                if (kind == T.Newline) {
                    pos++
                    continue
                }
                when {
                    kind == T.LParen || kind == T.LBrack || kind == T.LBrace -> depth++
                    (kind == T.RParen || kind == T.RBrack || kind == T.RBrace) && depth > 0 -> depth--
                    kind == T.Question && depth == 0 -> ternaryDepth++
                    kind == T.Colon && depth == 0 && ternaryDepth > 0 -> ternaryDepth--
                }
                expr += tokens[pos++]
            }
            if (expr.isNotEmpty()) statements += Raw(id, token.t, expr)
        }
        return statements
    }
}
