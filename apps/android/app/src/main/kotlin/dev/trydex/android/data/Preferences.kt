package dev.trydex.android.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Choices kept on this device (the web keeps them in localStorage). */
data class AppPrefs(
    val haptics: Boolean = true,
    /** stream, selkies, or vnc; null picks the best this device can play. */
    val desktopMode: String? = null,
    val lastServer: String? = null,
    val snoozedOpen: Boolean = false,
    val settledOpen: Boolean = false,
    val vmPreviewOpen: Boolean = false,
    /** The floating VM window's width, in dp. */
    val vmPreviewWidth: Float = 240f,
    val vmButtonX: Float? = null,
    val vmButtonY: Float? = null,
    val vmWindowX: Float? = null,
    val vmWindowY: Float? = null,
    /**
     * Notifications on this device: push from the agent where it can (Firebase), else local ones while Dex is open and
     * periodic checks while it isn't.
     */
    val notifications: Boolean = false,
    /** Whether the app has asked about notifications yet (the first time you open a sidekick, or turned them on/off). */
    val notifyAsked: Boolean = false,
    val notifyKinds: Set<String> = setOf("sidekick", "reply", "error", "scheduled", "machine", "mcp", "snooze"),
    /** Skip a chat's notification while it's on screen here. */
    val onlyWhenAway: Boolean = true,
    /** Material You colors from the wallpaper instead of [theme] (Android 12+). */
    val dynamicColor: Boolean = false,
    /** One of AppThemes' ids (ui/theme/Themes.kt). */
    val theme: String = "emerald",
    /** system, light, or dark. */
    val appearance: String = "system",
    /** False until read from disk (the defaults show until then). */
    val loaded: Boolean = false,
)

private val Context.dexPrefs: DataStore<androidx.datastore.preferences.core.Preferences> by preferencesDataStore("dex-prefs")

class Preferences(context: Context, private val scope: CoroutineScope) {
    private val store = context.applicationContext.dexPrefs

    private object Keys {
        val haptics = booleanPreferencesKey("haptics")
        val desktopMode = stringPreferencesKey("desktop_mode")
        val lastServer = stringPreferencesKey("last_server")
        val snoozedOpen = booleanPreferencesKey("sidebar_snoozed")
        val settledOpen = booleanPreferencesKey("sidebar_settled")
        val vmPreviewOpen = booleanPreferencesKey("vm_preview_open")
        val vmPreviewWidth = floatPreferencesKey("vm_preview_width")
        val vmButtonX = floatPreferencesKey("vm_button_x")
        val vmButtonY = floatPreferencesKey("vm_button_y")
        val vmWindowX = floatPreferencesKey("vm_window_x")
        val vmWindowY = floatPreferencesKey("vm_window_y")
        val notifications = booleanPreferencesKey("notifications")
        val notifyKinds = stringSetPreferencesKey("notify_kinds")
        val notifyAsked = booleanPreferencesKey("notify_asked")
        val onlyWhenAway = booleanPreferencesKey("only_when_away")
        val dynamicColor = booleanPreferencesKey("dynamic_color")
        val theme = stringPreferencesKey("theme")
        val appearance = stringPreferencesKey("appearance")
    }

    val prefs: StateFlow<AppPrefs> = store.data.map { p ->
        val defaults = AppPrefs()
        AppPrefs(
            haptics = p[Keys.haptics] ?: defaults.haptics,
            desktopMode = p[Keys.desktopMode],
            lastServer = p[Keys.lastServer],
            snoozedOpen = p[Keys.snoozedOpen] ?: false,
            settledOpen = p[Keys.settledOpen] ?: false,
            vmPreviewOpen = p[Keys.vmPreviewOpen] ?: false,
            vmPreviewWidth = p[Keys.vmPreviewWidth] ?: defaults.vmPreviewWidth,
            vmButtonX = p[Keys.vmButtonX],
            vmButtonY = p[Keys.vmButtonY],
            vmWindowX = p[Keys.vmWindowX],
            vmWindowY = p[Keys.vmWindowY],
            notifications = p[Keys.notifications] ?: false,
            notifyKinds = p[Keys.notifyKinds] ?: defaults.notifyKinds,
            notifyAsked = p[Keys.notifyAsked] ?: false,
            onlyWhenAway = p[Keys.onlyWhenAway] ?: true,
            // Wallpaper colors were the default before themes: keep them only for someone who chose them.
            dynamicColor = p[Keys.dynamicColor] ?: false,
            theme = p[Keys.theme] ?: defaults.theme,
            appearance = p[Keys.appearance] ?: defaults.appearance,
            loaded = true,
        )
    }.stateIn(scope, SharingStarted.Eagerly, AppPrefs())

    private fun edit(block: (MutablePreferences) -> Unit) {
        scope.launch { store.edit(block) }
    }

    fun setHaptics(on: Boolean) = edit { it[Keys.haptics] = on }
    fun setDesktopMode(mode: String) = edit { it[Keys.desktopMode] = mode }
    fun setLastServer(url: String) = edit { it[Keys.lastServer] = url }
    fun setSnoozedOpen(open: Boolean) = edit { it[Keys.snoozedOpen] = open }
    fun setSettledOpen(open: Boolean) = edit { it[Keys.settledOpen] = open }
    fun setVmPreviewOpen(open: Boolean) = edit { it[Keys.vmPreviewOpen] = open }
    fun setVmPreviewWidth(width: Float) = edit { it[Keys.vmPreviewWidth] = width }
    fun setVmButton(x: Float, y: Float) = edit {
        it[Keys.vmButtonX] = x
        it[Keys.vmButtonY] = y
    }
    fun setVmWindow(x: Float, y: Float) = edit {
        it[Keys.vmWindowX] = x
        it[Keys.vmWindowY] = y
    }
    fun setNotifications(on: Boolean) = edit {
        it[Keys.notifications] = on
        it[Keys.notifyAsked] = true
    }
    fun setNotifyAsked() = edit { it[Keys.notifyAsked] = true }
    fun setNotifyKinds(kinds: Set<String>) = edit { it[Keys.notifyKinds] = kinds }
    fun setOnlyWhenAway(on: Boolean) = edit { it[Keys.onlyWhenAway] = on }
    fun setDynamicColor(on: Boolean) = edit { it[Keys.dynamicColor] = on }
    /** Picking a theme turns wallpaper colors off. */
    fun setTheme(id: String) = edit {
        it[Keys.theme] = id
        it[Keys.dynamicColor] = false
    }
    fun setAppearance(mode: String) = edit { it[Keys.appearance] = mode }

    /** Signing out forgets what this device kept about the account (the server address stays). */
    suspend fun forgetAccount() {
        store.edit { p ->
            listOf(Keys.vmButtonX, Keys.vmButtonY, Keys.vmWindowX, Keys.vmWindowY).forEach { p.remove(it) }
            p.remove(Keys.notifications)
            p.remove(Keys.notifyAsked)
        }
    }
}
