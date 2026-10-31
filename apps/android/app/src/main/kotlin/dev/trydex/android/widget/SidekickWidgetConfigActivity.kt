package dev.trydex.android.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import dev.trydex.android.DexApplication
import dev.trydex.android.MainActivity
import dev.trydex.android.ui.chat.clickableRow
import dev.trydex.android.ui.components.CharacterAvatar
import dev.trydex.android.ui.theme.AppThemes
import dev.trydex.android.ui.theme.AppearanceMode
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.WidgetSnapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Picks the sidekick a "Sidekick" widget shows, when it's placed (and again from the widget's settings). */
class SidekickWidgetConfigActivity : ComponentActivity() {
    private val graph get() = (application as DexApplication).graph

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val appWidgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID) ?: AppWidgetManager.INVALID_APPWIDGET_ID
        // Backing out leaves no widget behind.
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }
        setContent {
            val prefs by graph.preferences.prefs.collectAsStateWithLifecycle()
            val session by graph.repository.session.collectAsStateWithLifecycle()
            val state by graph.repository.state.collectAsStateWithLifecycle()
            DexTheme(theme = AppThemes.byId(prefs.theme), appearance = AppearanceMode.byId(prefs.appearance), dynamicColor = prefs.dynamicColor) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
                    Column(Modifier.safeDrawingPadding().padding(vertical = 16.dp).testTag("widget-config")) {
                        Text("Pick a sidekick", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
                        val characters = state?.characters.orEmpty()
                        when {
                            session == null -> Message("Sign in to Dex first, then add the widget again.", "Open Dex")
                            characters.isEmpty() -> Message("You don't have any sidekicks yet. Make one in Dex.", "Open Dex")
                            else -> {
                                Text(
                                    "The widget shows their face, their latest words, and a dot when they've said something you haven't seen.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
                                )
                                LazyColumn(Modifier.padding(top = 8.dp)) {
                                    items(characters, key = { it.id }) { character -> Choice(character) { pick(appWidgetId, character) } }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun Choice(character: CharacterProfile, onPick: () -> Unit) {
        ListItem(
            headlineContent = { Text(character.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            supportingContent = character.tagline.takeIf { it.isNotBlank() }?.let { { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis) } },
            leadingContent = { CharacterAvatar(character, size = 48.dp) },
            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            modifier = Modifier.clickableRow(onPick).testTag("widget-pick-${character.id}"),
        )
    }

    @androidx.compose.runtime.Composable
    private fun Message(text: String, action: String) {
        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick = {
                startActivity(Intent(Intent.ACTION_VIEW, "dex://app".toUri(), this@SidekickWidgetConfigActivity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                finish()
            }) { Text(action) }
        }
    }

    private fun pick(appWidgetId: Int, character: CharacterProfile) {
        WidgetChoices(this).set(appWidgetId, character.id)
        val context = applicationContext
        lifecycleScope.launch {
            // Draw it at once from what the app has, then ask the server for the latest.
            graph.repository.state.value?.let { state -> withContext(Dispatchers.IO) { WidgetStore(context).save(WidgetSnapshot.from(state), imagesIncluded = true) } }
            WidgetSync.redraw(context)
            WidgetSync.schedule(context)
            WidgetSync.refreshSoon(context)
            setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
            finish()
        }
    }
}
