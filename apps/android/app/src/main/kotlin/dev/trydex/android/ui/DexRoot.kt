package dev.trydex.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.AppGraph
import dev.trydex.android.ui.components.Haptics
import dev.trydex.android.ui.components.LocalHaptics
import dev.trydex.android.ui.machine.PipDesktop
import dev.trydex.android.ui.nav.Route
import dev.trydex.android.ui.signin.SignInController
import dev.trydex.android.ui.signin.SignInScreen
import dev.trydex.android.ui.theme.AppThemes
import dev.trydex.android.ui.theme.AppearanceMode
import dev.trydex.android.ui.theme.DexTheme
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow

/** Links (notifications, shortcuts) waiting for the app shell to open them. */
class LinkInbox {
    private val channel = Channel<List<Route>>(Channel.CONFLATED)
    val links = channel.receiveAsFlow()
    fun send(routes: List<Route>) {
        channel.trySend(routes)
    }
}

/** A chat to open with the keyboard up (a widget's Message, a notification's Reply), until that chat takes it. */
object ComposeRequests {
    private val pending = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
    val requests: kotlinx.coroutines.flow.StateFlow<String?> = pending

    fun request(sessionId: String) {
        pending.value = sessionId
    }

    /** The chat on screen takes its request (true once). */
    fun take(sessionId: String): Boolean = pending.compareAndSet(sessionId, null)
}

/** A VM desktop that may play in Android's picture-in-picture window when you leave the app. */
data class PipSource(val vmKey: String, val title: String)

class PipController {
    var source by mutableStateOf<PipSource?>(null)
        private set
    var onChange: () -> Unit = {}
    val available: Boolean get() = source != null

    fun offer(source: PipSource) {
        if (this.source == source) return
        this.source = source
        onChange()
    }

    fun withdraw(source: PipSource) {
        if (this.source != source) return
        this.source = null
        onChange()
    }
}

/** Opens a URL in a Custom Tab (sign-ins that need the browser's Dex session) or the browser. */
/** The app's singletons, for views outside the shell too (the picture-in-picture desktop). */
val LocalGraph = staticCompositionLocalOf<AppGraph> { error("No AppGraph") }

val LocalOpenInBrowser = staticCompositionLocalOf<(String) -> Unit> { {} }
val LocalPip = staticCompositionLocalOf { PipController() }

/** In Android's picture-in-picture window: in-app streams pause, the PiP view plays instead. */
val LocalInPip = androidx.compose.runtime.compositionLocalOf { false }

@Composable
fun DexRoot(
    graph: AppGraph,
    links: LinkInbox,
    signIn: SignInController,
    pip: PipController,
    inPip: Boolean,
    openInBrowser: (String) -> Unit,
) {
    val session by graph.repository.session.collectAsStateWithLifecycle()
    val prefs by graph.preferences.prefs.collectAsStateWithLifecycle()
    val view = LocalView.current
    val haptics = remember(view) { Haptics(view) { graph.preferences.prefs.value.haptics } }
    val appearance = AppearanceMode.byId(prefs.appearance)
    val dark = when (appearance) {
        AppearanceMode.System -> isSystemInDarkTheme()
        AppearanceMode.Light -> false
        AppearanceMode.Dark -> true
    }
    // The status and navigation bars' icons follow the app's mode, which can differ from the system's.
    val activity = LocalContext.current as? ComponentActivity
    LaunchedEffect(activity, dark) {
        val transparent = androidx.compose.ui.graphics.Color.Transparent.toArgb()
        val style = if (dark) SystemBarStyle.dark(transparent) else SystemBarStyle.light(transparent, transparent)
        activity?.enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
    }
    LaunchedEffect(prefs.theme) { dev.trydex.android.notifications.Notifier.accent = AppThemes.byId(prefs.theme).accentLight.toArgb() }
    DexTheme(theme = AppThemes.byId(prefs.theme), appearance = appearance, dynamicColor = prefs.dynamicColor) {
        CompositionLocalProvider(
            LocalGraph provides graph,
            LocalHaptics provides haptics,
            LocalOpenInBrowser provides openInBrowser,
            LocalPip provides pip,
        ) {
            val source = pip.source
            if (session == null) {
                SignInScreen(signIn, graph)
            } else {
                // The shell stays composed under the picture-in-picture view, so nothing is lost on the way back.
                CompositionLocalProvider(LocalInPip provides inPip) {
                    androidx.compose.foundation.layout.Box {
                        AppShell(graph, links)
                        if (inPip && source != null) PipDesktop(graph, source)
                    }
                }
            }
        }
    }
}
