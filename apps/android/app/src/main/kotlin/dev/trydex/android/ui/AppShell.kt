package dev.trydex.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Widgets
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.rounded.Computer
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Widgets
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDragHandle
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.layout.calculatePaneScaffoldDirectiveWithTwoPanesOnMediumWidth
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.material3.adaptive.layout.rememberPaneExpansionState
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteItem
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffoldValue
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteType
import androidx.compose.material3.adaptive.navigationsuite.rememberNavigationSuiteScaffoldState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import androidx.window.core.layout.WindowSizeClass
import dev.trydex.android.AppGraph
import dev.trydex.android.ui.nav.Navigator
import dev.trydex.android.ui.nav.Route
import dev.trydex.android.ui.nav.Tab
import dev.trydex.android.ui.nav.level
import dev.trydex.android.ui.nav.NewChat
import dev.trydex.android.ui.nav.rememberNavigator

/** What every screen can reach: the app's singletons and navigation. */
class AppContext(val graph: AppGraph, val navigator: Navigator, val panes: Int)

val LocalApp = staticCompositionLocalOf<AppContext> { error("No AppContext") }

private data class TabItem(val tab: Tab, val label: String, val icon: ImageVector, val selectedIcon: ImageVector)

@Composable
fun AppShell(graph: AppGraph, links: LinkInbox) {
    val navigator = rememberNavigator()
    val state by graph.repository.state.collectAsStateWithLifecycle()
    val adaptive = currentWindowAdaptiveInfo(supportLargeAndXLargeWidth = true)
    val sizeClass = adaptive.windowSizeClass
    // Two panes from medium widths up (small tablets, unfolded foldables), split at a hinge when there is one.
    val directive = remember(adaptive) { calculatePaneScaffoldDirectiveWithTwoPanesOnMediumWidth(adaptive) }
    val panes = directive.maxHorizontalPartitions

    // Links from notifications and shortcuts.
    LaunchedEffect(links) {
        links.links.collect { routes -> navigator.openAll(routes) }
    }

    val vmConfigured = state?.vmConfigured == true
    val tabs = buildList {
        add(TabItem(Tab.Chats, "Chats", Icons.Outlined.Forum, Icons.Rounded.Forum))
        if (vmConfigured) add(TabItem(Tab.Machines, "Machines", Icons.Outlined.Computer, Icons.Rounded.Computer))
        add(TabItem(Tab.Library, "Library", Icons.Outlined.Widgets, Icons.Rounded.Widgets))
        add(TabItem(Tab.Settings, "Settings", Icons.Outlined.Settings, Icons.Rounded.Settings))
    }
    // The Machines tab goes away with the VM provider: don't stay on it.
    LaunchedEffect(vmConfigured) {
        if (!vmConfigured && state != null && navigator.tab == Tab.Machines) navigator.select(Tab.Chats)
    }

    val wide = sizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_EXPANDED_LOWER_BOUND)
    val medium = sizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_MEDIUM_LOWER_BOUND)
    val veryWide = sizeClass.isWidthAtLeastBreakpoint(1200)
    val suiteType = when {
        veryWide -> NavigationSuiteType.WideNavigationRailExpanded
        medium -> NavigationSuiteType.WideNavigationRailCollapsed
        else -> NavigationSuiteType.ShortNavigationBarCompact
    }
    // In a chat or another detail on a phone, the screen is all the content's (like an open conversation in Gmail).
    val immersive = !medium && (navigator.top?.level() ?: 0) > 0
    val suiteState = rememberNavigationSuiteScaffoldState()
    LaunchedEffect(immersive) {
        if (immersive) suiteState.hide() else suiteState.show()
    }

    val running = state?.vms?.count { it.running } ?: 0
    val waiting = state?.access?.waiting(System.currentTimeMillis())?.size ?: 0
    val settingsAttention = state != null && (!state!!.anyProviderConnected || waiting > 0)
    val libraryAttention = state?.mcp?.any { it.status.needsAttention } == true

    val app = remember(graph, navigator, panes) { AppContext(graph, navigator, panes) }
    CompositionLocalProvider(LocalApp provides app) {
        NavigationSuiteScaffold(
            navigationSuiteType = suiteType,
            state = suiteState,
            navigationItems = {
                tabs.forEach { item ->
                    val selected = navigator.tab == item.tab
                    NavigationSuiteItem(
                        selected = selected,
                        onClick = { navigator.select(item.tab) },
                        icon = {
                            BadgedBox(badge = {
                                when {
                                    item.tab == Tab.Machines && running > 0 -> Badge { Text("$running") }
                                    item.tab == Tab.Settings && waiting > 0 -> Badge { Text("$waiting") }
                                    item.tab == Tab.Settings && settingsAttention -> Badge()
                                    item.tab == Tab.Library && libraryAttention -> Badge()
                                }
                            }) {
                                Icon(if (selected) item.selectedIcon else item.icon, contentDescription = null)
                            }
                        },
                        label = { Text(item.label) },
                        modifier = Modifier.testTag("tab-${item.tab.name}"),
                    )
                }
            },
            primaryActionContent = {
                if (medium) {
                    val newChat = { navigator.open(NewChat(nonce = System.nanoTime())) }
                    if (suiteType == NavigationSuiteType.WideNavigationRailExpanded) {
                        ExtendedFloatingActionButton(onClick = newChat, icon = { Icon(Icons.Rounded.Edit, null) }, text = { Text("New chat") })
                    } else {
                        FloatingActionButton(onClick = newChat) { Icon(Icons.Rounded.Edit, contentDescription = "New chat") }
                    }
                }
            },
        ) {
            Content(navigator, directive, wide)
        }
    }
}

@Composable
private fun Content(
    navigator: Navigator,
    directive: androidx.compose.material3.adaptive.layout.PaneScaffoldDirective,
    wide: Boolean,
) {
    val expansion = rememberPaneExpansionState()
    val strategy = rememberListDetailSceneStrategy<NavKey>(
        directive = directive,
        paneExpansionState = expansion,
        paneExpansionDragHandle = { state ->
            val interaction = remember { MutableInteractionSource() }
            VerticalDragHandle(
                modifier = Modifier.paneExpansionDraggable(state, LocalMinimumInteractiveComponentSize.current, interaction, semanticsProperties = {}),
                interactionSource = interaction,
            )
        },
    )
    Box(Modifier.fillMaxSize()) {
        AnimatedContent(targetState = navigator.tab, label = "tab") { tab ->
            NavDisplay(
                backStack = navigator.stack(tab),
                onBack = { navigator.back() },
                sceneStrategies = listOf(strategy),
                entryDecorators = listOf(rememberSaveableStateHolderNavEntryDecorator(), rememberViewModelStoreNavEntryDecorator()),
                entryProvider = entryProvider { screens(wide) },
            )
        }
    }
}
