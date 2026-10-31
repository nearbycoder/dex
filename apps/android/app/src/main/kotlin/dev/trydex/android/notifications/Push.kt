package dev.trydex.android.notifications

import android.content.Context
import android.os.Build
import androidx.core.content.edit
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import dev.trydex.android.Demo
import dev.trydex.android.data.DexRepository
import dev.trydex.core.client.DexApi
import dev.trydex.core.client.DexSession
import dev.trydex.core.model.DexState
import dev.trydex.core.model.PushDevice
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.resume

/** Where this device's push token comes from: Firebase Cloud Messaging, or a stand-in in tests. */
interface PushTokens {
    /** Whether this build can receive pushes at all (it was built with a google-services.json). */
    val available: Boolean
    suspend fun token(): String?
    /** Forgets the token, so pushes still aimed at it fail and the agent drops the device. */
    suspend fun delete()
}

/** Firebase, when the build has its config (the google-services plugin ran); otherwise unavailable and silent. */
class FirebaseTokens(private val context: Context) : PushTokens {
    override val available: Boolean
        get() = runCatching { FirebaseApp.getApps(context).isNotEmpty() || FirebaseApp.initializeApp(context) != null }.getOrDefault(false)

    override suspend fun token(): String? {
        if (!available) return null
        return suspendCancellableCoroutine { continuation ->
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                continuation.resume(if (task.isSuccessful) task.result else null)
            }
        }
    }

    override suspend fun delete() {
        if (!available) return
        suspendCancellableCoroutine { continuation ->
            FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener { continuation.resume(Unit) }
        }
    }
}

/** What this device registered with its agent: the token and the device id the agent gave it. */
class PushStore(context: Context) {
    private val prefs = context.getSharedPreferences("dex-push", Context.MODE_PRIVATE)

    var deviceId: String?
        get() = prefs.getString("device", null)
        set(value) = prefs.edit { if (value == null) remove("device") else putString("device", value) }

    var token: String?
        get() = prefs.getString("token", null)
        set(value) = prefs.edit { if (value == null) remove("token") else putString("token", value) }

    /** Who it was registered for (server and user), so another account registers afresh. */
    var account: String?
        get() = prefs.getString("account", null)
        set(value) = prefs.edit { if (value == null) remove("account") else putString("account", value) }

    fun clear() = prefs.edit { clear() }
}

/** How this device stands for push, for the Notifications screen. */
sealed interface PushState {
    /** Built without Firebase, in the demo, or the agent can't push to Android: local notifications instead. */
    data object Unavailable : PushState
    /** Notifications are off on this device (not allowed yet, or turned off here). */
    data object Off : PushState
    data object Registering : PushState
    data class Registered(val deviceId: String) : PushState
    data class Failed(val message: String) : PushState
}

/**
 * Registers this device's Firebase token with the agent (`registerNativePush`, which upserts) on every app start, when
 * the token changes, and when notifications are turned on; unregisters (`pushUnsubscribe`) and deletes the token on
 * sign-out or when they're turned off here. The demo makes no Firebase calls.
 */
class PushRegistrar(
    private val scope: CoroutineScope,
    private val repository: DexRepository,
    private val tokens: PushTokens,
    private val store: PushStore,
    /** Whether notifications are on here: allowed by Android and not turned off in Settings. */
    private val wanted: () -> Boolean,
    /** Changes to whether notifications are on here (the setting), to register or unregister at once. */
    private val wantedChanges: Flow<Boolean> = flowOf(true),
    /** "Pixel 9 · Android app". */
    private val label: String = defaultLabel(),
) {
    private val _state = MutableStateFlow<PushState>(PushState.Off)
    val state: StateFlow<PushState> = _state.asStateFlow()
    private val lock = Mutex()
    /** The account this process registered for already (re-registering once per start is enough). */
    private var registeredFor: String? = null

    val deviceId: String? get() = store.deviceId

    /** The agent pushes to this device: the app's own notifications stand down. */
    val registered: Boolean get() = store.deviceId != null

    fun start() {
        // Each connection (a start, a reconnect after a deploy) checks the registration once.
        scope.launch {
            combine(repository.connected, repository.session, wantedChanges.distinctUntilChanged()) { up, session, wanted ->
                Triple(up, session?.let { "${it.server}|${it.user.id}" }, wanted)
            }
                .distinctUntilChanged()
                .collect { (up, account) -> if (up && account != null) sync() }
        }
        repository.beforeSignOut { api, session -> unregister(api, session) }
    }

    /** Whether the agent this app is signed in to can push here at all. */
    fun supported(state: DexState? = repository.state.value): Boolean {
        val session = repository.session.value ?: return false
        if (Demo.isDemo(session.server) || !tokens.available) return false
        return state?.push?.native?.android == true
    }

    /** The agent's record of this device, once registered. */
    fun device(state: DexState?): PushDevice? = store.deviceId?.let { id -> state?.push?.devices?.firstOrNull { it.id == id } }

    /** Registers (or refreshes) when notifications are on here; otherwise makes sure the agent forgets this device. */
    suspend fun sync(force: Boolean = false) = lock.withLock {
        val session = repository.session.value ?: return@withLock
        if (!repository.connected.value) return@withLock
        if (!supported()) {
            // The agent lost its Firebase key (or this is the demo): local notifications again.
            store.deviceId = null
            _state.value = PushState.Unavailable
            return@withLock
        }
        val account = "${session.server}|${session.user.id}"
        if (!wanted()) {
            store.deviceId?.let { id -> runCatching { repository.api.pushUnsubscribe(id) } }
            store.deviceId = null
            _state.value = PushState.Off
            return@withLock
        }
        val token = tokens.token()
        if (token == null) {
            _state.value = PushState.Failed("Couldn't get a push token from Google Play services.")
            return@withLock
        }
        if (!force && registeredFor == account && store.token == token && store.deviceId != null) {
            _state.value = PushState.Registered(store.deviceId!!)
            return@withLock
        }
        _state.value = PushState.Registering
        runCatching { repository.api.registerNativePush("android", token, null, label) }
            .onSuccess { id ->
                // Signed out (or into another account) while it registered: that's for the sign-out to undo.
                if (repository.session.value?.let { "${it.server}|${it.user.id}" } != account) return@withLock
                store.deviceId = id
                store.token = token
                store.account = account
                registeredFor = account
                _state.value = PushState.Registered(id)
            }
            .onFailure { _state.value = PushState.Failed(it.message ?: "Couldn't turn on push.") }
    }

    /** Firebase gave this device a new token: tell the agent. */
    fun onNewToken(token: String) {
        if (token == store.token) return
        store.token = null
        scope.launch { sync(force = true) }
    }

    private suspend fun unregister(api: DexApi, session: DexSession) {
        val id = store.deviceId
        store.clear()
        registeredFor = null
        _state.value = PushState.Off
        if (Demo.isDemo(session.server)) return
        if (id != null) runCatching { api.pushUnsubscribe(id) }
        runCatching { tokens.delete() }
    }

    companion object {
        fun defaultLabel(): String {
            val model = Build.MODEL.orEmpty().ifBlank { "Android" }
            return "$model · Android app".take(60)
        }
    }
}
