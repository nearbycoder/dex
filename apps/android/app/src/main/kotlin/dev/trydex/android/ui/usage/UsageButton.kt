package dev.trydex.android.ui.usage

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProgressIndicatorDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.nav.Usage
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.UsageMeter

/** Neutral, amber from 80%, and red once it's used up or blocked (the web's sidebar meter). */
@Composable
fun UsageMeter.tint(): Color = when {
    full -> MaterialTheme.colorScheme.error
    percent >= 80 -> DexTheme.colors.warning
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

/**
 * The way into Usage from the Chats bar: a ring filled to the most used allowance (OpenCode Go's 5 hours at 42%, say),
 * the way other apps keep a usage meter by the account. The plain chart icon until it loads, when no plan has an
 * allowance, and on an agent from before the meter. One tap opens the Usage page.
 */
@Composable
fun UsageButton() {
    val app = LocalApp.current
    val glance by app.graph.usage.glance.collectAsStateWithLifecycle()
    val top = glance?.top
    IconButton(onClick = { app.navigator.open(Usage) }, modifier = Modifier.testTag("usage-meter")) {
        val description = glance?.let { "Usage, ${it.spoken}" } ?: "Usage"
        if (top == null) {
            Icon(Icons.Outlined.BarChart, contentDescription = description)
            return@IconButton
        }
        val progress by animateFloatAsState((top.percent / 100).toFloat().coerceIn(0f, 1f), label = "usage")
        val tint = top.tint()
        Box(contentAlignment = Alignment.Center) {
            CircularProgressIndicator(
                progress = { if (top.limited) 1f else progress },
                // The button says it all; the ring's own "42 percent" would only repeat it.
                modifier = Modifier.size(26.dp).clearAndSetSemantics {},
                color = tint,
                strokeWidth = 2.5.dp,
                trackColor = MaterialTheme.colorScheme.outlineVariant,
                strokeCap = StrokeCap.Round,
                gapSize = ProgressIndicatorDefaults.CircularIndicatorTrackGapSize,
            )
            Icon(Icons.Outlined.BarChart, contentDescription = description, tint = tint, modifier = Modifier.size(14.dp))
        }
    }
}
