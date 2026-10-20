import DexCore
import SwiftUI

/// A chat's generated UI (a `render_ui` call), rendered natively. Placeholder until the OpenUI renderer lands: shows
/// the card's title and its program.
struct OpenUICardView: View {
    let feed: ChatFeed
    let call: ContentBlock.ToolCall
    let streaming: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(call.arguments["title"]?.string ?? "Generated UI", systemImage: "rectangle.3.group")
                .font(.headline)
            CodeBlockView(code: call.arguments["code"]?.string ?? "", language: "openui")
        }
        .accessibilityIdentifier("openui.card")
    }
}
