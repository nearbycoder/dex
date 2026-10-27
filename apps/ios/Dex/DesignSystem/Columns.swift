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

extension Color {
    /// The accent behind a selected row: the accent in light mode, a deeper green in dark mode, where the accent is too
    /// light for white text on it. Put it on the list itself, not its column, so the column's toolbar keeps the accent.
    static let selectionAccent = Color("SelectionAccent")
}
