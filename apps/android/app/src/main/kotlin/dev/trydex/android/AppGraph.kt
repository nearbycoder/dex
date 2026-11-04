package dev.trydex.android

import android.content.Context
import coil3.ImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.svg.SvgDecoder
import dev.trydex.android.data.ChatDrafts
import dev.trydex.android.data.DexRepository
import dev.trydex.android.data.SignedOutReason
import dev.trydex.android.data.KeystoreSessionStore
import dev.trydex.android.data.LocalCache
import dev.trydex.android.data.Preferences
import dev.trydex.android.data.SessionStore
import dev.trydex.android.data.UsageGlances
import dev.trydex.android.notifications.FirebaseTokens
import dev.trydex.android.notifications.Notifier
import dev.trydex.android.notifications.PushRegistrar
import dev.trydex.android.notifications.PushStore
import dev.trydex.android.notifications.PushTokens
import dev.trydex.core.client.DexCookieInterceptor
import dev.trydex.core.model.ModelRegistry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit

/** The app's singletons, made once in [DexApplication] (and swapped for fakes in tests). */
class AppGraph(
    context: Context,
    val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
    sessionStore: SessionStore = KeystoreSessionStore(context),
    cacheDir: File = File(context.filesDir, "dex-cache"),
    pushTokens: PushTokens = FirebaseTokens(context.applicationContext),
) {
    val preferences = Preferences(context, scope)
    val models = ModelRegistry()

    /** For the socket and the API: no session cookie except what the client adds itself. */
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()

    val repository = DexRepository(scope, http, sessionStore, LocalCache(cacheDir), models)

    /** The usage meter in the Chats bar and on Settings, fetched once for both. */
    val usage = UsageGlances(scope, repository)

    /** Unsent text in each chat, kept per chat; forgotten on sign-out and when its chat is deleted. */
    val drafts = ChatDrafts(context, scope).also { drafts ->
        scope.launch { repository.signedOutReason.collect { if (it != SignedOutReason.None) drafts.clear() } }
        scope.launch {
            repository.state.filterNotNull().map { state -> state.sessions.mapTo(HashSet()) { it.id } }.distinctUntilChanged().collect(drafts::retain)
        }
    }

    /** Push to this device (Firebase), registered with the agent while notifications are on here. */
    val push = context.applicationContext.let { app ->
        PushRegistrar(
            scope, repository, pushTokens, PushStore(app),
            wanted = { preferences.prefs.value.notifications && Notifier.canPost(app) },
            wantedChanges = preferences.prefs.map { it.notifications },
        )
    }

    /** For media and images: adds the session cookie to Dex's own host only. */
    val mediaHttp: OkHttpClient = http.newBuilder()
        .readTimeout(60, TimeUnit.SECONDS)
        .addInterceptor(DexCookieInterceptor { repository.session.value })
        .build()

    val imageLoader: ImageLoader = ImageLoader.Builder(context)
        .components {
            add(OkHttpNetworkFetcherFactory(callFactory = { mediaHttp }))
            add(SvgDecoder.Factory())
        }
        .build()
}
