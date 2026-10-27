import DexCore
import SwiftUI

/// The Chats tab: the inbox beside the open chat (iPad, unfolded foldable), or the inbox pushing the chat (iPhone).
struct ChatsView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var columns: NavigationSplitViewVisibility = .all

    var body: some View {
        @Bindable var router = router
        NavigationSplitView(columnVisibility: $columns) {
            ChatListView()
                .listColumn()
        } detail: {
            NavigationStack {
                switch router.chatSelection {
                case .chat(let id):
                    ChatView(sessionId: id)
                        .id(id)
                case .new, nil:
                    NewChatView()
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
        // Regular width always shows something on the right: a new chat when nothing is open.
        .onChange(of: sizeClass, initial: true) { _, size in
            if size == .regular, router.chatSelection == nil { router.chatSelection = .new }
        }
        .onChange(of: router.chatSelection) { old, new in
            if case .chat(let id) = old, new != old { client.closeChat(id) }
        }
    }
}
