package dev.trydex.android.ui.components

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.outlined.AudioFile
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import coil3.compose.AsyncImage
import dev.trydex.android.data.AssetDownloader
import dev.trydex.android.ui.LocalApp
import dev.trydex.core.model.ChatArtifact
import dev.trydex.core.model.Media
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The open chat's stored files, the VM links being saved into it, and how to save one (ChatArtifacts on the web). */
class ChatMedia(
    val bySource: Map<String, ChatArtifact>,
    val saving: Set<String>,
    val save: suspend (String) -> Unit,
)

val LocalChatMedia = compositionLocalOf<ChatMedia?> { null }

/** A Dex URL (relative paths resolve against the signed-in server). */
@Composable
fun dexUrl(path: String): String {
    val server = LocalApp.current.graph.repository.session.value?.serverUrl ?: return path
    return if (path.startsWith("/")) server.resolve(path)?.toString() ?: path else path
}

/** Plays a link or image source the way the web does (videoSource + MediaPlayer). */
@Composable
fun MediaPlayer(source: Media.Source, title: String? = null, onOpen: (String) -> Unit = {}) {
    val label = title?.trim()?.ifEmpty { null }
    when (source) {
        is Media.Source.Own -> StoredMedia(dexUrl(source.url), source.kind, label)
        is Media.Source.Vm -> VmMedia(source, label, onOpen)
        is Media.Source.YouTube -> TapToPlay(
            title = label ?: "Video", detail = "YouTube · loads when you tap play", thumbnail = Media.youTubeThumbnail(source.id),
        ) { EmbedPlayer(Media.youTubeEmbed(source.id)) }
        is Media.Source.Vimeo -> TapToPlay(title = label ?: "Video", detail = "Vimeo · loads when you tap play") { EmbedPlayer(Media.vimeoEmbed(source.id)) }
        is Media.Source.File -> {
            val fileTitle = if (label == null || label == "Video") Media.fileName(source.url) else label
            TapToPlay(
                title = fileTitle,
                detail = "${Media.hostLabel(source)} · loads when you tap play",
                downloadUrl = source.url,
            ) { VideoPlayer(source.url, autoPlay = true, title = fileTitle, onOpen = onOpen) }
        }
    }
}

