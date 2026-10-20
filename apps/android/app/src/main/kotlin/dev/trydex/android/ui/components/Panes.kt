package dev.trydex.android.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeFlexibleTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.trydex.android.R
import dev.trydex.android.ui.LocalApp

/** Whether a pane needs its own back arrow: only when it's alone on screen (its parent pane isn't beside it). */
@Composable
fun showBack(): Boolean = LocalApp.current.panes < 2

@Composable
fun BackButton(onBack: (() -> Unit)? = null) {
    val app = LocalApp.current
    IconButton(onClick = { if (onBack != null) onBack() else app.navigator.back() }, modifier = Modifier.testTag("back")) {
        Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back")
    }
}

/**
 * A page in a pane: a large, collapsing title (Material 3 Expressive's flexible app bar) over scrolling content. The
 * back arrow shows only when the pane is alone on screen.
 */
@Composable
fun PaneScaffold(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    back: Boolean = showBack(),
    actions: @Composable RowScope.() -> Unit = {},
    floatingActionButton: @Composable () -> Unit = {},
    bottomBar: @Composable () -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        modifier = modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeFlexibleTopAppBar(
                title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                subtitle = subtitle?.let { { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis) } },
                navigationIcon = { if (back) BackButton() },
                actions = actions,
                scrollBehavior = scroll,
            )
        },
        floatingActionButton = floatingActionButton,
        bottomBar = bottomBar,
        contentWindowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom),
        content = content,
    )
}

/** A compact one-line app bar, for panes whose content needs the room (chat, machine, file). */
@Composable
fun CompactTopBar(
    title: @Composable () -> Unit,
    back: Boolean = showBack(),
    onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
    scrollBehavior: TopAppBarScrollBehavior? = null,
) {
    TopAppBar(
        title = title,
        navigationIcon = { if (back) BackButton(onBack) },
        actions = actions,
        scrollBehavior = scrollBehavior,
        colors = TopAppBarDefaults.topAppBarColors(scrolledContainerColor = MaterialTheme.colorScheme.surfaceContainer),
    )
}

/** Scrolling page content, centered and width-limited on big screens. */
@Composable
fun PageColumn(padding: PaddingValues, modifier: Modifier = Modifier, maxWidth: Int = 720, content: @Composable () -> Unit) {
    Box(modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier
                .widthIn(max = maxWidth.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            content()
            Spacer(Modifier.height(24.dp))
        }
    }
}

/** What a detail pane shows before you pick something. */
@Composable
fun DetailPlaceholder(text: String) {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = null, modifier = Modifier.size(120.dp))
            Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
    }
}
