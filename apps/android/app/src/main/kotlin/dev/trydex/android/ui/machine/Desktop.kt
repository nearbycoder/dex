package dev.trydex.android.ui.machine

import android.annotation.SuppressLint
import android.graphics.Color as AndroidColor
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.viewinterop.AndroidView
import dev.trydex.android.AppGraph
import dev.trydex.android.ui.LocalGraph
import dev.trydex.core.client.DexSession
import kotlinx.coroutines.delay

/** How the desktop streams: boat's WebCodecs player, Dex's Selkies relay, or noVNC. */
enum class DesktopMode(val id: String, val label: String) {
    Stream("stream", "Stream"),
    Selkies("selkies", "Selkies"),
    Vnc("vnc", "noVNC");

    companion object {
        /** The saved mode, else Stream (Android's WebView is Chromium, which plays it). */
        fun saved(id: String?): DesktopMode = entries.firstOrNull { it.id == id } ?: Stream
    }
}

/** A desktop URL being fetched for a VM (useDesktopUrl): loads while it runs, cleared when it stops. */
@Stable
class DesktopUrl {
    var url by mutableStateOf<String?>(null)
    var loading by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    /** Bumps on Reconnect, so the same URL reloads too. */
    var generation by mutableIntStateOf(0)
    internal var reloads by mutableIntStateOf(0)

    fun reload() {
        reloads++
    }
}

@Composable
fun rememberDesktopUrl(key: String, mode: DesktopMode, running: Boolean): DesktopUrl {
    val graph = LocalGraph.current
    val desktop = remember(key) { DesktopUrl() }
    LaunchedEffect(key, mode, running, desktop.reloads) {
        if (!running) {
            desktop.url = null
            desktop.error = null
            return@LaunchedEffect
        }
        desktop.loading = true
        desktop.error = null
        runCatching { graph.repository.api.vmDesktopUrl(key, mode.id) }
            .onSuccess { next ->
                desktop.url = next
                desktop.generation++
                if (next == null) desktop.error = "The desktop is still starting. Try again in a few seconds."
            }
            .onFailure { desktop.error = it.message ?: "Couldn't reach the desktop." }
        desktop.loading = false
    }
    return desktop
}

/** A desktop URL as the WebView loads it: Dex's own paths resolve against the server; the watch view hides controls. */
fun desktopAddress(url: String, session: DexSession?, watch: Boolean): String {
    val absolute = if (url.startsWith("/")) session?.serverUrl?.resolve(url)?.toString() ?: url else url
    return if (watch && url.startsWith("/vm-desktop/")) "$absolute?view=watch" else absolute
}

/**
 * Lets the WebView's requests to Dex carry the session (the `dex_session` cookie the web app uses). Only Dex's own
 * origin gets it; boat's stream and noVNC URLs authenticate themselves.
 */
fun installSessionCookie(graph: AppGraph) {
    val session = graph.repository.session.value ?: return
    val url = session.serverUrl
    val secure = if (url.isHttps) "; Secure" else ""
    val cookies = CookieManager.getInstance()
    cookies.setAcceptCookie(true)
    cookies.setCookie("${url.scheme}://${url.host}${if (url.port != okhttp3.HttpUrl.defaultPort(url.scheme)) ":${url.port}" else ""}", "dex_session=${session.token}; Path=/$secure; HttpOnly; SameSite=Lax")
    cookies.flush()
}

/**
 * A VM's desktop in a WebView. Watching, an overlay takes every touch (so you can't disturb the agent, and drags
 * scroll the page or move the window around it); in control, touches and keys go to the VM.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun DesktopWebView(url: String, generation: Int, control: Boolean, modifier: Modifier = Modifier, watch: Boolean = !control, onWatchTap: (() -> Unit)? = null) {
    val graph = LocalGraph.current
    val session = graph.repository.session.value
    val address = remember(url, watch, session?.server) { desktopAddress(url, session, watch) }
    var view by remember { mutableStateOf<WebView?>(null) }
    LaunchedEffect(view, address, generation) {
        val web = view ?: return@LaunchedEffect
        installSessionCookie(graph)
        web.loadUrl(address)
    }
    DisposableEffect(Unit) {
        onDispose {
            view?.apply {
                stopLoading()
                loadUrl("about:blank")
                destroy()
            }
        }
    }
    Box(modifier.background(Color.Black).testTag("desktop")) {
        AndroidView(
            factory = { context ->
                WebView(context).apply {
                    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                    setBackgroundColor(AndroidColor.BLACK)
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.mediaPlaybackRequiresUserGesture = false
                    settings.loadWithOverviewMode = true
                    settings.useWideViewPort = true
                    CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                    webChromeClient = WebChromeClient()
                    webViewClient = object : WebViewClient() {
                        // Links inside the desktop page stay in it; nothing navigates the app.
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = false
                    }
                    view = this
                }
            },
            modifier = Modifier.fillMaxSize(),
        )
        if (!control) {
            Box(
                Modifier.fillMaxSize().testTag("desktop-watch").pointerInput(onWatchTap) {
                    awaitEachGesture {
                        val down = awaitFirstDown(pass = PointerEventPass.Initial)
                        val up = waitForUpOrCancellation(down.id)
                        if (up && onWatchTap != null) onWatchTap()
                    }
                },
            )
        }
    }
}

/** Waits for the finger to lift; true when it lifted without moving far (a tap). */
private suspend fun androidx.compose.ui.input.pointer.AwaitPointerEventScope.waitForUpOrCancellation(id: androidx.compose.ui.input.pointer.PointerId): Boolean {
    val start = currentEvent.changes.firstOrNull { it.id == id }?.position
    while (true) {
        val event = awaitPointerEvent(PointerEventPass.Initial)
        val change = event.changes.firstOrNull { it.id == id } ?: return false
        if (start != null && (change.position - start).getDistance() > viewConfiguration.touchSlop) return false
        if (!change.pressed) return true
    }
}

/** Keeps a VM awake while you control it (vmTouch every 30 seconds). */
@Composable
fun KeepAwake(key: String, active: Boolean) {
    val graph = LocalGraph.current
    LaunchedEffect(key, active) {
        while (active) {
            runCatching { graph.repository.api.vmTouch(key) }
            delay(30_000)
        }
    }
}
