package dev.trydex.openui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive

/** Token kinds (lang-core's `T`). */
enum class T {
    Newline, LParen, RParen, LBrack, RBrack, LBrace, RBrace, Comma, Colon, Equals, EqEq, Not, NotEq, Greater, GreaterEq,
    Less, LessEq, And, Or, Dot, Question, Plus, Minus, Star, Slash, Percent, Str, Num, StateVar, True, False, Null,
    Type, Ident, BuiltinCall, EOF,
}

data class Token(val t: T, val v: Any? = null)

/** Tokenizes OpenUI Lang source (parser/lexer.ts): newlines are significant, everything else unknown is skipped. */
object Lexer {
    private fun isLower(c: Char) = c in 'a'..'z'
    private fun isUpper(c: Char) = c in 'A'..'Z'
    private fun isDigit(c: Char) = c in '0'..'9'
    private fun isIdentStart(c: Char) = isLower(c) || isUpper(c) || c == '_'
    private fun isIdentPart(c: Char) = isIdentStart(c) || isDigit(c)

    fun tokenize(src: String): List<Token> {
        val tokens = ArrayList<Token>()
        var i = 0
        val n = src.length
        fun single(kind: T) {
            tokens += Token(kind)
            i++
        }
        while (i < n) {
            while (i < n && (src[i] == ' ' || src[i] == '\t' || src[i] == '\r')) i++
            if (i >= n) break
            val c = src[i]
            when (c) {
                '\n' -> { single(T.Newline); continue }
                '(' -> { single(T.LParen); continue }
                ')' -> { single(T.RParen); continue }
                '[' -> { single(T.LBrack); continue }
                ']' -> { single(T.RBrack); continue }
                '{' -> { single(T.LBrace); continue }
                '}' -> { single(T.RBrace); continue }
                ',' -> { single(T.Comma); continue }
                ':' -> { single(T.Colon); continue }
                '.' -> { single(T.Dot); continue }
                '?' -> { single(T.Question); continue }
                '+' -> { single(T.Plus); continue }
                '*' -> { single(T.Star); continue }
                '/' -> { single(T.Slash); continue }
                '%' -> { single(T.Percent); continue }
                '=', '!', '>', '<' -> {
                    val double = i + 1 < n && src[i + 1] == '='
                    tokens += Token(
                        when (c) {
                            '=' -> if (double) T.EqEq else T.Equals
                            '!' -> if (double) T.NotEq else T.Not
                            '>' -> if (double) T.GreaterEq else T.Greater
                            else -> if (double) T.LessEq else T.Less
                        },
                    )
                    i += if (double) 2 else 1
                    continue
                }
                '&', '|' -> {
                    tokens += Token(if (c == '&') T.And else T.Or)
                    i += if (i + 1 < n && src[i + 1] == c) 2 else 1
                    continue
                }
                '"' -> {
                    val start = i
                    i++
                    var closed = false
                    while (i < n) {
                        if (src[i] == '\\') i += 2
                        else if (src[i] == '"') {
                            i++
                            closed = true
                            break
                        } else i++
                    }
                    val raw = src.substring(start, minOf(i, n))
                    tokens += Token(T.Str, jsonString(if (closed) raw else "$raw\"") ?: raw.removePrefix("\"").removeSuffix("\""))
                    continue
                }
                '\'' -> {
                    i++
                    val result = StringBuilder()
                    while (i < n) {
                        if (src[i] == '\\') {
                            i++
                            if (i < n) {
                                when (val escape = src[i]) {
                                    '\'' -> result.append('\'')
                                    '\\' -> result.append('\\')
                                    'n' -> result.append('\n')
                                    't' -> result.append('\t')
                                    else -> result.append(escape)
                                }
                                i++
                            }
                        } else if (src[i] == '\'') {
                            i++
                            break
                        } else {
                            result.append(src[i])
                            i++
                        }
                    }
                    tokens += Token(T.Str, result.toString())
                    continue
                }
            }
            if (c == '-') {
                val prev = tokens.lastOrNull()?.t
                val afterValue = prev in setOf(T.Num, T.Str, T.Ident, T.Type, T.RParen, T.RBrack, T.True, T.False, T.Null, T.StateVar, T.BuiltinCall)
                if (afterValue || !(i + 1 < n && isDigit(src[i + 1]))) {
                    single(T.Minus)
                    continue
                }
            }
            if (isDigit(c) || (c == '-' && i + 1 < n && isDigit(src[i + 1]))) {
                val start = i
                if (src[i] == '-') i++
                while (i < n && isDigit(src[i])) i++
                if (i < n && src[i] == '.' && i + 1 < n && isDigit(src[i + 1])) {
                    i++
                    while (i < n && isDigit(src[i])) i++
                }
                if (i < n && (src[i] == 'e' || src[i] == 'E')) {
                    i++
                    if (i < n && (src[i] == '+' || src[i] == '-')) i++
                    while (i < n && isDigit(src[i])) i++
                }
                tokens += Token(T.Num, Js.numberOf(src.substring(start, i)))
                continue
            }
            if (c == '$' && i + 1 < n && isIdentStart(src[i + 1])) {
                val start = i
                i++
                while (i < n && isIdentPart(src[i])) i++
                tokens += Token(T.StateVar, src.substring(start, i))
                continue
            }
            if (isIdentStart(c)) {
                val start = i
                while (i < n && isIdentPart(src[i])) i++
                val word = src.substring(start, i)
                tokens += when (word) {
                    "true" -> Token(T.True)
                    "false" -> Token(T.False)
                    "null" -> Token(T.Null)
                    else -> Token(if (isUpper(c)) T.Type else T.Ident, word)
                }
                continue
            }
            if (c == '@' && i + 1 < n && isIdentStart(src[i + 1])) {
                i++
                val start = i
                while (i < n && isIdentPart(src[i])) i++
                tokens += Token(T.BuiltinCall, src.substring(start, i))
                continue
            }
            i++
        }
        tokens += Token(T.EOF)
        return tokens
    }

    /** JSON.parse of a double-quoted string literal, or null if it isn't valid JSON (a torn escape while streaming). */
    private fun jsonString(literal: String): String? =
        runCatching { (Json.parseToJsonElement(literal) as? JsonPrimitive)?.takeIf { it.isString }?.content }.getOrNull()
}
