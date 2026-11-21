import DexCore
import SwiftUI
import UIKit

/// A sidekick's look drawn natively: one of Dex's shapes from the layers bundled with it (`SidekickShapes.layer`, drawn
/// by the agent's renderer): the body tinted the look's color, the eyes over it. That's the agent's picture of the look
/// to the pixel, in any color, before it's saved. `live` ones blink now and then, as on the web, unless Reduce Motion is
/// on. Draws nothing for a shape it doesn't have (`SidekickParts.isDrawable`).
struct SidekickArt: View {
    let parts: SidekickParts
    var live = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var blink = 0.0

    var body: some View {
        let animate = live && !reduceMotion
        Group {
            if let shape = SidekickShapes.shape(parts.shape), parts.isDrawable, let bodyLayer = Self.layer(shape.key, "body"), let eyesLayer = Self.layer(shape.key, "eyes") {
                face(shape, body: bodyLayer, eyes: eyesLayer, blink: animate ? blink : 0)
            } else {
                Color.clear
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
        // Sleep between blinks instead of redrawing at 30 fps during the ~5 seconds the eyes stay open.
        .task(id: animate) {
            blink = 0
            guard animate else { return }
            let initial = Double.random(in: 0.4..<Self.blinkEvery)
            try? await Task.sleep(for: .seconds(initial))
            while !Task.isCancelled {
                withAnimation(.linear(duration: 0.08)) { blink = 1 }
                try? await Task.sleep(for: .milliseconds(80))
                guard !Task.isCancelled else { break }
                withAnimation(.linear(duration: 0.12)) { blink = 0 }
                try? await Task.sleep(for: .seconds(Self.blinkEvery - 0.08))
            }
        }
    }

    private func face(_ shape: SidekickShape, body: UIImage, eyes: UIImage, blink: Double) -> some View {
        ZStack {
            Image(uiImage: body).renderingMode(.template).resizable().interpolation(.high)
                .foregroundStyle(Self.skinColor(parts.skin))
            Image(uiImage: eyes).resizable().interpolation(.high)
                .scaleEffect(x: 1, y: 1 - blink * 0.9, anchor: UnitPoint(x: 0.5, y: (shape.eyesTop + shape.eyesBottom) / 2))
        }
    }

    private static let blinkEvery = 5.2

    private static let skinColors: [String: Color] = Dictionary(
        uniqueKeysWithValues: SidekickParts.skins.map { ($0.name, Color(hex: $0.hex)) }
    )

    private static func skinColor(_ skin: String) -> Color {
        skinColors[skin] ?? Color(hex: SidekickParts.skinHex(skin))
    }

    @MainActor private static let cache = NSCache<NSString, UIImage>()

    /// A shape's layer, decoded once.
    @MainActor private static func layer(_ key: String, _ part: String) -> UIImage? {
        let name = "\(key)-\(part)" as NSString
        if let image = cache.object(forKey: name) { return image }
        guard let data = SidekickShapes.layer(key, part), let image = UIImage(data: data) else { return nil }
        cache.setObject(image, forKey: name)
        return image
    }
}

extension Color {
    /// "#rrggbb".
    init(hex: String) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }
}

/// A look of your own (the web's look picker): Shuffle, the shape (each drawn in the look's color), the face's color
/// (each drawn as the face you'd get), and their accent color. A shape a chat drew shows among the shapes while it's the
/// look; its color changes on the web or in a chat, which can draw it.
struct LookMixer: View {
    /// The look being worn, if it's one (a photo or an emoji has none).
    let parts: SidekickParts?
    /// The look is a ready-made one (its shape and color aren't picks of yours, so none is marked).
    let isPreset: Bool
    let color: String
    /// The picture of the look being worn (for a shape a chat drew, which only the agent draws).
    var image: String? = nil
    /// A ready-made look picked.
    let preset: (SidekickLook) -> Void
    /// A shape or face color picked: the new look and the accent.
    let change: (SidekickParts, String) -> Void
    /// Only the accent changed: a photo stays a photo.
    let accent: (String) -> Void

