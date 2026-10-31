package dev.trydex.android.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.color.ColorProviders
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import dev.trydex.android.DexApplication
import dev.trydex.android.MainActivity
import dev.trydex.android.R
import dev.trydex.android.ui.theme.AppThemes
import dev.trydex.android.ui.theme.colorSchemeFor
import dev.trydex.core.model.WidgetSidekick
import androidx.compose.runtime.remember
import androidx.glance.currentState
import androidx.glance.state.PreferencesGlanceStateDefinition

/** Faces are drawn at this many pixels across (sharp at the sizes widgets use, small enough for RemoteViews). */
private const val FACE_PX = 168

/** The app's theme colors (its accent on neutral surfaces), light and dark. */
private fun widgetColors(context: Context): ColorProviders {
    val theme = runCatching { AppThemes.byId((context.applicationContext as DexApplication).graph.preferences.prefs.value.theme) }.getOrDefault(AppThemes.default)
    return androidx.glance.material3.ColorProviders(light = colorSchemeFor(theme, false), dark = colorSchemeFor(theme, true))
}

private fun signedIn(context: Context) = runCatching { (context.applicationContext as DexApplication).graph.repository.session.value != null }.getOrDefault(false)

private fun open(context: Context, link: String): Action =
    actionStartActivity(Intent(Intent.ACTION_VIEW, link.toUri(), context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

/** "Sidekick": one sidekick, set when it's placed: their face, name, an unread dot, their latest words, and Message. */
class SidekickWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact
    override val stateDefinition = PreferencesGlanceStateDefinition

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val appWidgetId = runCatching { GlanceAppWidgetManager(context).getAppWidgetId(id) }.getOrDefault(AppWidgetManager.INVALID_APPWIDGET_ID)
        val store = WidgetStore(context)
        provideContent {
            // A running session only recomposes: what it shows is read again whenever WidgetSync bumps the version.
            val version = currentState(WidgetSync.VERSION) ?: 0L
            val (content, face) = remember(version) {
                val content = WidgetContent.single(signedIn(context), store.load(), WidgetChoices(context).get(appWidgetId))
                content to (content as? WidgetContent.One)?.let { store.face(it.sidekick, FACE_PX) }
            }
            val colors = remember(version) { widgetColors(context) }
            GlanceTheme(colors = colors) {
                Frame(context) {
                    when (content) {
                        is WidgetContent.One -> OneSidekick(context, content.sidekick, face!!)
                        else -> Placeholder(context, content)
                    }
                }
            }
        }
    }
}

/** "Sidekicks": up to four, in a row (or a 2×2 grid when the widget is tall and narrow), each opening their chat. */
class SidekicksWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact
    override val stateDefinition = PreferencesGlanceStateDefinition

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val store = WidgetStore(context)
        provideContent {
            val version = currentState(WidgetSync.VERSION) ?: 0L
            val (content, faces) = remember(version) {
                val content = WidgetContent.several(signedIn(context), store.load())
                content to (content as? WidgetContent.Several)?.sidekicks?.associate { it.id to store.face(it, FACE_PX) }.orEmpty()
            }
            val colors = remember(version) { widgetColors(context) }
            GlanceTheme(colors = colors) {
                Frame(context) {
                    when (content) {
                        is WidgetContent.Several -> Several(context, content.sidekicks, faces)
                        else -> Placeholder(context, content)
                    }
                }
            }
        }
    }
}

@Composable
private fun Frame(context: Context, content: @Composable () -> Unit) {
    Box(
        GlanceModifier.fillMaxSize().appWidgetBackground().cornerRadius(24.dp).background(GlanceTheme.colors.widgetBackground).padding(12.dp),
        contentAlignment = Alignment.Center,
    ) { content() }
}

@Composable
private fun Placeholder(context: Context, content: WidgetContent) {
    val (text, link) = when (content) {
        WidgetContent.SignedOut -> "Sign in to Dex" to "dex://app"
        WidgetContent.NoSidekicks -> "Make a sidekick in Dex" to "dex://app/characters/new"
        else -> "Loading your sidekicks…" to "dex://app"
    }
    Box(GlanceModifier.fillMaxSize().clickable(open(context, link)), contentAlignment = Alignment.Center) {
        Text(text, style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 14.sp, fontWeight = FontWeight.Medium))
    }
}

@Composable
private fun UnreadDot(size: Int = 8) {
    Image(
        ImageProvider(R.drawable.widget_dot),
        contentDescription = "Unread",
        colorFilter = ColorFilter.tint(GlanceTheme.colors.primary),
        modifier = GlanceModifier.size(size.dp),
    )
}

