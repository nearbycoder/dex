package dev.trydex.android

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import coil3.SingletonImageLoader
import dev.trydex.android.notifications.Notifier
import dev.trydex.android.widget.WidgetSync
import dev.trydex.core.model.WidgetSnapshot
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class DexApplication : Application(), SingletonImageLoader.Factory {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
        Demo.resume(graph)
        Notifier.createChannels(this)
        val notifier = Notifier(this, graph) { graph.push }
        notifier.start()
        graph.push.start()
        followAccount()
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            private var pause: Job? = null

            override fun onStart(owner: LifecycleOwner) {
                pause?.cancel()
                graph.repository.setVisible(true)
            }

            override fun onStop(owner: LifecycleOwner) {
                graph.repository.setVisible(false)
                // Kept a while in the background, so a reply that's almost done still arrives (and notifies).
                pause = graph.scope.launch {
                    delay(BACKGROUND_GRACE_MS)
                    graph.repository.pause()
                }
                notifier.scheduleChecks()
            }
        })
    }

    override fun newImageLoader(context: android.content.Context) = graph.imageLoader

    /**
     * What follows the account outside the app: push registration when notifications are turned on or off here, the
     * home-screen widgets from the synced state, and on sign-out, no notifications or widget contents left behind.
     */
    @OptIn(FlowPreview::class)
    private fun followAccount() {
        val context = this
        graph.scope.launch {
            graph.repository.state.filterNotNull().map(WidgetSnapshot::from).distinctUntilChanged().debounce(1_000).collect { _ ->
                graph.repository.state.value?.let { WidgetSync.fromState(context, it) }
            }
        }
        graph.scope.launch {
            var was = graph.repository.session.value != null
            if (was && WidgetSync.hasWidgets(context)) WidgetSync.schedule(context)
            graph.repository.session.collect { session ->
                val now = session != null
                if (was && !now) {
                    Notifier.clearAll(context)
                    WidgetSync.signedOut(context)
                }
                if (!was && now && WidgetSync.hasWidgets(context)) {
                    WidgetSync.schedule(context)
                    WidgetSync.refreshSoon(context)
                }
                was = now
            }
        }
    }

    companion object {
        const val BACKGROUND_GRACE_MS = 3 * 60_000L
    }
}
