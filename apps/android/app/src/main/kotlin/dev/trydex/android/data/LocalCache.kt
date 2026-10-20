package dev.trydex.android.data

import dev.trydex.core.model.ChatArtifact
import dev.trydex.core.model.DexJson
import dev.trydex.core.model.DexState
import dev.trydex.core.model.EntryRecord
import dev.trydex.core.model.ModelCatalog
import kotlinx.serialization.Serializable
import java.io.File

/**
 * What the app keeps on the device so a launch shows your chats at once while the agent wakes (the web keeps the same
 * in localStorage and IndexedDB): the last synced state, the model list, and the last 8 chats you opened. Nothing
 * secret is in it, and signing out deletes it.
 */
class LocalCache(private val dir: File) {
    private val chats = File(dir, "chats")

    init {
        dir.mkdirs()
    }

    private fun stateFile(userId: String) = File(dir, "state-${safe(userId)}.json")
    private val modelsFile = File(dir, "models.json")

    private fun safe(name: String) = name.replace(Regex("[^A-Za-z0-9_-]"), "_")

    private fun write(file: File, text: String) {
        val temp = File(file.parentFile, file.name + ".tmp")
        temp.writeText(text)
        temp.renameTo(file)
    }

    fun loadState(userId: String): DexState? = runCatching {
        stateFile(userId).takeIf { it.exists() }?.readText()?.let { DexJson.decodeFromString(DexState.serializer(), it) }
    }.getOrNull()

    fun saveState(userId: String, state: DexState) = runCatching {
        write(stateFile(userId), DexJson.encodeToString(DexState.serializer(), state))
    }

    fun loadModels(): ModelCatalog? = runCatching {
        modelsFile.takeIf { it.exists() }?.readText()?.let { DexJson.decodeFromString(ModelCatalog.serializer(), it) }
    }.getOrNull()

    fun saveModels(catalog: ModelCatalog) = runCatching { write(modelsFile, DexJson.encodeToString(ModelCatalog.serializer(), catalog)) }

    @Serializable
    data class SavedChat(val savedAt: Long, val entries: List<EntryRecord>, val artifacts: List<ChatArtifact> = emptyList())

    private fun chatFile(userId: String, sessionId: String) = File(chats, "${safe(userId)}-${safe(sessionId)}.json")

    fun loadChat(userId: String, sessionId: String): SavedChat? = runCatching {
        chatFile(userId, sessionId).takeIf { it.exists() }?.readText()?.let { DexJson.decodeFromString(SavedChat.serializer(), it) }
    }.getOrNull()

    /** Keeps a chat (if it isn't huge) and drops all but the newest [MAX_CHATS]. */
    fun saveChat(userId: String, sessionId: String, chat: SavedChat) = runCatching {
        val text = DexJson.encodeToString(SavedChat.serializer(), chat)
        if (text.length > MAX_CHAT_CHARS) return@runCatching
        chats.mkdirs()
        write(chatFile(userId, sessionId), text)
        chats.listFiles()?.sortedByDescending { it.lastModified() }?.drop(MAX_CHATS)?.forEach { it.delete() }
    }

    /** Signing out: everything but the model list (the same for everyone). */
    fun clear() {
        dir.listFiles()?.forEach { if (it != modelsFile) it.deleteRecursively() }
    }

    companion object {
        const val MAX_CHATS = 8
        const val MAX_CHAT_CHARS = 1_500_000
    }
}
