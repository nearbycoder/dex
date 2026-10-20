import SwiftUI

/// Shown for the moment a window sets up its connection.
struct ShellSkeleton: View {
    var body: some View {
        NavigationStack {
            List {
                ForEach(0..<8, id: \.self) { _ in ChatRowSkeleton() }
            }
            .navigationTitle("Chats")
        }
    }
}
