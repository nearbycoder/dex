package dev.trydex.core.model

import kotlinx.serialization.Serializable

/**
 * What the home-screen widgets show (`GET /api/sidekicks`, widgetSnapshot in apps/web/src/agent/dex-agent.ts): each
 * sidekick's picture, whether they've said something you haven't seen, and their latest words, plus how many chats are
 * unread. The app makes the same from its synced state ([from]), so widgets update without a request while it's open.
 */
@Serializable
data class WidgetSnapshot(
    val unread: Int = 0,
    val sidekicks: List<WidgetSidekick> = emptyList(),
) {
    fun sidekick(id: String?): WidgetSidekick? = id?.let { key -> sidekicks.firstOrNull { it.id == key } }

    companion object {
        /** The snapshot the server would give for this state (its pictures included). */
        fun from(state: DexState): WidgetSnapshot {
            val sessions = state.sessions.associateBy { it.id }
            return WidgetSnapshot(
                unread = state.unreadCount,
                sidekicks = state.characters.map { character ->
                    val session = sessions[character.sessionId]
                    WidgetSidekick(
                        id = character.id,
                        name = character.name,
                        tagline = character.tagline,
                        color = character.color,
                        image = character.image,
                        avatar = character.avatar,
                        sessionId = character.sessionId,
                        unread = session?.unread ?: false,
                        busy = session?.busy ?: false,
                        lastReply = session?.lastReply,
                        repliedAt = session?.repliedAt,
                    )
                },
            )
        }
    }
}

@Serializable
data class WidgetSidekick(
    val id: String,
    val name: String = "",
    val tagline: String = "",
    /** One of the agent colors (Catalogs.AGENT_COLORS): their picture's background. */
    val color: String = "violet",
    /** Their picture as a data: URL; left out when asked with `images=0`. */
    val image: String? = null,
    val avatar: String = "",
    val sessionId: String = "",
    val unread: Boolean = false,
    val busy: Boolean = false,
    val lastReply: String? = null,
    val repliedAt: Long? = null,
) {
    /** What their avatar shows without a picture: the emoji, else the name's initial. */
    val face: String get() = avatar.ifEmpty { Characters.initial(name) }

    /** The line under their name: "typing…", their latest words, or their tagline. */
    val line: String
        get() = when {
            busy -> "typing…"
            !lastReply.isNullOrBlank() -> lastReply.replace(Regex("\\s+"), " ").trim()
            tagline.isNotBlank() -> tagline
            else -> "Say hi"
        }
}
