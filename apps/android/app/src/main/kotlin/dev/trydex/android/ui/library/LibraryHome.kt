package dev.trydex.android.ui.library

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Extension
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material.icons.rounded.SmartToy
import androidx.compose.material.icons.rounded.Source
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.PageColumn
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.SectionCard
import dev.trydex.android.ui.components.StatusDot
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.nav.AgentList
import dev.trydex.android.ui.nav.McpList
import dev.trydex.android.ui.nav.ProjectList
import dev.trydex.android.ui.nav.Route
import dev.trydex.android.ui.nav.SkillList
import dev.trydex.android.ui.nav.Tab
import dev.trydex.android.ui.nav.Workspace
import dev.trydex.android.ui.theme.DexTheme

private class Destination(
    val route: Route,
    val tag: String,
    val label: String,
    val detail: String,
    val icon: ImageVector,
    val count: Int?,
    val attention: Boolean = false,
)

/** The Library tab's root: projects, agents, skills, MCP servers, and the workspace, with how many of each. */
@Composable
fun LibraryHomeScreen() {
    val app = LocalApp.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val connected by repository.connected.collectAsStateWithLifecycle()
    val haptics = haptics()
    // Shown beside this list on wide screens: its row is highlighted.
    val selected = app.navigator.stack(Tab.Library).getOrNull(1) as? Route
    val files by produceState<Int?>(null, connected) {
        if (connected) value = attempt { repository.api.listFiles().size }.getOrNull() ?: value
    }

    PaneScaffold(title = "Library", back = false, modifier = Modifier.testTag("library-home")) { padding ->
        PageColumn(padding) {
            val current = state
            if (current == null) {
                BoneRows(5)
                return@PageColumn
            }
            val destinations = listOf(
                Destination(ProjectList, "projects", "Projects", "Repos and a setup script, cloned onto each chat's VM", Icons.Rounded.Source, current.projects.size),
                Destination(AgentList, "agents", "Agents", "Presets for a job: instructions, a model, MCP servers", Icons.Rounded.SmartToy, current.agents.size),
                Destination(SkillList, "skills", "Skills", "Instructions for particular tasks", Icons.Rounded.AutoAwesome, current.skills.size),
                Destination(McpList, "mcp", "MCP servers", "Remote tools for Dex", Icons.Rounded.Extension, current.mcp.size, current.mcp.any { it.status.needsAttention }),
                Destination(Workspace, "workspace", "Workspace files", "The agent's files, kept across chats", Icons.Rounded.FolderOpen, files),
            )
            SectionCard(contentPadding = false) {
                Column(Modifier.padding(horizontal = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    destinations.forEach { destination ->
                        DestinationRow(destination, selected == destination.route) {
                            haptics.tap()
                            app.navigator.open(destination.route)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DestinationRow(destination: Destination, selected: Boolean, onClick: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(20.dp),
        color = if (selected) scheme.secondaryContainer else Color.Transparent,
        modifier = Modifier.testTag("library-${destination.tag}"),
    ) {
        ListItem(
            headlineContent = { Text(destination.label) },
            supportingContent = { Text(destination.detail, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) },
            leadingContent = {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = if (selected) scheme.primary else scheme.surfaceContainerHighest,
                    contentColor = if (selected) scheme.onPrimary else scheme.onSurfaceVariant,
                    modifier = Modifier.size(40.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) { Icon(destination.icon, contentDescription = null, modifier = Modifier.size(22.dp)) }
                }
            },
            trailingContent = {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (destination.attention) StatusDot(DexTheme.colors.warning, label = "A server needs attention")
                    destination.count?.let { count ->
                        Text("$count", style = MaterialTheme.typography.labelLarge, color = scheme.onSurfaceVariant, modifier = Modifier.testTag("library-${destination.tag}-count"))
                    }
                    Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = scheme.outline)
                }
            },
            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        )
    }
}
