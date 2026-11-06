import DexCore
import SwiftUI

/// A sidekick's look drawn natively: a flat BoopFace in the look's color, framed as the web's PNG of it (`lookPng` in
/// apps/web/src/client/components/boop-face.tsx) on a clear background. A finish (`parts.finish`) only the web draws;
/// this is the plain color.
struct SidekickArt: View {
    let parts: SidekickParts

    var body: some View {
        Canvas { context, size in
            Self.draw(parts, in: &context, size: size)
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }

    /// The PNG the look is saved with (what the apps and widgets show), as a data: URL.
    @MainActor
    static func png(_ parts: SidekickParts, size: CGFloat = 256) -> String? {
        let renderer = ImageRenderer(content: SidekickArt(parts: parts).frame(width: size, height: size))
        renderer.scale = 1
        renderer.isOpaque = false
        guard let data = renderer.uiImage?.pngData() else { return nil }
        return "data:image/png;base64," + data.base64EncodedString()
    }

    private static let head = path(BoopFace.headPath)
        .applying(CGAffineTransform(scaleX: BoopFace.headScale, y: BoopFace.headScale)
            .concatenating(CGAffineTransform(translationX: BoopFace.headOffset, y: BoopFace.headOffset)))

    static func draw(_ parts: SidekickParts, in context: inout GraphicsContext, size: CGSize) {
        // The view box, fitted and centered (as an SVG's xMidYMid meet).
        let box = BoopFace.viewBox
        let scale = min(size.width / box.width, size.height / box.height)
        context.translateBy(x: (size.width - box.width * scale) / 2, y: (size.height - box.height * scale) / 2)
        context.scaleBy(x: scale, y: scale)
        context.translateBy(x: -box.x, y: -box.y)

        let color = Color(hex: SidekickParts.skinHex(parts.skin))
        let antenna = BoopFace.antenna
        context.fill(Path(ellipseIn: CGRect(x: antenna.x - antenna.r, y: antenna.y - antenna.r, width: antenna.r * 2, height: antenna.r * 2)), with: .color(color))
        context.fill(head, with: .color(color))
        var face = context
        face.clip(to: head)
        let radius = BoopFace.eyeRadius
        for eye in BoopFace.eyes {
            face.fill(Path(ellipseIn: CGRect(x: eye.x - radius.x, y: eye.y - radius.y, width: radius.x * 2, height: radius.y * 2)), with: .color(.white))
        }
    }

    private static func path(_ data: String) -> Path {
        var path = Path()
        for step in SVGPathData.parse(data) {
            switch step {
            case .move(let x, let y): path.move(to: CGPoint(x: x, y: y))
            case .line(let x, let y): path.addLine(to: CGPoint(x: x, y: y))
            case .curve(let x1, let y1, let x2, let y2, let x, let y):
                path.addCurve(to: CGPoint(x: x, y: y), control1: CGPoint(x: x1, y: y1), control2: CGPoint(x: x2, y: y2))
            case .quad(let x1, let y1, let x, let y): path.addQuadCurve(to: CGPoint(x: x, y: y), control: CGPoint(x: x1, y: y1))
            case .close: path.closeSubpath()
            }
        }
        return path
    }
}

extension Color {
    /// "#rrggbb".
    init(hex: String) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }
}

/// A look of your own (the web's look picker, without finishes, which only the web draws): Shuffle, the face's color
/// (each drawn as the face you'd get), and their accent color.
struct LookMixer: View {
    /// The look being worn, if it's one (a photo or an emoji has none).
    let parts: SidekickParts?
    /// The look is a ready-made one (its color isn't a pick of yours, so none is marked).
    let isPreset: Bool
    let color: String
    /// A ready-made look picked (Shuffle).
    let preset: (SidekickLook) -> Void
    /// A face color picked: the new look (plain color, no finish) and the accent.
    let change: (SidekickParts, String) -> Void
    /// Only the accent changed: a photo stays a photo, a finish stays as it is.
    let accent: (String) -> Void

    var body: some View {
        // Keep what isn't drawn any more (the old parts), so a color pick changes only the color.
        let current = parts ?? SidekickLook.all.first.flatMap { SidekickParts($0.look) } ?? SidekickParts()
        let picked = parts != nil && !isPreset && parts?.finish == nil ? parts?.skin : nil
        VStack(alignment: .leading, spacing: 14) {
            Button {
                shuffle(from: current)
            } label: {
                Label("Shuffle", systemImage: "dice")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("character.shuffle")
            faces(selected: picked) { skin in
                var next = current
                next.skin = skin
                next.finish = nil
                change(next, color)
            }
            swatches("Accent", SidekickParts.backgrounds.map { ($0.name, $0.hex) }, selected: color, pick: accent)
        }
        .padding(.vertical, 6)
        .sensoryFeedback(.selection, trigger: parts)
        .sensoryFeedback(.selection, trigger: color)
    }

    /// As the web's Shuffle, with the finishes it can't draw swapped for the ready-made looks (which have them):
    /// often one of those, else any color on any accent.
    private func shuffle(from current: SidekickParts) {
        if Bool.random(), let look = SidekickLook.all.randomElement() {
            preset(look)
        } else {
            var next = SidekickParts.random()
            next.finish = nil
            change(next, AgentColors.all.randomElement() ?? color)
        }
    }

    private func faces(selected: String?, pick: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Color").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(SidekickParts.skins.map(\.name), id: \.self) { skin in
                        let isSelected = selected == skin
                        Button { pick(skin) } label: {
                            SidekickArt(parts: SidekickParts(skin: skin))
                                .frame(width: 40, height: 40)
                                .padding(4)
                                .overlay {
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .strokeBorder(isSelected ? Color.dexAccent : .clear, lineWidth: 2.5)
                                }
                                .contentShape(.rect(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Color \(SidekickParts.skinLabel(skin))")
                        .accessibilityAddTraits(isSelected ? .isSelected : [])
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
