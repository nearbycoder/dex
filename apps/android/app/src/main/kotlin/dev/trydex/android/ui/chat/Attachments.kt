package dev.trydex.android.ui.chat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import dev.trydex.android.ui.LocalApp
import dev.trydex.core.model.AttachmentLimits
import dev.trydex.core.model.ChatAttachment
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.util.UUID

/** A file being attached in the composer: its upload (to be prepared for the model), and a thumbnail while it runs. */
@Immutable
data class DraftAttachment(
    val id: String,
    val name: String,
    val mimeType: String,
    /** The picked image, for its thumbnail. */
    val preview: Uri?,
    val status: Status,
    val attachment: ChatAttachment? = null,
    val error: String? = null,
) {
    enum class Status { Uploading, Ready, Failed }
}

/** The composer's attachments (useDraftAttachments on the web): each uploads as soon as it's added. */
@Stable
class AttachmentDrafts(
    private val scope: CoroutineScope,
    private val context: Context,
    private val upload: suspend (bytes: ByteArray, name: String, mimeType: String) -> ChatAttachment,
) {
    val items = mutableStateListOf<DraftAttachment>()
    val uploading: Boolean get() = items.any { it.status == DraftAttachment.Status.Uploading }
    val failed: List<DraftAttachment> get() = items.filter { it.status == DraftAttachment.Status.Failed }
    val ready: List<ChatAttachment> get() = items.mapNotNull { if (it.status == DraftAttachment.Status.Ready) it.attachment else null }
    val full: Boolean get() = items.size >= AttachmentLimits.FILES

    fun add(uris: List<Uri>) {
        for (uri in uris.take(AttachmentLimits.FILES - items.size)) {
            val id = UUID.randomUUID().toString()
            val type = context.contentResolver.getType(uri) ?: ""
            items += DraftAttachment(id, displayName(uri), type, uri.takeIf { type.startsWith("image/") }, DraftAttachment.Status.Uploading)
            scope.launch {
                runCatching {
                    val (bytes, name, mimeType) = withContext(Dispatchers.IO) { read(uri) }
                    upload(bytes, name, mimeType)
                }.onSuccess { attachment -> update(id) { it.copy(status = DraftAttachment.Status.Ready, attachment = attachment) } }
                    .onFailure { error -> update(id) { it.copy(status = DraftAttachment.Status.Failed, error = error.message ?: "Couldn't attach ${it.name}.") } }
            }
        }
    }

    fun remove(id: String) {
        items.removeAll { it.id == id }
    }

    fun clear() = items.clear()

    private fun update(id: String, change: (DraftAttachment) -> DraftAttachment) {
        val index = items.indexOfFirst { it.id == id }
        if (index >= 0) items[index] = change(items[index])
    }

    private fun displayName(uri: Uri): String = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    }.getOrNull() ?: uri.lastPathSegment?.substringAfterLast('/') ?: "file"

    /** The file's bytes, name, and type, with HEIC photos (which the server can't read) and very large ones as JPEG. */
    private fun read(uri: Uri): Triple<ByteArray, String, String> {
        val name = displayName(uri)
        val size = runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null }
        }.getOrNull()
        if (size != null && size > AttachmentLimits.UPLOAD_BYTES) error("$name is too large (limit ${AttachmentLimits.UPLOAD_BYTES / 1024 / 1024} MB).")
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("Couldn't read $name.")
        val type = context.contentResolver.getType(uri)
            ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
            ?: "application/octet-stream"
        val heic = type == "image/heic" || type == "image/heif"
        val large = type in setOf("image/jpeg", "image/png", "image/webp") && bytes.size > LARGE_PHOTO_BYTES
        if ((heic || large) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            runCatching { toJpeg(bytes) }.getOrNull()?.let { jpeg ->
                return Triple(jpeg, name.substringBeforeLast('.') + ".jpg", "image/jpeg")
            }
        }
        return Triple(bytes, name, type)
    }

    /** Decoded upright (ImageDecoder applies the EXIF orientation), at most [MAX_PIXELS] on its longer side. */
    @androidx.annotation.RequiresApi(Build.VERSION_CODES.P)
    private fun toJpeg(bytes: ByteArray): ByteArray {
        val bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(java.nio.ByteBuffer.wrap(bytes))) { decoder, info, _ ->
            val longest = maxOf(info.size.width, info.size.height)
            if (longest > MAX_PIXELS) {
                val scale = MAX_PIXELS.toFloat() / longest
                decoder.setTargetSize((info.size.width * scale).toInt(), (info.size.height * scale).toInt())
            }
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
        return ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 88, out)
            bitmap.recycle()
            out.toByteArray()
        }
    }

    private companion object {
        /** The server scales images to fit the model anyway; this only saves uploading a camera's full-size photo. */
        const val LARGE_PHOTO_BYTES = 4 * 1024 * 1024
        const val MAX_PIXELS = 2560
    }
}

@Composable
fun rememberAttachmentDrafts(): AttachmentDrafts {
    val app = LocalApp.current
    val context = LocalContext.current.applicationContext
    val scope = rememberCoroutineScope()
    return remember { AttachmentDrafts(scope, context) { bytes, name, type -> app.graph.repository.uploadAttachment(bytes, name, type) } }
}

/** The files attached in the composer, as removable chips: images as thumbnails, others with their names. */
@Composable
fun AttachmentChips(drafts: AttachmentDrafts, modifier: Modifier = Modifier) {
    if (drafts.items.isEmpty()) return
    Column(modifier.padding(start = 12.dp, end = 12.dp, top = 8.dp)) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (draft in drafts.items) AttachmentChip(draft, onRemove = { drafts.remove(draft.id) })
        }
        drafts.failed.firstOrNull()?.let { first ->
            val more = drafts.failed.size - 1
            Text(
                (first.error ?: "Couldn't attach ${first.name}.") + if (more > 0) " (and $more more)" else "",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 6.dp).testTag("attachment-error"),
            )
        }
    }
}

@Composable
private fun AttachmentChip(draft: DraftAttachment, onRemove: () -> Unit) {
    val failed = draft.status == DraftAttachment.Status.Failed
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        border = BorderStroke(1.dp, if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.size(height = 56.dp, width = if (draft.preview != null) 56.dp else 168.dp).testTag("attachment-chip"),
    ) {
        Box {
            if (draft.preview != null) {
                AsyncImage(model = draft.preview, contentDescription = draft.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            } else {
                Row(Modifier.fillMaxSize().padding(start = 10.dp, end = 28.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Outlined.Description, contentDescription = null, tint = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
                    Text(draft.name, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            if (draft.status == DraftAttachment.Status.Uploading) {
                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface.copy(alpha = 0.6f)), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                }
            }
            Box(
                Modifier.align(Alignment.TopEnd).padding(3.dp).size(20.dp).clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.9f)),
                contentAlignment = Alignment.Center,
            ) {
                androidx.compose.material3.IconButton(onClick = onRemove, modifier = Modifier.size(20.dp)) {
                    Icon(Icons.Rounded.Close, contentDescription = "Remove ${draft.name}", modifier = Modifier.size(12.dp))
                }
            }
        }
    }
}
