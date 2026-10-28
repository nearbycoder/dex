package dev.trydex.android.ui

import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import dev.trydex.android.ui.chat.ChatListScreen
import dev.trydex.android.ui.chat.ChatScreen
import dev.trydex.android.ui.chat.NewChatScreen
import dev.trydex.android.ui.components.DetailPlaceholder
import dev.trydex.android.ui.files.WorkspaceFileScreen
import dev.trydex.android.ui.files.WorkspaceScreen
import dev.trydex.android.ui.library.AgentEditorScreen
import dev.trydex.android.ui.library.AgentListScreen
import dev.trydex.android.ui.library.LibraryHomeScreen
import dev.trydex.android.ui.library.McpEditorScreen
import dev.trydex.android.ui.library.McpListScreen
import dev.trydex.android.ui.library.ProjectEditorScreen
import dev.trydex.android.ui.library.ProjectListScreen
import dev.trydex.android.ui.library.SkillEditorScreen
import dev.trydex.android.ui.library.SkillListScreen
import dev.trydex.android.ui.machine.MachineListScreen
import dev.trydex.android.ui.machine.MachineScreen
import dev.trydex.android.ui.nav.Access
import dev.trydex.android.ui.nav.AgentEditor
import dev.trydex.android.ui.nav.AgentList
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.nav.ChatList
import dev.trydex.android.ui.nav.ChatMachine
import dev.trydex.android.ui.nav.GeneralSettings
import dev.trydex.android.ui.nav.LibraryHome
import dev.trydex.android.ui.nav.Machine
import dev.trydex.android.ui.nav.MachineList
import dev.trydex.android.ui.nav.McpEditor
import dev.trydex.android.ui.nav.McpList
import dev.trydex.android.ui.nav.NewChat
import dev.trydex.android.ui.nav.AppearanceSettings
import dev.trydex.android.ui.nav.NotificationSettings
import dev.trydex.android.ui.nav.ProjectEditor
import dev.trydex.android.ui.nav.ProjectList
import dev.trydex.android.ui.nav.Secrets
import dev.trydex.android.ui.nav.SettingsHome
import dev.trydex.android.ui.nav.SkillEditor
import dev.trydex.android.ui.nav.SkillList
import dev.trydex.android.ui.nav.Usage
import dev.trydex.android.ui.nav.Workspace
import dev.trydex.android.ui.nav.WorkspaceFile
import dev.trydex.android.ui.settings.AccessScreen
import dev.trydex.android.ui.settings.AppearanceSettingsScreen
import dev.trydex.android.ui.settings.GeneralSettingsScreen
import dev.trydex.android.ui.settings.NotificationSettingsScreen
import dev.trydex.android.ui.settings.SecretsScreen
import dev.trydex.android.ui.settings.SettingsHomeScreen
import dev.trydex.android.ui.usage.UsageScreen

/** Every route's screen, and the pane it takes in list-detail layouts. */
fun EntryProviderScope<NavKey>.screens(@Suppress("UNUSED_PARAMETER") wide: Boolean) {
    val list = { placeholder: String -> ListDetailSceneStrategy.listPane(detailPlaceholder = { DetailPlaceholder(placeholder) }) }
    val detail = ListDetailSceneStrategy.detailPane()
    val extra = ListDetailSceneStrategy.extraPane()

    entry<ChatList>(metadata = list("Pick a chat, or start a new one.")) { ChatListScreen() }
    entry<NewChat>(metadata = detail) { NewChatScreen(it) }
    entry<Chat>(metadata = detail) { ChatScreen(it.id) }
    entry<ChatMachine>(metadata = extra) { MachineScreen(it.key, beside = true) }

    entry<MachineList>(metadata = list("Pick a machine to watch or control it.")) { MachineListScreen() }
    entry<Machine>(metadata = detail) { MachineScreen(it.key) }

    entry<LibraryHome>(metadata = list("Projects, agents, skills, MCP servers, and the workspace.")) { LibraryHomeScreen() }
    entry<ProjectList>(metadata = detail) { ProjectListScreen() }
    entry<ProjectEditor>(metadata = extra) { ProjectEditorScreen(it.id) }
    entry<AgentList>(metadata = detail) { AgentListScreen() }
    entry<AgentEditor>(metadata = extra) { AgentEditorScreen(it.id) }
    entry<SkillList>(metadata = detail) { SkillListScreen() }
    entry<SkillEditor>(metadata = extra) { SkillEditorScreen(it.id) }
    entry<McpList>(metadata = detail) { McpListScreen() }
    entry<McpEditor>(metadata = extra) { McpEditorScreen(it) }
    entry<Workspace>(metadata = detail) { WorkspaceScreen() }
    entry<WorkspaceFile>(metadata = extra) { WorkspaceFileScreen(it.path) }

    entry<SettingsHome>(metadata = list("Accounts, notifications, secrets, usage, and access.")) { SettingsHomeScreen() }
    entry<GeneralSettings>(metadata = detail) { GeneralSettingsScreen() }
    entry<AppearanceSettings>(metadata = detail) { AppearanceSettingsScreen() }
    entry<NotificationSettings>(metadata = detail) { NotificationSettingsScreen() }
    entry<Secrets>(metadata = detail) { SecretsScreen() }
    entry<Usage>(metadata = detail) { UsageScreen() }
    entry<Access>(metadata = detail) { AccessScreen() }
}
