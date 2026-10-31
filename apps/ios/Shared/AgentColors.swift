import SwiftUI

/// Agent colors: the web's [background, foreground] pairs, adapted to light and dark. Shared with the widgets.
enum AgentColors {
    static let all: [String] = ["emerald", "sky", "violet", "amber", "rose", "orange", "teal", "zinc"]

    static func color(_ name: String) -> Color {
        switch name {
        case "emerald": .green
        case "sky": .cyan
        case "violet": .purple
        case "amber": .yellow
        case "rose": .pink
        case "orange": .orange
        case "teal": .teal
        default: .gray
        }
    }
}
