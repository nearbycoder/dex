import DexCore
import SwiftUI
import UIKit

/// Agent and project icons (the web's lucide names) as SF Symbols.
enum AgentIcons {
    static let all: [String] = [
        "bot", "git-pull-request", "shield-check", "search-code", "bug", "rocket", "pen-line", "book-open", "terminal", "database", "globe",
        "telescope", "chart", "brain", "wrench", "palette", "lightbulb", "mail", "calendar", "briefcase", "messages", "code", "file-text", "sparkles"
    ]

    static func symbol(_ icon: String) -> String {
        switch icon {
        case "bot": "cpu"
        case "git-pull-request": "arrow.triangle.pull"
        case "shield-check": "checkmark.shield"
        case "search-code": "doc.text.magnifyingglass"
        case "bug": "ladybug"
        case "rocket": "paperplane"
        case "pen-line": "pencil.line"
        case "book-open": "book"
        case "terminal": "terminal"
        case "database": "cylinder.split.1x2"
        case "globe": "globe"
        case "telescope": "binoculars"
        case "chart": "chart.bar"
        case "brain": "brain"
        case "wrench": "wrench.and.screwdriver"
        case "palette": "paintpalette"
        case "lightbulb": "lightbulb"
        case "mail": "envelope"
        case "calendar": "calendar"
        case "briefcase": "briefcase"
        case "messages": "bubble.left.and.bubble.right"
        case "code": "chevron.left.forwardslash.chevron.right"
        case "file-text": "doc.text"
        case "sparkles": "sparkles"
        default: "cpu"
        }
    }
}

/// Agent colors: the web's [background, foreground] pairs, adapted to light and dark.
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

/// An agent's or project's icon on its color, or a project's picture.
struct AgentAvatar: View {
    let icon: String
    let color: String
    var image: String? = nil
    var size: CGFloat = 32

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
        Group {
            if let picture = image.flatMap(Self.decode) {
                Image(uiImage: picture)
                    .resizable()
                    .scaledToFit()
                    .padding(size * 0.12)
                    .background(Color(.secondarySystemBackground))
            } else {
                Image(systemName: AgentIcons.symbol(icon))
                    .font(.system(size: size * 0.48, weight: .semibold))
                    .foregroundStyle(AgentColors.color(color))
                    .frame(width: size, height: size)
                    .background(AgentColors.color(color).opacity(0.18))
            }
        }
        .frame(width: size, height: size)
        .clipShape(shape)
        .overlay(shape.strokeBorder(.primary.opacity(0.08)))
        .accessibilityHidden(true)
    }

    /// A `data:` URL's image (project pictures are synced as data URLs).
    static func decode(_ dataURL: String) -> UIImage? {
        guard dataURL.hasPrefix("data:"), let comma = dataURL.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }
}

/// The signed-in user's GitHub avatar, or their initial.
struct UserAvatar: View {
    let viewer: Viewer?
    var size: CGFloat = 32

    var body: some View {
        AsyncImage(url: viewer?.avatarUrl.flatMap(URL.init(string:))) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Text(String(viewer?.name.first ?? "D").uppercased())
                .font(.system(size: size * 0.45, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.accentColor.gradient)
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .accessibilityHidden(true)
    }
}

/// A model maker's logo (from the asset catalog), or a CPU glyph.
struct MakerLogo: View {
    let maker: String
    var size: CGFloat = 18

    var body: some View {
        if UIImage(named: "maker-\(maker)") != nil {
            Image("maker-\(maker)")
                .resizable()
                .renderingMode(.template)
                .scaledToFit()
                .frame(width: size, height: size)
                .foregroundStyle(.primary)
        } else {
            Image(systemName: "cpu").frame(width: size, height: size)
        }
    }
}