@Composable
private fun OneSidekick(context: Context, sidekick: WidgetSidekick, face: android.graphics.Bitmap) {
    val size = LocalSize.current
    val tall = size.height >= 100.dp
    val faceSize = if (tall) 56.dp else 44.dp
    val message = @Composable {
        Box(
            GlanceModifier.cornerRadius(16.dp).background(GlanceTheme.colors.primaryContainer).padding(horizontal = 12.dp, vertical = 6.dp)
                .clickable(open(context, WidgetContent.chatLink(sidekick, compose = true)))
                .semantics { contentDescription = "Message ${sidekick.name}" },
        ) {
            Text("Message", style = TextStyle(color = GlanceTheme.colors.onPrimaryContainer, fontSize = 13.sp, fontWeight = FontWeight.Medium))
        }
    }
    Column(GlanceModifier.fillMaxSize().clickable(open(context, WidgetContent.chatLink(sidekick))), verticalAlignment = Alignment.CenterVertically) {
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Image(ImageProvider(face), contentDescription = sidekick.name, modifier = GlanceModifier.size(faceSize))
            Spacer(GlanceModifier.width(12.dp))
            Column(GlanceModifier.defaultWeight()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        sidekick.name,
                        maxLines = 1,
                        style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 16.sp, fontWeight = if (sidekick.unread) FontWeight.Bold else FontWeight.Medium),
                    )
                    if (sidekick.unread) {
                        Spacer(GlanceModifier.width(6.dp))
                        UnreadDot()
                    }
                }
                Text(
                    sidekick.line,
                    maxLines = if (tall) 3 else 1,
                    style = TextStyle(
                        color = if (sidekick.busy) GlanceTheme.colors.primary else if (sidekick.unread) GlanceTheme.colors.onSurface else GlanceTheme.colors.onSurfaceVariant,
                        fontSize = 13.sp,
                    ),
                )
            }
            if (!tall && size.width >= 220.dp) {
                Spacer(GlanceModifier.width(8.dp))
                message()
            }
        }
        if (tall) {
            Spacer(GlanceModifier.defaultWeight())
            Row(GlanceModifier.fillMaxWidth(), horizontalAlignment = Alignment.End) { message() }
        }
    }
}

@Composable
private fun Several(context: Context, sidekicks: List<WidgetSidekick>, faces: Map<String, android.graphics.Bitmap>) {
    val size = LocalSize.current
    // Tall and narrow: two rows of two.
    val grid = sidekicks.size > 2 && size.height >= 150.dp && size.width < 260.dp
    val rows = if (grid) sidekicks.chunked(2) else listOf(sidekicks)
    val perRow = rows.maxOf { it.size }
    val faceSize = minOf(56.dp, (size.width - 24.dp) / perRow - 16.dp, if (grid) (size.height - 24.dp) / 2 - 28.dp else size.height - 52.dp).coerceAtLeast(32.dp)
    Column(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically, horizontalAlignment = Alignment.CenterHorizontally) {
        rows.forEachIndexed { index, row ->
            if (index > 0) Spacer(GlanceModifier.height(8.dp))
            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalAlignment = Alignment.CenterHorizontally) {
                row.forEach { sidekick ->
                    Column(
                        GlanceModifier.defaultWeight().clickable(open(context, WidgetContent.chatLink(sidekick))),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Box(contentAlignment = Alignment.TopEnd) {
                            Image(ImageProvider(faces.getValue(sidekick.id)), contentDescription = sidekick.name + if (sidekick.unread) ", unread" else "", modifier = GlanceModifier.size(faceSize))
                            if (sidekick.unread) UnreadDot(12)
                        }
                        Spacer(GlanceModifier.height(4.dp))
                        Text(
                            sidekick.name,
                            maxLines = 1,
                            style = TextStyle(
                                color = GlanceTheme.colors.onSurface,
                                fontSize = 12.sp,
                                fontWeight = if (sidekick.unread) FontWeight.Bold else FontWeight.Normal,
                            ),
                        )
                    }
                }
            }
        }
    }
}

class SidekickWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SidekickWidget()

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        WidgetSync.schedule(context)
        WidgetSync.refreshSoon(context)
    }

    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        super.onDeleted(context, appWidgetIds)
        val choices = WidgetChoices(context)
        appWidgetIds.forEach(choices::remove)
    }
}

class SidekicksWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SidekicksWidget()

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        WidgetSync.schedule(context)
        WidgetSync.refreshSoon(context)
    }
}
