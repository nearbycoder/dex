package dev.trydex.android.ui.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.rememberNavBackStack

/** How deep a route sits in its tab's list-detail layout: 0 list, 1 detail, 2 extra. */
fun Route.level(): Int = when (this) {
    ChatList, MachineList, LibraryHome, SettingsHome -> 0
    is ChatMachine, is CharacterPage -> 2
    is ProjectEditor, is AgentEditor, is CharacterEditor, is SkillEditor, is McpEditor, is WorkspaceFile -> 2
    else -> 1
}

/** The routes above this one, from its tab's root. */
fun Route.parents(): List<Route> = when (this) {
    ChatList, MachineList, LibraryHome, SettingsHome -> emptyList()
    is ChatMachine -> listOf(ChatList, Chat(key))
    is CharacterPage -> listOf(ChatList, Chat(sessionId))
    is ProjectEditor -> listOf(LibraryHome, ProjectList)
    is AgentEditor -> listOf(LibraryHome, AgentList)
    is CharacterEditor -> listOf(LibraryHome, CharacterList)
    is SkillEditor -> listOf(LibraryHome, SkillList)
    is McpEditor -> listOf(LibraryHome, McpList)
    is WorkspaceFile -> listOf(LibraryHome, Workspace)
    else -> listOf(tab.root())
}

/**
 * One back stack per tab, kept across tab switches, fold changes, and process death. Opening a route switches to its
 * tab and replaces whatever was at its level (picking another chat replaces the open one rather than stacking).
 */
@Stable
class Navigator(private val stacks: Map<Tab, NavBackStack<NavKey>>, private val current: MutableState<Tab>) {
    var tab: Tab
        get() = current.value
        private set(value) {
            current.value = value
        }

    val stack: NavBackStack<NavKey> get() = stacks.getValue(tab)

    fun stack(tab: Tab): NavBackStack<NavKey> = stacks.getValue(tab)

    val top: Route? get() = stack.lastOrNull() as? Route

    /** Switches tab; choosing the tab you're on goes back to its root. */
    fun select(tab: Tab) {
        if (tab == this.tab) {
            val stack = stack(tab)
            while (stack.size > 1) stack.removeAt(stack.lastIndex)
        } else {
            this.tab = tab
        }
    }

    fun open(route: Route) {
        tab = route.tab
        val stack = stack(route.tab)
        val parents = route.parents()
        val prefixMatches = parents.indices.all { i -> stack.getOrNull(i) == parents[i] }
        if (!prefixMatches) {
            stack.clear()
            stack.addAll(parents)
        } else {
            while (stack.size > parents.size) stack.removeAt(stack.lastIndex)
        }
        stack.add(route)
    }

    /** Replaces the top route (a draft that became a real item: new → its id). */
    fun replace(route: Route) {
        val stack = stack(route.tab)
        if (stack.isNotEmpty() && (stack.last() as? Route)?.level() == route.level()) stack.removeAt(stack.lastIndex)
        stack.add(route)
        tab = route.tab
    }

    /** Opens a whole path, e.g. from a notification link. */
    fun openAll(routes: List<Route>) {
        val last = routes.lastOrNull() ?: return
        tab = last.tab
        val stack = stack(last.tab)
        stack.clear()
        stack.addAll(routes)
    }

    /** Back: pops within the tab; at a tab's root, goes to Chats; at Chats' root there's nothing to go back to. */
    fun back(): Boolean {
        val stack = stack
        if (stack.size > 1) {
            stack.removeAt(stack.lastIndex)
            return true
        }
        if (tab != Tab.Chats) {
            tab = Tab.Chats
            return true
        }
        return false
    }

    /** Leaves a route that no longer exists (a deleted chat or project). */
    fun close(route: Route) {
        stacks.values.forEach { stack -> stack.removeAll { it == route } }
        stacks.forEach { (tab, stack) -> if (stack.isEmpty()) stack.add(tab.root()) }
    }

    fun canGoBack(): Boolean = stack.size > 1 || tab != Tab.Chats
}

@Composable
fun rememberNavigator(): Navigator {
    val chats = rememberNavBackStack(ChatList)
    val machines = rememberNavBackStack(MachineList)
    val library = rememberNavBackStack(LibraryHome)
    val settings = rememberNavBackStack(SettingsHome)
    val tabName = rememberSaveable { mutableStateOf(Tab.Chats.name) }
    val tab = remember(tabName) { TabState(tabName) }
    return remember(chats, machines, library, settings) {
        Navigator(mapOf(Tab.Chats to chats, Tab.Machines to machines, Tab.Library to library, Tab.Settings to settings), tab)
    }
}

/** The current tab, saved by name. */
private class TabState(private val name: MutableState<String>) : MutableState<Tab> {
    override var value: Tab
        get() = Tab.valueOf(name.value)
        set(value) {
            name.value = value.name
        }

    override fun component1() = value
    override fun component2(): (Tab) -> Unit = { value = it }
}
