package dev.trydex.android

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import coil3.SingletonImageLoader
import dev.trydex.android.notifications.Notifier
import kotlinx.coroutines.Job
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
        val notifier = Notifier(this, graph)
        notifier.start()
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

    companion object {
        const val BACKGROUND_GRACE_MS = 3 * 60_000L
    }
}
