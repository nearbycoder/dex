package dev.trydex.android.ui.signin

import android.content.Context
import androidx.core.content.edit
import dev.trydex.android.data.DexRepository
import dev.trydex.android.data.Preferences
import dev.trydex.core.client.AuthException
import dev.trydex.core.client.DexAuth
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient

/**
 * Native sign-in: opens the server's sign-in page in the browser with a PKCE challenge, and trades the code it sends
 * back (dex://auth/callback) for a session. The pending verifier is kept on disk, so a sign-in survives the app being
 * killed while the browser is open.
 */
class SignInController(
    context: Context,
    private val scope: CoroutineScope,
    private val http: OkHttpClient,
    private val repository: DexRepository,
    private val preferences: Preferences,
    private val openBrowser: (String) -> Unit,
) {
    private val pending = context.getSharedPreferences("dex-signin", Context.MODE_PRIVATE)

    data class Ui(val busy: Boolean = false, val error: String? = null, val waitingForBrowser: Boolean = false)

    private val _ui = MutableStateFlow(Ui())
    val ui: StateFlow<Ui> = _ui.asStateFlow()

    /** Opens the browser to sign in to the Dex at `server` (what the user typed). */
    fun start(server: String) {
        val url = DexAuth.parseServer(server)
        if (url == null) {
            _ui.value = Ui(error = "Enter your Dex's address, like trydex.dev. Plain http only works for local addresses.")
            return
        }
        val verifier = DexAuth.newVerifier()
        pending.edit {
            putString(SERVER, url.toString())
            putString(VERIFIER, verifier)
        }
        _ui.value = Ui(waitingForBrowser = true)
        openBrowser(DexAuth.startUrl(url, DexAuth.challenge(verifier)).toString())
    }

    /** The browser came back with a sign-in code. */
    fun complete(callback: String) {
        val code = DexAuth.callbackCode(callback)
        val server = pending.getString(SERVER, null)?.toHttpUrlOrNull()
        val verifier = pending.getString(VERIFIER, null)
        if (code == null || server == null || verifier == null) {
            _ui.value = Ui(error = "That sign-in link didn't come from this app. Start again here.")
            return
        }
        _ui.value = Ui(busy = true)
        scope.launch {
            try {
                val session = DexAuth.exchange(http, server, code, verifier)
                pending.edit { clear() }
                preferences.setLastServer(server.toString())
                repository.signIn(session)
                _ui.value = Ui()
            } catch (error: AuthException) {
                _ui.value = Ui(error = error.message)
            }
        }
    }

    /** Back from the browser without a code (the user closed it). */
    fun browserClosed() {
        if (_ui.value.waitingForBrowser) _ui.value = Ui()
    }

    fun dismissError() {
        _ui.value = _ui.value.copy(error = null)
    }

    private companion object {
        const val SERVER = "server"
        const val VERIFIER = "verifier"
    }
}
