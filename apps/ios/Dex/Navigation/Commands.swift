import DexCore
import SwiftUI

/// Keyboard shortcuts for iPad (and the iPadOS menu bar): new chat, the places, settle, and stop.
struct DexCommands: Commands {
    @FocusedValue(Router.self) private var router
    @FocusedValue(DexClient.self) private var client

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            // On a Library page, ⌘N makes a new item there (agent, project, skill, server).
            // (Decided when pressed: the menu's title can lag behind the page on screen.)
            Button(router?.libraryNewItem?.title ?? "New Chat") {
                guard let router else { return }
                if let item = router.libraryNewItem { router.open(item.route, compact: router.tab == .library) } else { router.newChat() }
            }
            .keyboardShortcut("n", modifiers: .command)
            .disabled(router == nil)
            if router?.libraryNewItem != nil {
                Button("New Chat") { router?.newChat() }
            }
        }
        CommandMenu("Go") {
            Button("Chats") { router?.tab = .chats }.keyboardShortcut("1", modifiers: .command)
            Button("Machines") { router?.tab = .machines }.keyboardShortcut("2", modifiers: .command)
            Button("Files") { router?.tab = .files }.keyboardShortcut("3", modifiers: .command)
            Button("Agents") { router?.open(.page(.agents), compact: false) }.keyboardShortcut("4", modifiers: .command)
            Button("Projects") { router?.open(.page(.projects), compact: false) }.keyboardShortcut("5", modifiers: .command)
            Button("Skills") { router?.open(.page(.skills), compact: false) }.keyboardShortcut("6", modifiers: .command)
            Button("MCP Servers") { router?.open(.page(.mcp), compact: false) }.keyboardShortcut("7", modifiers: .command)
            Button("Settings") { router?.tab = .settings }.keyboardShortcut(",", modifiers: .command)
            Button("Search") { router?.tab = .search }.keyboardShortcut("f", modifiers: [.command, .shift])
        }
        CommandMenu("Chat") {
            Button("Settle") {
                guard let router, let client, let id = router.chat else { return }
                let settled = client.state?.session(id)?.settledAt != nil
                client.perform { try await ChatActions.settle(id, !settled, client: client) }
            }
            .keyboardShortcut("e", modifiers: .command)
            .disabled(router?.chat == nil)
            Button("Stop") {
                guard let router, let client, let id = router.chat else { return }
                client.perform { try await client.run("abort", .string(id)) }
            }
            .keyboardShortcut(".", modifiers: .command)
            .disabled(router?.chat == nil)
            Button("Open Machine") {
                guard let router, let id = router.chat else { return }
                router.openMachine(id)
            }
            .keyboardShortcut("m", modifiers: [.command, .shift])
            .disabled(router?.chat == nil)
        }
    }
}