    var body: some View {
        let current = parts ?? SidekickLook.all.first.flatMap { SidekickParts($0.look) } ?? SidekickParts()
        let mine = parts != nil && !isPreset
        VStack(alignment: .leading, spacing: 14) {
            Button {
                // Any shape in any color, with any accent, as the web's Shuffle.
                change(SidekickParts.random(), AgentColors.all.randomElement() ?? color)
            } label: {
                Label("Shuffle", systemImage: "dice")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("character.shuffle")
            shapes(current: current, selected: mine ? current.shape : nil)
            if current.shape == "custom" && parts != nil {
                Text("A chat drew this shape: change its color on the web, or ask a chat.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                faces(current: current, selected: mine ? current.skin : nil) { skin in
                    change(SidekickParts.make(current.shape, skin: skin, custom: current.custom), color)
                }
            }
            swatches("Accent", SidekickParts.backgrounds.map { ($0.name, $0.hex) }, selected: color, pick: accent)
        }
        .padding(.vertical, 6)
        .sensoryFeedback(.selection, trigger: parts)
        .sensoryFeedback(.selection, trigger: color)
    }

    private func tile<Content: View>(selected: Bool, @ViewBuilder _ content: () -> Content) -> some View {
        content()
            .frame(width: 40, height: 40)
            .padding(4)
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(selected ? Color.dexAccent : .clear, lineWidth: 2.5)
            }
            .contentShape(.rect(cornerRadius: 12))
    }

    private func shapes(current: SidekickParts, selected: String?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Shape").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if current.shape == "custom", let picture = image.flatMap(AgentAvatar.decode) {
                        tile(selected: selected == "custom") { Image(uiImage: picture).resizable().scaledToFit() }
                            .accessibilityLabel("Shape \(current.shapeName)")
                            .accessibilityAddTraits(selected == "custom" ? .isSelected : [])
                            .accessibilityIdentifier("character.shape.custom")
                    }
                    ForEach(SidekickShapes.all) { shape in
                        let candidate = SidekickParts.make(shape.key, skin: current.skin)
                        Button { change(candidate, color) } label: {
                            tile(selected: selected == shape.key) { SidekickArt(parts: candidate) }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Shape \(shape.name)")
                        .accessibilityAddTraits(selected == shape.key ? .isSelected : [])
                        .accessibilityIdentifier("character.shape.\(shape.key)")
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollClipDisabled()
            Text("Want something else? Ask a chat to draw your sidekick as anything, like “a teapot”.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func faces(current: SidekickParts, selected: String?, pick: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Color").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(SidekickParts.skins.map(\.name), id: \.self) { skin in
                        Button { pick(skin) } label: {
                            tile(selected: selected == skin) { SidekickArt(parts: SidekickParts.make(current.isDrawable ? current.shape : "bot", skin: skin)) }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Color \(SidekickParts.skinLabel(skin))")
                        .accessibilityAddTraits(selected == skin ? .isSelected : [])
                        .accessibilityIdentifier("character.skin.\(skin)")
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollClipDisabled()
        }
    }

    private func swatches(_ title: String, _ options: [(String, String)], selected: String?, pick: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(options, id: \.0) { name, hex in
                        Button { pick(name) } label: {
                            Circle().fill(Color(hex: hex))
                                .frame(width: 32, height: 32)
                                .padding(3)
                                .overlay { Circle().strokeBorder(selected == name ? Color.dexAccent : .clear, lineWidth: 2.5) }
                                .contentShape(.circle)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(title) \(name)")
                        .accessibilityAddTraits(selected == name ? .isSelected : [])
                        .accessibilityIdentifier("character.accent.\(name)")
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollClipDisabled()
        }
    }
}
