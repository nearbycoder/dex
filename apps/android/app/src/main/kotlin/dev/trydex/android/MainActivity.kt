package dev.trydex.android

import android.app.PictureInPictureParams
import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.net.toUri
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import dev.trydex.android.ui.DexRoot
import dev.trydex.android.ui.LinkInbox
import dev.trydex.android.ui.PipController
import dev.trydex.android.ui.nav.routesFor
import dev.trydex.android.ui.signin.SignInController

class MainActivity : ComponentActivity() {
    private val graph get() = (application as DexApplication).graph
    private val links = LinkInbox()
    private lateinit var signIn: SignInController

    /** Android's picture-in-picture: the VM desktop keeps playing in a small window when you leave the app. */
    val pip = PipController()
    private var inPip by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        signIn = SignInController(this, graph.scope, graph.http, graph.repository, graph.preferences, ::openInBrowser)
        setContent {
            DexRoot(graph = graph, links = links, signIn = signIn, pip = pip, inPip = inPip, openInBrowser = ::openInBrowser)
        }
        handle(intent)
        pip.onChange = ::updatePipParams
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    override fun onResume() {
        super.onResume()
        signIn.browserClosed()
    }

    private fun handle(intent: Intent?) {
        val data = intent?.data?.toString() ?: return
        when {
            data.startsWith("dex://auth/callback") -> signIn.complete(data)
            data.startsWith("dex://app") -> routesFor(data)?.let(links::send)
            // dex://chatgpt/signed-in only brings Dex back over the browser; Settings already has the address.
        }
    }

    /** Opens a page in a Custom Tab: the same browser that holds Dex's sign-in, for GitHub and MCP sign-ins. */
    fun openInBrowser(url: String) {
        runCatching {
            CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, url.toUri())
        }.onFailure {
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) }
        }
    }

    private fun pipParams(): PictureInPictureParams? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
        val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(pip.available)
            builder.setSeamlessResizeEnabled(true)
        }
        return builder.build()
    }

    private fun updatePipParams() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) pipParams()?.let(::setPictureInPictureParams)
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // Android 12+ enters on its own (auto-enter); before that, ask when the user leaves with a desktop on screen.
        if (pip.available && Build.VERSION.SDK_INT in Build.VERSION_CODES.O until Build.VERSION_CODES.S) {
            pipParams()?.let { runCatching { enterPictureInPictureMode(it) } }
        }
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        inPip = isInPictureInPictureMode
    }
}
