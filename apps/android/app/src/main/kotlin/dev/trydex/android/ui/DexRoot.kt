package dev.trydex.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.AppGraph
import dev.trydex.android.ui.components.Haptics
import dev.trydex.android.ui.components.LocalHaptics
import dev.trydex.android.ui.machine.PipDesktop
import dev.trydex.android.ui.nav.Route
import dev.trydex.android.ui.signin.SignInController
import dev.trydex.android.ui.signin.SignInScreen
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
    DexTheme(dynamicColor = prefs.dynamicColor) {
        CompositionLocalProvider(
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
