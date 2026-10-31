package dev.trydex.android.ui.settings

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import dev.trydex.android.notifications.Notifier
import dev.trydex.android.ui.LocalApp
import kotlinx.coroutines.flow.first

/**
 * Asks once whether this device may notify you, at a moment it makes sense (the first time you open a sidekick), not
 * on launch. Allowed (or Android before 13, which doesn't ask): notifications go on, and push registers.
 */
@Composable
fun AskForNotificationsOnce(key: Any?) {
    val app = LocalApp.current
    val context = LocalContext.current
    val preferences = app.graph.preferences
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) preferences.setNotifications(true) else preferences.setNotifyAsked()
    }
    LaunchedEffect(key) {
        if (key == null) return@LaunchedEffect
        val prefs = preferences.prefs.first { it.loaded }
        if (prefs.notifyAsked || prefs.notifications) return@LaunchedEffect
        if (Notifier.canPost(context)) preferences.setNotifications(true)
        else if (Build.VERSION.SDK_INT >= 33) runCatching { permission.launch(Manifest.permission.POST_NOTIFICATIONS) }.onFailure { preferences.setNotifyAsked() }
    }
}