/** One-tap download button that saves any asset directly to `Downloads/Dex` on the device. */
@Composable
fun AssetDownloadButton(
    url: String,
    title: String? = null,
    mimeType: String? = null,
    overlay: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val http = LocalApp.current.graph.mediaHttp
    val scope = rememberCoroutineScope()
    var downloading by remember(url) { mutableStateOf(false) }
    var saved by remember(url) { mutableStateOf(false) }
    val displayName = title?.trim()?.ifEmpty { null } ?: Media.fileName(url)

    LaunchedEffect(saved) {
        if (saved) {
            delay(2_500)
            saved = false
        }
    }

    IconButton(
        onClick = {
            if (downloading) return@IconButton
            downloading = true
            scope.launch {
                AssetDownloader.downloadToDevice(context, http, url, title, mimeType)
                    .onSuccess { asset ->
                        saved = true
                        Toast.makeText(context, "Saved ${asset.fileName} to Downloads/Dex", Toast.LENGTH_SHORT).show()
                    }
                    .onFailure { error ->
                        Toast.makeText(context, error.message ?: "Couldn't download $displayName", Toast.LENGTH_SHORT).show()
                    }
                downloading = false
            }
        },
        enabled = !downloading,
        modifier = modifier
            .then(if (overlay) Modifier.size(36.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.62f)) else Modifier)
            .semantics { contentDescription = "Download $displayName" },
    ) {
        when {
            downloading -> CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = if (overlay) Color.White else MaterialTheme.colorScheme.primary,
            )
            saved -> Icon(
                Icons.Rounded.Check,
                contentDescription = "Downloaded",
                tint = if (overlay) Color(0xFF34D399) else MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(20.dp),
            )
            else -> Icon(
                Icons.Rounded.Download,
                contentDescription = "Download $displayName",
                tint = if (overlay) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

@Composable
private fun StoredMedia(url: String, kind: Media.Kind, title: String?) {
    val displayName = title?.trim()?.ifEmpty { null } ?: Media.fileName(url)
    when (kind) {
        Media.Kind.Image -> Box(Modifier.widthIn(max = 560.dp).fillMaxWidth()) {
            AsyncImage(
                model = url, contentDescription = title, contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxWidth().heightIn(max = 480.dp).clip(RoundedCornerShape(16.dp)),
            )
            AssetDownloadButton(url, displayName, overlay = true, modifier = Modifier.align(Alignment.TopEnd).padding(8.dp))
        }
        Media.Kind.Audio -> VideoPlayer(url, autoPlay = false, audio = true, title = displayName)
        Media.Kind.Video -> VideoPlayer(url, autoPlay = false, title = displayName)
    }
}

@Composable
private fun VmMedia(source: Media.Source.Vm, title: String?, onOpen: (String) -> Unit) {
    val media = LocalChatMedia.current
    val vm = Media.vmSource(source.url)
    val saved = vm?.let { media?.bySource?.get(it.source) }
    if (saved != null) {
        val kind = Media.Kind.entries.firstOrNull { it.name.equals(saved.kind, ignoreCase = true) } ?: source.kind
        StoredMedia(dexUrl(saved.url), kind, title ?: saved.name)
        return
    }
    val scope = rememberCoroutineScope()
    var savingHere by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val saving = savingHere || (vm != null && media?.saving?.contains(vm.source) == true)
    MediaCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            when {
                saving -> CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                error != null -> Icon(Icons.Rounded.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                else -> Icon(Icons.Outlined.Movie, contentDescription = null)
            }
            Column(Modifier.weight(1f)) {
                Text(title ?: Media.fileName(source.url), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    when {
                        saving -> "Saving to the chat…"
                        error != null -> error!!
                        else -> "On the chat's VM. Save it to the chat to ${if (source.kind == Media.Kind.Image) "see" else "play"} it here."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (!saving) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                FilledTonalButton(onClick = {
                    savingHere = true
                    error = null
                    scope.launch {
                        runCatching { media?.save?.invoke(source.url) }.onFailure { error = it.message ?: "Couldn't save it." }
                        savingHere = false
                    }
                }) {
                    Icon(Icons.Rounded.Save, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text(if (error != null) "Try again" else "Save to chat", modifier = Modifier.padding(start = 8.dp))
                }
                OutlinedButton(onClick = { onOpen(source.url) }) {
                    Icon(Icons.AutoMirrored.Rounded.OpenInNew, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("Open", modifier = Modifier.padding(start = 8.dp))
                }
            }
        }
    }
}

@Composable
private fun MediaCard(content: @Composable () -> Unit) {
    Surface(Modifier.widthIn(max = 560.dp).fillMaxWidth(), shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
        Column(Modifier.padding(14.dp)) { content() }
    }
}

/** A 16:9 card that loads nothing until you tap play. */
@Composable
private fun TapToPlay(title: String, detail: String, thumbnail: String? = null, downloadUrl: String? = null, player: @Composable () -> Unit) {
    var playing by rememberSaveable { mutableStateOf(false) }
    val shape = RoundedCornerShape(16.dp)
    if (playing) {
        player()
        return
    }
    Box(Modifier.widthIn(max = 560.dp).fillMaxWidth().aspectRatio(16f / 9f).clip(shape).background(Color.Black)) {
        if (thumbnail != null) AsyncImage(thumbnail, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().alpha(0.8f))
        else Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(0xFF27272A), Color(0xFF0A0A0A)))), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Movie, contentDescription = null, tint = Color.White.copy(alpha = 0.4f), modifier = Modifier.size(40.dp))
        }
        Box(
            Modifier.fillMaxSize().clickable(onClickLabel = "Play $title") { playing = true },
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(64.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.PlayArrow, contentDescription = "Play $title", tint = Color.White, modifier = Modifier.size(36.dp))
            }
        }
        if (downloadUrl != null) {
            AssetDownloadButton(downloadUrl, title, overlay = true, modifier = Modifier.align(Alignment.TopEnd).padding(8.dp))
        }
        Column(
            Modifier.align(Alignment.BottomStart).fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.75f))))
                .padding(12.dp),
        ) {
            Text(title, color = Color.White, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(detail, color = Color.White.copy(alpha = 0.75f), style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** ExoPlayer, with the session cookie for Dex's own media, plus a one-tap Download action. */
@OptIn(UnstableApi::class)
@Composable
fun VideoPlayer(url: String, autoPlay: Boolean, audio: Boolean = false, title: String? = null, onOpen: (String) -> Unit = {}) {
    val context = LocalContext.current
    val graph = LocalApp.current.graph
    val displayName = title?.trim()?.ifEmpty { null } ?: Media.fileName(url)
    var failed by remember(url) { mutableStateOf(false) }
    val player = remember(url) {
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(OkHttpDataSource.Factory(graph.mediaHttp)))
            .build().apply {
                setMediaItem(MediaItem.fromUri(url))
                prepare()
                playWhenReady = autoPlay
            }
    }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                failed = true
            }
        }
        player.addListener(listener)
        onDispose {
            player.removeListener(listener)
            player.release()
        }
    }
    if (failed) {
        MediaCard {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                Column(Modifier.weight(1f)) {
                    Text("Couldn't play ${Media.fileName(url)}.", style = MaterialTheme.typography.titleSmall)
                    Text("The site may not allow streaming it here.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                AssetDownloadButton(url, displayName)
                OutlinedButton(onClick = { onOpen(url) }) { Text("Open") }
            }
        }
        return
    }
    Surface(
        modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
    ) {
        Column {
            if (audio) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Outlined.AudioFile, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                    Text(displayName, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    AssetDownloadButton(url, displayName)
                }
            }
            AndroidView(
                factory = { PlayerView(it).apply { this.player = player; useController = true; layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT) } },
                modifier = Modifier.fillMaxWidth().then(if (audio) Modifier.heightIn(min = 72.dp, max = 96.dp) else Modifier.aspectRatio(16f / 9f)),
            )
            if (!audio) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 2.dp, bottom = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Outlined.Movie, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
                    Text(displayName, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    AssetDownloadButton(url, displayName)
                }
            }
        }
    }
}

/** A YouTube or Vimeo player page, in a WebView that only plays (no Dex cookie reaches it: it's another site). */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun EmbedPlayer(url: String) {
    AndroidView(
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.mediaPlaybackRequiresUserGesture = false
                settings.domStorageEnabled = true
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
                webChromeClient = WebChromeClient()
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        val u = request.url
                        val host = u.host?.lowercase() ?: return true
                        val allowed = u.scheme == "https" && (
                            host == "www.youtube-nocookie.com" || host == "www.youtube.com" || host == "player.vimeo.com"
                        )
                        return !allowed
                    }
                }
                setBackgroundColor(android.graphics.Color.BLACK)
                tag = url
                loadUrl(url, mapOf("Referer" to "https://trydex.dev/"))
            }
        },
        update = { view ->
            if (view.tag != url) {
                view.tag = url
                view.loadUrl(url, mapOf("Referer" to "https://trydex.dev/"))
            }
        },
        onRelease = { it.destroy() },
        modifier = Modifier.fillMaxSize(),
    )
}
