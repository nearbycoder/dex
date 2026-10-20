import DexCore
import SwiftUI

/// The Files tab: the agent's /workspace.
struct FilesView: View {
    var body: some View {
        NavigationSplitView {
            List {}.navigationTitle("Files")
        } detail: {
            EmptyStateView(title: "No file selected", symbol: "doc")
        }
    }
}
