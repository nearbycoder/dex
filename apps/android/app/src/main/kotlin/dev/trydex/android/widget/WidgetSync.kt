package dev.trydex.android.widget

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dev.trydex.android.DexApplication
import dev.trydex.core.client.DexSidekicks
import dev.trydex.core.client.DexSession
import dev.trydex.core.model.DexState
import dev.trydex.core.model.WidgetSnapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Keeps the home-screen widgets current: from the app's synced state while it's open (no request), from
 * `GET /api/sidekicks` every 15 minutes and whenever a push arrives, and blank ("Sign in to Dex") when signed out.
 */
object WidgetSync {
    private const val PERIODIC = "dex-widgets"
    private const val SOON = "dex-widgets-now"
    /** Pictures come with the snapshot this often (or when one is missing); otherwise `images=0`. */
    private const val PICTURES_EVERY_MS = 6 * 60 * 60_000L

    suspend fun hasWidgets(context: Context): Boolean = runCatching {
        val manager = GlanceAppWidgetManager(context)
        manager.getGlanceIds(SidekickWidget::class.java).isNotEmpty() || manager.getGlanceIds(SidekicksWidget::class.java).isNotEmpty()
    }.getOrDefault(false)

    /** Bumped on every redraw: a running widget session recomposes from its state, and reads the store again. */
    val VERSION = longPreferencesKey("version")

    suspend fun redraw(context: Context) {
        val manager = GlanceAppWidgetManager(context)
        for (widget in listOf(SidekickWidget(), SidekicksWidget())) {
            runCatching {
                for (id in manager.getGlanceIds(widget::class.java)) {
                    updateAppWidgetState(context, PreferencesGlanceStateDefinition, id) { prefs ->
                        prefs.toMutablePreferences().apply { this[VERSION] = System.nanoTime() }
                    }
                    widget.update(context, id)
                }
            }
        }
    }

    /** The app's state changed: the widgets show it (pictures included), without asking the server. */
    suspend fun fromState(context: Context, state: DexState) {
        if (!hasWidgets(context)) return
        val changed = withContext(Dispatchers.IO) { WidgetStore(context).save(WidgetSnapshot.from(state), imagesIncluded = true) }
        if (changed) redraw(context)
    }

    /** Asks the server for the latest (the app may be closed). */
    suspend fun fetch(context: Context, http: OkHttpClient, session: DexSession) {
        val store = WidgetStore(context)
        val known = store.load()
        val pictures = known == null || System.currentTimeMillis() - store.fullAt > PICTURES_EVERY_MS
        var snapshot = DexSidekicks.fetch(http, session, images = pictures)
        // Someone new (or a picture missing): ask again with pictures.
        if (!pictures && snapshot.sidekicks.any { sidekick -> known?.sidekick(sidekick.id) == null && !store.hasPicture(sidekick.id) }) {
            snapshot = DexSidekicks.fetch(http, session, images = true)
            if (store.save(snapshot, imagesIncluded = true)) redraw(context)
            return
        }
        if (store.save(snapshot, imagesIncluded = pictures)) redraw(context)
    }

    /** Signed out: forget what they showed. */
    suspend fun signedOut(context: Context) {
        withContext(Dispatchers.IO) { WidgetStore(context).clear() }
        redraw(context)
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
    }

    /** Every 15 minutes while there are widgets (WorkManager's shortest period). */
    fun schedule(context: Context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<WidgetRefreshWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build(),
        )
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
    }

    /** As soon as there's a network (a push arrived, or a widget was just placed). */
    fun refreshSoon(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            SOON,
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build(),
        )
    }
}

class WidgetRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val graph = (applicationContext as DexApplication).graph
        if (!WidgetSync.hasWidgets(applicationContext)) return Result.success()
        val session = graph.repository.session.value ?: run {
            WidgetSync.signedOut(applicationContext)
            return Result.success()
        }
        return runCatching { WidgetSync.fetch(applicationContext, graph.http, session) }.fold(
            onSuccess = { Result.success() },
            onFailure = { error ->
                // Signed out elsewhere: the app finds out when it next opens; the widgets keep what they had.
                if ((error as? dev.trydex.core.client.SidekicksException)?.status == 401) Result.success() else Result.retry()
            },
        )
    }
}
