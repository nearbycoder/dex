package dev.trydex.android.data

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.URLDecoder

data class DownloadedAsset(val uri: Uri, val fileName: String, val mimeType: String)

/**
 * Downloads any chat asset (audio clips, videos, images, or attached files) straight to the device's `Downloads/Dex`
 * folder using [MediaStore.Downloads] on Android 10+ (zero storage permissions needed) and app Downloads on API 26–28.
 * Streams through Dex's authenticated [OkHttpClient] (`mediaHttp`), which attaches the session cookie per hop on Dex's
 * own origin only.
 */
object AssetDownloader {
    private val INVALID_FILENAME_CHARS = Regex("[/\\\\:*?\"<>|\\r\\n\\t\\u0000-\\u001F]")
    private val EXT_RE = Regex("\\.([A-Za-z0-9]{1,10})$")
    private val RFC5987_NAME = Regex("filename\\*\\s*=\\s*(?:UTF-8''|utf-8'')([^;\\s]+)")
    private val QUOTED_NAME = Regex("filename\\s*=\\s*\"([^\"]+)\"")

    /** Builds a clean, safe filename while preserving the asset's extension when a display title omits it. */
    fun sanitizeFileName(preferred: String?, fallback: String?, fallbackExt: String? = null): String {
        fun clean(raw: String?): String = raw.orEmpty()
            .trim()
            .replace(INVALID_FILENAME_CHARS, "_")
            .take(120)
            .trim('.', ' ')
        val cleanPreferred = clean(preferred)
        val cleanFallback = clean(fallback)
        val base = cleanPreferred.ifEmpty { cleanFallback }.ifEmpty { "download" }
        val ext = (fallbackExt ?: EXT_RE.find(cleanFallback)?.groupValues?.get(1))
            ?.trim()?.lowercase()?.takeIf { it.isNotEmpty() && it.length <= 10 }
        return if (ext != null && !base.lowercase().endsWith(".$ext")) "$base.$ext" else base
    }

    /** Extracts a filename from a `Content-Disposition` header if present. */
    fun headerFileName(contentDisposition: String?): String? {
        if (contentDisposition.isNullOrBlank()) return null
        RFC5987_NAME.find(contentDisposition)?.groupValues?.getOrNull(1)?.let { encoded ->
            return runCatching { URLDecoder.decode(encoded, "UTF-8") }.getOrNull()
        }
        return QUOTED_NAME.find(contentDisposition)?.groupValues?.getOrNull(1)
    }

