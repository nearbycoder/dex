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

/// A sidekick's face: their picture (the PNG of their look, or a photo), else their emoji (or initial) on their color.
/// Round, unlike agents and projects, so a sidekick reads as someone rather than something.
struct CharacterAvatar: View {
    let glyph: String
    let color: String
    var image: String? = nil
    var size: CGFloat = 32
    /// A dot at the bottom right while they're answering.
    var typing = false

    init(glyph: String, color: String, image: String? = nil, size: CGFloat = 32, typing: Bool = false) {
        self.glyph = glyph; self.color = color; self.image = image; self.size = size; self.typing = typing
    }

    init(_ character: CharacterProfile, size: CGFloat = 32, typing: Bool = false) {
        self.init(glyph: character.glyph, color: character.color, image: character.image, size: size, typing: typing)
    }

    var body: some View {
        let tint = AgentColors.color(color)
        Group {
            if let picture = image.flatMap(AgentAvatar.decode) {
                // Their look (its PNG) or a photo, on their color.
                Image(uiImage: picture)
                    .resizable()
                    .scaledToFill()
                    .background(tint.opacity(0.2))
            } else {
                // An emoji (from before looks) is drawn larger than a letter of the same point size reads.
                let emoji = glyph.unicodeScalars.contains { $0.properties.isEmojiPresentation || $0.properties.generalCategory == .otherSymbol }
                Text(glyph)
                    .font(.system(size: size * (emoji ? 0.52 : 0.44), weight: .semibold, design: .rounded))
                    .foregroundStyle(tint)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .frame(width: size, height: size)
                    .background(tint.opacity(0.2).gradient)
            }
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .overlay(Circle().strokeBorder(.primary.opacity(0.08)))
        .overlay(alignment: .bottomTrailing) {
            if typing {
                Circle()
                    .fill(Color.dexAccent)
                    .frame(width: max(8, size * 0.28), height: max(8, size * 0.28))
                    .overlay(Circle().strokeBorder(Color(.systemBackground), lineWidth: 2))
                    .phaseAnimator([1.0, 0.4]) { view, phase in view.opacity(phase) }
                    .offset(x: 1, y: 1)
            }
        }
        .accessibilityHidden(true)
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
                .background(Color.selectionAccent.gradient)
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
