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

/// An agent's or project's icon on its color, or a project's picture.
struct AgentAvatar: View {
    @Environment(DexClient.self) private var client: DexClient?
    let icon: String
    let color: String
    var image: String? = nil
    var size: CGFloat = 32
    @State private var loaded: MediaLoader.AvatarContent?
    @State private var loadedKey: String?

    private var remoteContent: MediaLoader.AvatarContent? {
        guard let image, image.hasPrefix("/api/avatars/") else { return nil }
        if loadedKey == image, let loaded { return loaded }
        return MediaLoader.shared.cachedAvatar(image)
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
        Group {
            if let picture = image.flatMap(Self.decode) {
                Image(uiImage: picture)
                    .resizable()
                    .scaledToFit()
                    .padding(size * 0.12)
                    .background(Color(.secondarySystemBackground))
            } else if let image, image.hasPrefix("data:image/svg+xml") {
                SVGPicture(dataUrl: image)
                    .padding(size * 0.12)
                    .background(Color(.secondarySystemBackground))
            } else if case .image(let picture) = remoteContent {
                Image(uiImage: picture)
                    .resizable()
                    .scaledToFit()
                    .padding(size * 0.12)
                    .background(Color(.secondarySystemBackground))
            } else if case .svg(let svgDataUrl) = remoteContent {
                SVGPicture(dataUrl: svgDataUrl)
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
        .task(id: image) {
            guard let image, image.hasPrefix("/api/avatars/"), let client else { return }
            if let cached = MediaLoader.shared.cachedAvatar(image) {
                loaded = cached
                loadedKey = image
                return
            }
            if let fetched = try? await MediaLoader.shared.avatar(image, client: client) {
                loaded = fetched
                loadedKey = image
            }
        }
    }

    @MainActor private static let imageCache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 80
        cache.totalCostLimit = 16 * 1024 * 1024
        return cache
    }()

    /// A `data:` URL's image (project pictures and sidekick faces are synced as data URLs), decoded once.
    @MainActor static func decode(_ dataURL: String) -> UIImage? {
        let key = dataURL as NSString
        if let cached = imageCache.object(forKey: key) { return cached }
        guard dataURL.hasPrefix("data:"), let comma = dataURL.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
              let image = UIImage(data: data) else { return nil }
        let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        imageCache.setObject(image, forKey: key, cost: max(1, cost))
        return image
    }
}

/// A sidekick's face: their look (one of Dex's shapes drawn here, `SidekickArt`, else the agent's PNG of it, a face shown
/// whole), else a photo or their emoji (or initial) on their color, round, so a sidekick reads as someone rather than
/// something.
struct CharacterAvatar: View {
    @Environment(DexClient.self) private var client: DexClient?
    let glyph: String
    let color: String
    var image: String? = nil
    /// `image` is their look's PNG (a face on a clear background), not a photo.
    var look = false
    /// Their look, drawn here when it's one of Dex's shapes (a draft's look has no picture until it's saved).
    var parts: SidekickParts? = nil
    var size: CGFloat = 32
    /// A dot at the bottom right while they're answering.
    var typing = false
    /// The face blinks now and then (a big one, on its own: not in lists).
    var live = false
    @State private var loaded: UIImage?
    @State private var loadedKey: String?

    init(glyph: String, color: String, image: String? = nil, look: Bool = false, parts: SidekickParts? = nil, size: CGFloat = 32, typing: Bool = false,
         live: Bool = false) {
        self.glyph = glyph; self.color = color; self.image = image; self.look = look; self.parts = parts; self.size = size; self.typing = typing
        self.live = live
    }

    init(_ character: CharacterProfile, size: CGFloat = 32, typing: Bool = false, live: Bool = false) {
        self.init(glyph: character.glyph, color: character.color, image: character.image, look: character.look != nil, parts: SidekickParts(character.look),
                  size: size, typing: typing, live: live)
    }

    private var resolvedPicture: UIImage? {
        guard let image else { return nil }
        if image.hasPrefix("data:") { return AgentAvatar.decode(image) }
        if image.hasPrefix("/api/avatars/") {
            if loadedKey == image, let loaded { return loaded }
            if case .image(let cached) = MediaLoader.shared.cachedAvatar(image) { return cached }
        }
        return nil
    }

    var body: some View {
        let tint = AgentColors.color(color)
        Group {
            if look, let parts, parts.isDrawable {
                // Their face, whole (its corners and tips aren't cropped), drawn here.
                SidekickArt(parts: parts, live: live)
                    .frame(width: size, height: size)
            } else if let picture = resolvedPicture {
                if look {
                    // The agent's picture of their face (a shape a chat drew), whole.
                    Image(uiImage: picture)
                        .resizable()
                        .scaledToFit()
                        .frame(width: size, height: size)
                } else {
                    // A photo, round, on their color.
                    Image(uiImage: picture)
                        .resizable()
                        .scaledToFill()
                        .background(tint.opacity(0.2))
                        .frame(width: size, height: size)
                        .clipShape(.circle)
                        .overlay(Circle().strokeBorder(.primary.opacity(0.08)))
                }
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
                    .clipShape(.circle)
                    .overlay(Circle().strokeBorder(.primary.opacity(0.08)))
            }
        }
        .frame(width: size, height: size)
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
        .task(id: image) {
            if look, let parts, parts.isDrawable { return }
            guard let image, image.hasPrefix("/api/avatars/"), let client else { return }
            if case .image(let cached) = MediaLoader.shared.cachedAvatar(image) {
                loaded = cached
                loadedKey = image
                return
            }
            if case .image(let fetched) = try? await MediaLoader.shared.avatar(image, client: client) {
                loaded = fetched
                loadedKey = image
            }
        }
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

/// A model maker's logo (from the asset catalog), or a CPU glyph for a maker this build doesn't know.
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
                // Other's sparkles stand in for a maker, muted as on the web.
                .foregroundStyle(maker == "other" ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
        } else {
            Image(systemName: "cpu").frame(width: size, height: size)
        }
    }
}