    suspend fun downloadToDevice(
        context: Context,
        http: OkHttpClient,
        url: String,
        suggestedName: String? = null,
        fallbackMimeType: String? = null,
    ): Result<DownloadedAsset> = withContext(Dispatchers.IO) {
        try {
            if (url.startsWith("data:")) {
                val comma = url.indexOf(',')
                if (comma < 0 || !url.substring(0, comma).endsWith(";base64")) throw IOException("Unsupported data URL")
                val mimeType = url.substring(5, comma).substringBefore(';').lowercase().ifEmpty { fallbackMimeType ?: "application/octet-stream" }
                val bytes = android.util.Base64.decode(url.substring(comma + 1), android.util.Base64.DEFAULT)
                val extFromMime = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType)
                val fileName = sanitizeFileName(suggestedName, "download", extFromMime)
                val uri = writeToDownloads(context, fileName, mimeType) { out -> out.write(bytes); out.flush() }
                return@withContext Result.success(DownloadedAsset(uri, fileName, mimeType))
            }
            val request = Request.Builder().url(url).get().build()
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IOException("Download failed (HTTP ${response.code})")
                val body = response.body
                val urlName = runCatching { Uri.parse(url).lastPathSegment }.getOrNull()
                val headerName = headerFileName(response.header("Content-Disposition"))
                val rawMime = response.header("Content-Type")?.substringBefore(';')?.trim()?.lowercase()
                val mimeType = when {
                    !rawMime.isNullOrEmpty() && rawMime != "application/octet-stream" -> rawMime
                    !fallbackMimeType.isNullOrEmpty() -> fallbackMimeType
                    else -> {
                        val ext = EXT_RE.find(headerName ?: urlName ?: suggestedName.orEmpty())?.groupValues?.get(1)?.lowercase()
                        ext?.let { MimeTypeMap.getSingleton().getMimeTypeFromExtension(it) } ?: "application/octet-stream"
                    }
                }
                val extFromMime = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType)
                val fileName = sanitizeFileName(
                    preferred = suggestedName,
                    fallback = headerName ?: urlName,
                    fallbackExt = EXT_RE.find(urlName.orEmpty())?.groupValues?.get(1) ?: extFromMime,
                )
                val uri = writeStreamToDownloads(context, fileName, mimeType, body.byteStream())
                Result.success(DownloadedAsset(uri, fileName, mimeType))
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            Result.failure(error)
        }
    }

    suspend fun saveBitmapToDevice(context: Context, bitmap: Bitmap, suggestedName: String = "image.png"): Result<DownloadedAsset> =
        withContext(Dispatchers.IO) {
            try {
                val fileName = sanitizeFileName(suggestedName, "image.png", "png")
                val uri = writeToDownloads(context, fileName, "image/png") { out ->
                    if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) {
                        throw IOException("Couldn't encode image.")
                    }
                }
                Result.success(DownloadedAsset(uri, fileName, "image/png"))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                Result.failure(error)
            }
        }

    suspend fun saveBytesToDevice(
        context: Context,
        bytes: ByteArray,
        suggestedName: String,
        mimeType: String? = null,
    ): Result<DownloadedAsset> = withContext(Dispatchers.IO) {
        try {
            val ext = EXT_RE.find(suggestedName)?.groupValues?.get(1)?.lowercase()
            val resolvedMime = mimeType
                ?: ext?.let { MimeTypeMap.getSingleton().getMimeTypeFromExtension(it) }
                ?: "text/plain"
            val fileName = sanitizeFileName(suggestedName, "file.txt", ext)
            val uri = writeToDownloads(context, fileName, resolvedMime) { out ->
                out.write(bytes)
                out.flush()
            }
            Result.success(DownloadedAsset(uri, fileName, resolvedMime))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            Result.failure(error)
        }
    }

    private fun writeStreamToDownloads(context: Context, fileName: String, mimeType: String, input: InputStream): Uri =
        writeToDownloads(context, fileName, mimeType) { out ->
            val buf = ByteArray(8192)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                if (n > 0) out.write(buf, 0, n)
            }
            out.flush()
        }

    private fun writeToDownloads(context: Context, fileName: String, mimeType: String, write: (java.io.OutputStream) -> Unit): Uri {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                put(MediaStore.Downloads.MIME_TYPE, mimeType)
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Dex")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IOException("Couldn't create download entry.")
            try {
                resolver.openOutputStream(uri)?.use(write) ?: throw IOException("Couldn't open download stream.")
                val done = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
                resolver.update(uri, done, null, null)
                return uri
            } catch (error: Throwable) {
                runCatching { resolver.delete(uri, null, null) }
                throw error
            }
        }
        val baseDir = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.cacheDir, "Dex").apply { mkdirs() }
        var target = File(baseDir, fileName)
        var suffix = 1
        while (target.exists()) {
            val stem = fileName.substringBeforeLast('.', fileName)
            val ext = fileName.substringAfterLast('.', "")
            target = File(baseDir, if (ext.isEmpty()) "$stem ($suffix)" else "$stem ($suffix).$ext")
            suffix++
        }
        try {
            target.outputStream().use(write)
            return Uri.fromFile(target)
        } catch (error: Throwable) {
            target.delete()
            throw error
        }
    }
}
