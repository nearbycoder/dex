package dev.trydex.android.widget

import android.content.Context
import android.graphics.Bitmap
import androidx.core.content.edit
import dev.trydex.android.data.Faces
import dev.trydex.core.model.DexJson
import dev.trydex.core.model.WidgetSidekick
import dev.trydex.core.model.WidgetSnapshot
import java.io.File
import java.security.MessageDigest

/**
 * What the widgets draw from, kept on disk so they render without the network or the app: the latest snapshot (without
 * pictures) and each sidekick's picture as its own file.
 */
class WidgetStore(private val dir: File) {
    constructor(context: Context) : this(File(context.filesDir, "widgets"))

    private val snapshotFile get() = File(dir, "snapshot.json")
    private fun pictureFile(id: String) = File(dir, "pictures/${safe(id)}")
    private fun hashFile(id: String) = File(dir, "pictures/${safe(id)}.sha")

    fun load(): WidgetSnapshot? = runCatching {
        snapshotFile.takeIf { it.exists() }?.readText()?.let { DexJson.decodeFromString(WidgetSnapshot.serializer(), it) }
    }.getOrNull()

    /**
     * Keeps [snapshot]. With [imagesIncluded], a sidekick without a picture has none (its file goes); without (asked
     * with `images=0`), the pictures already here stay. Returns whether anything a widget shows changed.
     */
    @Synchronized
    fun save(snapshot: WidgetSnapshot, imagesIncluded: Boolean): Boolean {
        dir.mkdirs()
        File(dir, "pictures").mkdirs()
        var changed = false
        for (sidekick in snapshot.sidekicks) {
            if (!imagesIncluded) continue
            val image = sidekick.image
            val bytes = Faces.dataUrlBytes(image)
            if (bytes == null) {
                if (pictureFile(sidekick.id).delete()) changed = true
                hashFile(sidekick.id).delete()
                continue
            }
            val hash = sha(image!!)
            if (hashFile(sidekick.id).takeIf { it.exists() }?.readText() == hash) continue
            pictureFile(sidekick.id).writeBytes(bytes)
            hashFile(sidekick.id).writeText(hash)
            changed = true
        }
        // Pictures of sidekicks that are gone.
        val ids = snapshot.sidekicks.map { safe(it.id) }.toSet()
        File(dir, "pictures").listFiles()?.forEach { file -> if (file.name.removeSuffix(".sha") !in ids) file.delete() }
        val stripped = snapshot.copy(sidekicks = snapshot.sidekicks.map { it.copy(image = null) })
        if (stripped != load()) {
            snapshotFile.writeText(DexJson.encodeToString(WidgetSnapshot.serializer(), stripped))
            changed = true
        }
        if (imagesIncluded) File(dir, "full-at").writeText(System.currentTimeMillis().toString())
        return changed
    }

    fun hasPicture(id: String) = pictureFile(id).exists()

    /** When pictures were last fetched with the snapshot (0 if never). */
    val fullAt: Long get() = runCatching { File(dir, "full-at").readText().toLong() }.getOrDefault(0)

    fun picture(id: String): Bitmap? = pictureFile(id).takeIf { it.exists() }?.let { Faces.decode(it.readBytes()) }

    /** Their face, round on their color, [size] pixels across. */
    fun face(sidekick: WidgetSidekick, size: Int): Bitmap = Faces.round(picture(sidekick.id), sidekick.color, sidekick.face, size)

    fun clear() {
        dir.deleteRecursively()
    }

    private fun safe(id: String) = id.replace(Regex("[^A-Za-z0-9_-]"), "_").take(80)

    private fun sha(text: String) = MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
}

/** Which sidekick each "Sidekick" widget shows (picked in its configuration). */
class WidgetChoices(context: Context) {
    private val prefs = context.getSharedPreferences("dex-widgets", Context.MODE_PRIVATE)

    fun get(appWidgetId: Int): String? = prefs.getString("w$appWidgetId", null)
    fun set(appWidgetId: Int, characterId: String) = prefs.edit { putString("w$appWidgetId", characterId) }
    fun remove(appWidgetId: Int) = prefs.edit { remove("w$appWidgetId") }
}

/** What a widget shows, decided from the stored snapshot (pure, for tests). */
sealed interface WidgetContent {
    data object SignedOut : WidgetContent
    /** Signed in, nothing fetched yet. */
    data object Loading : WidgetContent
    /** Signed in, but no sidekicks: make one in the app. */
    data object NoSidekicks : WidgetContent
    data class One(val sidekick: WidgetSidekick) : WidgetContent
    data class Several(val sidekicks: List<WidgetSidekick>, val unread: Int) : WidgetContent

    companion object {
        /** The "Sidekick" widget: the one it was set to, or the first if that one is gone (or it was never set). */
        fun single(signedIn: Boolean, snapshot: WidgetSnapshot?, characterId: String?): WidgetContent = when {
            !signedIn -> SignedOut
            snapshot == null -> Loading
            snapshot.sidekicks.isEmpty() -> NoSidekicks
            else -> One(snapshot.sidekick(characterId) ?: snapshot.sidekicks.first())
        }

        /** The "Sidekicks" widget: the first [max], unread ones first (in their order otherwise). */
        fun several(signedIn: Boolean, snapshot: WidgetSnapshot?, max: Int = 4): WidgetContent = when {
            !signedIn -> SignedOut
            snapshot == null -> Loading
            snapshot.sidekicks.isEmpty() -> NoSidekicks
            else -> Several(snapshot.sidekicks.sortedByDescending { it.unread }.take(max), snapshot.unread)
        }

        /** Opens their chat; [compose] brings the keyboard up. */
        fun chatLink(sidekick: WidgetSidekick, compose: Boolean = false) = "dex://app/chat/${sidekick.sessionId}" + if (compose) "?compose=1" else ""
    }
}
