package dev.trydex.core.model

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** How the activity row and tool cards describe tool calls (apps/web/src/client/components/tool-card.tsx). */
object Tools {
    private val activities = mapOf(
        "bash" to "Running a command",
        "read_file" to "Reading a file",
        "write_file" to "Writing a file",
        "edit_file" to "Editing a file",
        "web_search" to "Searching the web",
        "web_fetch" to "Reading a page",
        "schedule_prompt" to "Scheduling a prompt",
        "list_scheduled_prompts" to "Checking the schedule",
        "cancel_scheduled_prompt" to "Cancelling a scheduled prompt",
        "vm_exec" to "Running on the VM",
        "vm_read_file" to "Reading a file on the VM",
        "vm_write_file" to "Writing a file on the VM",
        "vm_expose_port" to "Opening a port",
        "vm_screenshot" to "Looking at the VM's screen",
        "vm_stop" to "Stopping the VM",
        "share_media" to "Sharing a file from the VM",
        "app_operations" to "Looking up app operations",
        "app_call" to "Managing Dex",
    )

    /** "Running a command", "Using github" (MCP tools are `<prefix>__<tool>`), "Reading a skill". */
    fun activity(name: String): String = when {
        "skill" in name -> "Reading a skill"
        "__" in name -> "Using ${name.substringBefore("__")}"
        else -> activities[name] ?: "Using $name"
    }

    private val summaryKeys = listOf("command", "path", "query", "url", "prompt", "name", "id", "operation")

    /** The argument worth showing beside a tool's name: its command, path, query, … (first line), else its JSON. */
    fun summarize(arguments: JsonElement?): String {
        val args = arguments as? JsonObject ?: return ""
        for (key in summaryKeys) {
            val value = args[key].str
            if (!value.isNullOrEmpty()) return value.lineSequence().first()
        }
        return args.toString().take(120)
    }

    /** Which icon a tool gets (the app maps these keys to Material symbols). */
    enum class Icon { Terminal, FileText, FilePen, Search, Globe, Clock, Monitor, Camera, Book, Plug, Wrench }

    private val icons = mapOf(
        "bash" to Icon.Terminal,
        "read_file" to Icon.FileText,
        "write_file" to Icon.FilePen,
        "edit_file" to Icon.FilePen,
        "web_search" to Icon.Search,
        "web_fetch" to Icon.Globe,
        "schedule_prompt" to Icon.Clock,
        "list_scheduled_prompts" to Icon.Clock,
        "cancel_scheduled_prompt" to Icon.Clock,
        "vm_exec" to Icon.Monitor,
        "vm_read_file" to Icon.FileText,
        "vm_write_file" to Icon.FilePen,
        "vm_expose_port" to Icon.Globe,
        "vm_screenshot" to Icon.Camera,
        "vm_stop" to Icon.Monitor,
    )

    fun icon(name: String): Icon = when {
        "skill" in name -> Icon.Book
        else -> icons[name] ?: if ("__" in name) Icon.Plug else Icon.Wrench
    }

    const val RENDER_UI = "render_ui"

    /** A render_ui call with its program: shown as a card, not folded into the activity row. */
    fun isUi(block: ContentBlock): Boolean = block is ToolCallBlock && block.name == RENDER_UI && block.arguments["code"].str != null

    /** Thinking and tool calls: the work behind a reply. */
    fun isWork(block: ContentBlock): Boolean =
        (block is ThinkingBlock && block.thinking.isNotBlank()) || (block is ToolCallBlock && !isUi(block))

    private val memoryFile = Regex("(^|/)MEMORY\\.md$", RegexOption.IGNORE_CASE)
    private val memoryWrite = Regex("(>|\\btee\\b|sed\\s+-i)")

    /** Memory feeds every future chat, so a change to it is always shown in the reply. */
    fun touchesMemory(block: ContentBlock): Boolean {
        if (block !is ToolCallBlock) return false
        val args = block.arguments
        return when (block.name) {
            "write_file", "edit_file" -> memoryFile.containsMatchIn(args["path"].text ?: "")
            "bash" -> {
                val command = args["command"].text ?: ""
                Regex("MEMORY\\.md", RegexOption.IGNORE_CASE).containsMatchIn(command) && memoryWrite.containsMatchIn(command)
            }
            else -> false
        }
    }

    /** The latest line of some thinking or notes, as plain text, for the activity row. */
    fun latestLine(text: String): String =
        text.lines()
            .map { it.replace(Regex("[*_`#>]+"), "").replace(Regex("\\s+"), " ").trim() }
            .lastOrNull { it.isNotEmpty() }
            ?.takeLast(200) ?: ""
}

/** The note Dex puts in front of a message about what you did in the chat's generated UI (shared/ui-notes.ts). */
object UiNotes {
    private const val HEADER = "[Done in this chat's UI since my last message]"

    data class Split(val notes: List<String>, val text: String)

    fun split(text: String): Split {
        if (!text.startsWith("$HEADER\n")) return Split(emptyList(), text)
        val end = text.indexOf("\n\n")
        val block = if (end == -1) text else text.substring(0, end)
        return Split(block.split("\n").drop(1).map { it.removePrefix("- ") }, if (end == -1) "" else text.substring(end + 2))
    }
}

object Skills {
    val NAME = Regex("^[a-z0-9][a-z0-9-]{0,63}$")
    private val INVOKED = Regex("^/([a-z0-9][a-z0-9-]{0,63})(?=\\s|$)")
    /** The composer's slash lookup: the whole text is `/` and name characters. */
    private val SLASH = Regex("^/([a-z0-9-]*)$", RegexOption.IGNORE_CASE)

    /** A message that starts with `/<name>` asks for that skill. */
    fun invoked(text: String): String? = INVOKED.find(text.trimStart())?.groupValues?.get(1)

    fun slashQuery(text: String): String? = SLASH.find(text)?.groupValues?.get(1)

    fun slug(value: String): String =
        value.lowercase().replace(Regex("[^a-z0-9]+"), "-").replace(Regex("^-+|-+$"), "").take(64)

    /** Installed skills for a slash query: names containing it, prefix matches first, then alphabetical; at most 6. */
    fun matching(skills: List<SkillInfo>, query: String): List<SkillInfo> {
        val q = query.lowercase()
        return skills.filter { q in it.id }
            .sortedWith(compareByDescending<SkillInfo> { it.id.startsWith(q) }.thenBy { it.id })
            .take(6)
    }

    val SUGGESTIONS = listOf("pdf", "frontend design", "code review", "testing", "docs", "seo")
}
