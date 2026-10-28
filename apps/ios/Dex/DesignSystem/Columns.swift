import SwiftUI

extension View {
    /// The list column of every split view (Chats, Machines, Files, a Library page, Settings): one width, so the list
    /// keeps its size from tab to tab on iPad, narrow enough to tile beside the detail on an iPad mini in portrait.
    /// The tab view's sidebar already has a toggle, so the list column doesn't add a second one.
    func listColumn() -> some View {
        navigationSplitViewColumnWidth(min: 260, ideal: 320, max: 400)
            .toolbar(removing: .sidebarToggle)
    }
}
