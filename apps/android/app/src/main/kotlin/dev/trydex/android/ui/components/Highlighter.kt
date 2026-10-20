package dev.trydex.android.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle

/**
 * A light syntax highlighter for code blocks, in VS Code's Dark+ colors (the web's vscDarkPlus): comments, strings,
 * numbers, keywords, and calls, for the languages chats write most.
 */
object Highlighter {
    private val comment = SpanStyle(color = Color(0xFF6A9955))
    private val string = SpanStyle(color = Color(0xFFCE9178))
    private val number = SpanStyle(color = Color(0xFFB5CEA8))
    private val keyword = SpanStyle(color = Color(0xFF569CD6))
    private val call = SpanStyle(color = Color(0xFFDCDCAA))
    private val type = SpanStyle(color = Color(0xFF4EC9B0))

    private val common = setOf(
        "if", "else", "for", "while", "do", "return", "break", "continue", "switch", "case", "default", "try", "catch", "finally",
        "throw", "new", "class", "interface", "enum", "import", "export", "from", "as", "in", "of", "is", "true", "false", "null",
        "nil", "None", "True", "False", "const", "let", "var", "val", "fun", "function", "def", "async", "await", "yield", "static",
        "public", "private", "protected", "internal", "override", "abstract", "final", "extends", "implements", "package", "struct",
        "type", "impl", "fn", "mut", "pub", "use", "mod", "match", "where", "lambda", "with", "not", "and", "or", "this", "self",
        "super", "typeof", "void", "undefined", "object", "data", "sealed", "when", "elif", "pass", "raise", "go", "defer", "func",
        "select", "insert", "update", "delete", "create", "table", "index", "values", "into", "join", "on", "group", "by", "order",
        "limit", "then", "fi", "esac", "done", "echo", "export", "local", "readonly",
    )

    private val hashComments = setOf("python", "py", "bash", "sh", "shell", "zsh", "yaml", "yml", "toml", "ruby", "rb", "dockerfile", "docker")

    fun highlight(code: String, language: String?): AnnotatedString {
        val lang = language?.lowercase()?.trim()
        if (lang == "text" || lang == "plain" || code.length > 60_000) return AnnotatedString(code)
        val hash = lang in hashComments || lang == null && code.lineSequence().any { it.trimStart().startsWith("#!") }
        val sqlComments = lang == "sql"
        return buildAnnotatedString {
            var i = 0
            val n = code.length
            while (i < n) {
                val c = code[i]
                when {
                    c == '/' && i + 1 < n && code[i + 1] == '/' && !hash -> i = span(code, i, code.indexOf('\n', i).let { if (it < 0) n else it }, comment)
                    c == '/' && i + 1 < n && code[i + 1] == '*' -> i = span(code, i, code.indexOf("*/", i + 2).let { if (it < 0) n else it + 2 }, comment)
                    c == '#' && hash -> i = span(code, i, code.indexOf('\n', i).let { if (it < 0) n else it }, comment)
                    c == '-' && sqlComments && i + 1 < n && code[i + 1] == '-' -> i = span(code, i, code.indexOf('\n', i).let { if (it < 0) n else it }, comment)
                    c == '"' || c == '\'' || c == '`' -> {
                        var j = i + 1
                        while (j < n && code[j] != c && !(code[j] == '\n' && c != '`')) j += if (code[j] == '\\') 2 else 1
                        i = span(code, i, minOf(j + 1, n), string)
                    }
                    c.isDigit() && (i == 0 || !code[i - 1].isLetterOrDigit()) -> {
                        var j = i
                        while (j < n && (code[j].isLetterOrDigit() || code[j] == '.' || code[j] == '_')) j++
                        i = span(code, i, j, number)
                    }
                    c.isLetter() || c == '_' || c == '$' -> {
                        var j = i
                        while (j < n && (code[j].isLetterOrDigit() || code[j] == '_' || code[j] == '$')) j++
                        val word = code.substring(i, j)
                        val next = code.getOrNull(j)
                        val style = when {
                            word in common || (lang == "sql" && word.lowercase() in common) -> keyword
                            next == '(' -> call
                            word.first().isUpperCase() && word.length > 1 -> type
                            else -> null
                        }
                        if (style != null) withStyle(style) { append(word) } else append(word)
                        i = j
                    }
                    else -> {
                        append(c)
                        i++
                    }
                }
            }
        }
    }

    private fun AnnotatedString.Builder.span(code: String, start: Int, end: Int, style: SpanStyle): Int {
        withStyle(style) { append(code, start, end) }
        return end
    }
}
