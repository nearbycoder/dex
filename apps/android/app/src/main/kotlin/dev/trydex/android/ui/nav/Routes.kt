package dev.trydex.android.ui.nav

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

/** Every screen, as a saveable key (Navigation 3). Ids of "new" mean a draft that doesn't exist yet. */
@Serializable
sealed interface Route : NavKey {
    /** The tab a route lives in. */
    val tab: Tab
}

enum class Tab { Chats, Machines, Library, Settings }

// ── Chats ────────────────────────────────────────────────────────────────────

@Serializable data object ChatList : Route { override val tab get() = Tab.Chats }

@Serializable data class NewChat(val agentId: String? = null, val projectId: String? = null, val nonce: Long = 0) : Route {
    override val tab get() = Tab.Chats
}

@Serializable data class Chat(val id: String) : Route { override val tab get() = Tab.Chats }

/** A new character, from the Characters section above the chats. */
@Serializable data class NewCharacter(val nonce: Long = 0) : Route { override val tab get() = Tab.Chats }

/** A character's page opened from their conversation: beside it on wide screens, and back returns to it. */
@Serializable data class CharacterPage(val id: String, val sessionId: String) : Route { override val tab get() = Tab.Chats }

/** A chat's VM desktop beside the chat, on screens wide enough for both. */
@Serializable data class ChatMachine(val key: String) : Route { override val tab get() = Tab.Chats }

// ── Machines ─────────────────────────────────────────────────────────────────

@Serializable data object MachineList : Route { override val tab get() = Tab.Machines }

@Serializable data class Machine(val key: String) : Route { override val tab get() = Tab.Machines }

// ── Library ──────────────────────────────────────────────────────────────────

@Serializable data object LibraryHome : Route { override val tab get() = Tab.Library }

@Serializable data object ProjectList : Route { override val tab get() = Tab.Library }

@Serializable data class ProjectEditor(val id: String) : Route { override val tab get() = Tab.Library }

@Serializable data object AgentList : Route { override val tab get() = Tab.Library }

@Serializable data class AgentEditor(val id: String) : Route { override val tab get() = Tab.Library }

@Serializable data object CharacterList : Route { override val tab get() = Tab.Library }

@Serializable data class CharacterEditor(val id: String) : Route { override val tab get() = Tab.Library }

@Serializable data object SkillList : Route { override val tab get() = Tab.Library }

@Serializable data class SkillEditor(val id: String) : Route { override val tab get() = Tab.Library }

@Serializable data object McpList : Route { override val tab get() = Tab.Library }

/** An MCP server, or a new one prefilled from a template, a registry result, or a package. */
@Serializable data class McpEditor(
    val id: String,
    val template: String? = null,
    val name: String? = null,
    val url: String? = null,
    val auth: String? = null,
    val header: String? = null,
    val command: String? = null,
    val env: String? = null,
) : Route { override val tab get() = Tab.Library }

@Serializable data object Workspace : Route { override val tab get() = Tab.Library }

@Serializable data class WorkspaceFile(val path: String) : Route { override val tab get() = Tab.Library }

// ── Settings ─────────────────────────────────────────────────────────────────

@Serializable data object SettingsHome : Route { override val tab get() = Tab.Settings }

@Serializable data object GeneralSettings : Route { override val tab get() = Tab.Settings }

@Serializable data object AppearanceSettings : Route { override val tab get() = Tab.Settings }

@Serializable data object NotificationSettings : Route { override val tab get() = Tab.Settings }

@Serializable data object Secrets : Route { override val tab get() = Tab.Settings }

@Serializable data object Usage : Route { override val tab get() = Tab.Settings }

@Serializable data object Access : Route { override val tab get() = Tab.Settings }

fun Tab.root(): Route = when (this) {
    Tab.Chats -> ChatList
    Tab.Machines -> MachineList
    Tab.Library -> LibraryHome
    Tab.Settings -> SettingsHome
}

/** The routes a `dex://app/…` link opens (notifications and shortcuts), root first. */
fun routesFor(link: String): List<Route>? {
    val path = link.removePrefix("dex://app").trim('/').split('/').filter { it.isNotEmpty() }
    return when (path.firstOrNull()) {
        null -> listOf(ChatList)
        "chat" -> listOf(ChatList, path.getOrNull(1)?.let(::Chat) ?: NewChat(nonce = System.nanoTime()))
        "machine" -> listOfNotNull(MachineList, path.getOrNull(1)?.let(::Machine))
        "mcp" -> listOfNotNull(LibraryHome, McpList, path.getOrNull(1)?.let { McpEditor(it) })
        "characters" -> listOfNotNull(LibraryHome, CharacterList, path.getOrNull(1)?.let(::CharacterEditor))
        "usage" -> listOf(SettingsHome, Usage)
        "files" -> listOf(LibraryHome, Workspace)
        "access" -> listOf(SettingsHome, Access)
        "notifications" -> listOf(SettingsHome, NotificationSettings)
        "appearance" -> listOf(SettingsHome, AppearanceSettings)
        else -> null
    }
}
