import DexCore
import SwiftUI
import UIKit

/// A sidekick's look drawn natively: one of Dex's shapes from the layers bundled with it (`SidekickShapes.layer`):
/// flat bodies tinted the look's color, or fluffy coats dyed with Open Bot Avatar's Oklch dye ramp, with the eyes over
/// them. `live` ones blink now and then, as on the web, unless Reduce Motion is on. Draws nothing for a shape it doesn't
/// have (`SidekickParts.isDrawable`).
struct SidekickArt: View {
    let parts: SidekickParts
    var live = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var blink = 0.0

    var body: some View {
        let animate = live && !reduceMotion
        Group {
            if let shape = SidekickShapes.shape(parts.shape), parts.isDrawable {
                if parts.isFluffy, let coat = Self.fluffyBody(shape.key, skin: parts.skin), let eyesLayer = Self.layer(shape.key, "fluffy-eyes") {
                    fluffyFace(shape, coat: coat, eyes: eyesLayer, blink: animate ? blink : 0)
                } else if let bodyLayer = Self.layer(shape.key, "body"), let eyesLayer = Self.layer(shape.key, "eyes") {
                    flatFace(shape, body: bodyLayer, eyes: eyesLayer, blink: animate ? blink : 0)
                } else {
                    Color.clear
                }
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

    private func flatFace(_ shape: SidekickShape, body: UIImage, eyes: UIImage, blink: Double) -> some View {
        ZStack {
            Image(uiImage: body).renderingMode(.template).resizable().interpolation(.high)
                .foregroundStyle(Self.skinColor(parts.skin))
            Image(uiImage: eyes).resizable().interpolation(.high)
                .scaleEffect(x: 1, y: 1 - blink * 0.9, anchor: UnitPoint(x: 0.5, y: (shape.eyesTop + shape.eyesBottom) / 2))
        }
    }

    private func fluffyFace(_ shape: SidekickShape, coat: UIImage, eyes: UIImage, blink: Double) -> some View {
        ZStack {
            Image(uiImage: coat).resizable().interpolation(.high)
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
    @MainActor private static var luts: [String: [UInt8]] = [:]

    /// A shape's layer, decoded once.
    @MainActor private static func layer(_ key: String, _ part: String) -> UIImage? {
        let name = "\(key)-\(part)" as NSString
        if let image = cache.object(forKey: name) { return image }
        guard let data = SidekickShapes.layer(key, part), let image = UIImage(data: data) else { return nil }
        cache.setObject(image, forKey: name)
        return image
    }

    /// 256-entry RGB lookup table interpolated from the skin's 96-entry dye ramp.
    @MainActor private static func lut(for skin: String) -> [UInt8]? {
        if let existing = luts[skin] { return existing }
        guard let ramp = SidekickShapes.ramp(skin), ramp.count == 96 * 3 else { return nil }
        var table = [UInt8](repeating: 0, count: 256 * 3)
        for index in 0..<256 {
            let pos = max(0.0, min(95.0, (Double(index) / 255.0) * 96.0 - 0.5))
            let i0 = Int(pos)
            let i1 = min(95, i0 + 1)
            let t = pos - Double(i0)
            for c in 0..<3 {
                let a = Double(ramp[i0 * 3 + c])
                let b = Double(ramp[i1 * 3 + c])
                table[index * 3 + c] = UInt8(max(0, min(255, Int((a + (b - a) * t).rounded()))))
            }
        }
        luts[skin] = table
        return table
    }

    /// A shape's fluffy coat dyed with `skin`'s ramp, cached per `(shape, skin)`.
    @MainActor static func fluffyBody(_ key: String, skin: String) -> UIImage? {
        let cacheKey = "fluffy-body:\(key):\(skin)" as NSString
        if let cached = cache.object(forKey: cacheKey) { return cached }
        guard let source = layer(key, "fluffy-body")?.cgImage, let table = lut(for: skin) else { return nil }
        let width = source.width
        let height = source.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let space = CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                      space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height))
        for offset in stride(from: 0, to: pixels.count, by: 4) {
            let a = Int(pixels[offset + 3])
            if a == 0 {
                pixels[offset] = 0; pixels[offset + 1] = 0; pixels[offset + 2] = 0
                continue
            }
            let u = a == 255 ? Int(pixels[offset]) : min(255, (Int(pixels[offset]) * 255 + a / 2) / a)
            let r = Int(table[u * 3])
            let g = Int(table[u * 3 + 1])
            let b = Int(table[u * 3 + 2])
            if a == 255 {
                pixels[offset] = UInt8(r)
                pixels[offset + 1] = UInt8(g)
                pixels[offset + 2] = UInt8(b)
            } else {
                pixels[offset] = UInt8((r * a + 127) / 255)
                pixels[offset + 1] = UInt8((g * a + 127) / 255)
                pixels[offset + 2] = UInt8((b * a + 127) / 255)
            }
        }
        guard let dyed = context.makeImage() else { return nil }
        let image = UIImage(cgImage: dyed)
        cache.setObject(image, forKey: cacheKey)
        return image
    }

    /// Renders a fluffy look as a transparent PNG data: URL small enough for `saveCharacter`, so notifications, widgets,
    /// and older apps show fur too. Nil for flat or custom shapes.
    @MainActor static func fluffyDataURL(for parts: SidekickParts) -> String? {
        guard parts.isFluffy, parts.isDrawable, let coat = fluffyBody(parts.shape, skin: parts.skin),
              let eyes = layer(parts.shape, "fluffy-eyes") else { return nil }
        let rect = CGRect(x: 0, y: 0, width: 256, height: 256)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        let png = UIGraphicsImageRenderer(bounds: rect, format: format).pngData { _ in
            coat.draw(in: rect)
            eyes.draw(in: rect)
        }
        let url = SidekickLook.fitting(png)
        return url.count <= Characters.maxImageURLLength ? url : nil
    }
}

extension Color {
    /// "#rrggbb".
    init(hex: String) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }
}

/// A look of your own (the web's look picker): Shuffle, Coat (Flat / Fluffy), Shape (each drawn in the look's color and
/// coat), Color (each drawn as the face you'd get), and Accent. A shape a chat drew shows among the shapes while it's
/// the look; its color and coat change on the web or in a chat, which can draw it.
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
    /// A shape, coat, or face color picked: the new look and the accent.
    let change: (SidekickParts, String) -> Void
    /// Only the accent changed: a photo stays a photo.
    let accent: (String) -> Void

    var body: some View {
        let current = parts ?? SidekickLook.all.first.flatMap { SidekickParts($0.look) } ?? SidekickParts()
        let mine = parts != nil && !isPreset
        VStack(alignment: .leading, spacing: 14) {
            Button {
                // Any shape in any color and coat, with any accent, as the web's Shuffle.
                change(SidekickParts.random(), AgentColors.all.randomElement() ?? color)
            } label: {
                Label("Shuffle", systemImage: "dice")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("character.shuffle")
            if current.shape != "custom" || parts == nil {
                coat(current: current, selected: parts != nil ? current.material : nil)
            }
            shapes(current: current, selected: mine ? current.shape : nil)
            if current.shape == "custom" && parts != nil {
                Text("A chat drew this shape: change its color or coat on the web, or ask a chat.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                faces(current: current, selected: mine ? current.skin : nil) { skin in
                    change(SidekickParts.make(current.shape, skin: skin, custom: current.custom, material: current.material), color)
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

    private func coat(current: SidekickParts, selected: String?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Coat").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
            HStack(spacing: 10) {
                ForEach(SidekickParts.materials, id: \.self) { material in
                    let candidate = SidekickParts.make(current.isDrawable ? current.shape : "bot", skin: current.skin, material: material)
                    let label = material == "fluffy" ? "Fluffy" : "Flat"
                    let isSelected = selected == material
                    Button {
                        change(SidekickParts.make(current.shape, skin: current.skin, custom: current.custom, material: material), color)
                    } label: {
                        HStack(spacing: 8) {
                            SidekickArt(parts: candidate).frame(width: 28, height: 28)
                            Text(label).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                        }
                        .padding(.vertical, 6)
                        .padding(.leading, 8)
                        .padding(.trailing, 12)
                        .background(isSelected ? Color.dexAccent.opacity(0.14) : Color(.tertiarySystemFill), in: .rect(cornerRadius: 12, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(isSelected ? Color.dexAccent : .clear, lineWidth: 2)
                        }
                        .contentShape(.rect(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Coat \(label)")
                    .accessibilityAddTraits(isSelected ? .isSelected : [])
                    .accessibilityIdentifier("character.material.\(material)")
                }
            }
        }
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
                        let candidate = SidekickParts.make(shape.key, skin: current.skin, material: current.material)
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
                            tile(selected: selected == skin) {
                                SidekickArt(parts: SidekickParts.make(current.isDrawable ? current.shape : "bot", skin: skin, material: current.material))
                            }
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
