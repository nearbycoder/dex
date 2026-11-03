import DexCore
import SwiftUI

/// A sidekick's look drawn natively, the same picture as the web's `sidekickSvg` (apps/web/src/shared/sidekick-look.ts):
/// a disc of their background color with the character on it, on a 100×100 canvas scaled to fit.
struct SidekickArt: View {
    let parts: SidekickParts
    /// An agent color's name ("violet").
    let background: String

    var body: some View {
        Canvas { context, size in
            Self.draw(parts, background: background, in: &context, size: size)
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }

    /// The PNG the look is saved with (what the apps and widgets show), as a data: URL.
    @MainActor
    static func png(_ parts: SidekickParts, background: String, size: CGFloat = 256) -> String? {
        let renderer = ImageRenderer(content: SidekickArt(parts: parts, background: background).frame(width: size, height: size))
        renderer.scale = 1
        renderer.isOpaque = false
        guard let data = renderer.uiImage?.pngData() else { return nil }
        return "data:image/png;base64," + data.base64EncodedString()
    }

    private static let ink = Color(hex: "#1e1b2e")

    static func draw(_ parts: SidekickParts, background: String, in context: inout GraphicsContext, size: CGSize) {
        let side = min(size.width, size.height)
        context.translateBy(x: (size.width - side) / 2, y: (size.height - side) / 2)
        context.scaleBy(x: side / 100, y: side / 100)
        context.clip(to: Path(ellipseIn: CGRect(x: 0, y: 0, width: 100, height: 100)))
        context.fill(Path(CGRect(x: 0, y: 0, width: 100, height: 100)), with: .color(Color(hex: SidekickParts.backgroundHex(background))))
        context.fill(ellipse(50, 91, 25, 4), with: .color(.black.opacity(0.22)))

        // A little bigger than drawn, so faces read small.
        var face = context
        face.concatenate(CGAffineTransform(translationX: 50, y: 58).scaledBy(x: 1.08, y: 1.08).translatedBy(x: -50, y: -58))
        let skin = Color(hex: SidekickParts.skinHex(parts.skin))
        let shape = SidekickParts.shape(parts.body)
        let outline = path(shape.path)
        if parts.extra != "headphones" { bot(parts, skin: skin, in: &face) }
        if let ears = shape.extra { face.fill(path(ears), with: .color(skin)) }
        face.fill(outline, with: .color(skin))
        // A soft shade along the bottom and a shine at the top left give the flat shape some roundness.
        face.fill(outline.applying(CGAffineTransform(translationX: 0, y: 6).scaledBy(x: 1, y: 0.94)), with: .color(.black.opacity(0.1)))
        face.fill(outline.applying(CGAffineTransform(translationX: 0, y: -1.5)), with: .color(skin))
        let shine = CGAffineTransform(translationX: 36, y: shape.top + 11).rotated(by: -24 * .pi / 180).translatedBy(x: -36, y: -(shape.top + 11))
        face.fill(ellipse(36, shape.top + 11, 8, 4.5).applying(shine), with: .color(.white.opacity(0.35)))
        if parts.blush {
            face.fill(ellipse(31, 62, 5, 3), with: .color(Color(hex: "#fb7185").opacity(0.5)))
            face.fill(ellipse(69, 62, 5, 3), with: .color(Color(hex: "#fb7185").opacity(0.5)))
        }
        eyes(parts.eyes, skin: skin, in: &face)
        mouth(parts.mouth, in: &face)
        if parts.extra == "headphones" { bot(parts, skin: skin, in: &face) }
        extra(parts.extra, top: shape.top, in: &face)
    }

    // MARK: Parts

    private static func bot(_ parts: SidekickParts, skin: Color, in context: inout GraphicsContext) {
        guard parts.body == "bot" else { return }
        context.stroke(path("M50 31V19"), with: .color(ink), style: line(3))
        context.fill(circle(50, 16, 4.5), with: .color(Color(hex: "#f43f5e")))
        context.fill(rect(15, 50, 7, 12, 3), with: .color(skin))
        context.fill(rect(78, 50, 7, 12, 3), with: .color(skin))
    }

    private static func eyes(_ eyes: String, skin: Color, in context: inout GraphicsContext) {
        func dot(_ x: Double, _ r: Double = 4.2) {
            context.fill(circle(x, 52, r), with: .color(ink))
            context.fill(circle(x + r * 0.35, 52 - r * 0.35, r * 0.33), with: .color(.white))
        }
        func arc(_ x: Double, up: Bool) {
            context.stroke(path("M\(x - 5) \(up ? 54 : 51)Q\(x) \(up ? 47 : 56) \(x + 5) \(up ? 54 : 51)"), with: .color(ink), style: line(3))
        }
        switch eyes {
        case "round":
            for x in [40.0, 60.0] {
                context.fill(ellipse(x, 52, 6.3, 6.8), with: .color(.white))
                context.fill(circle(x + 0.8, 53, 3.6), with: .color(ink))
                context.fill(circle(x + 2, 51.6, 1.2), with: .color(.white))
            }
        case "sparkle":
            for x in [40.0, 60.0] {
                context.fill(ellipse(x, 52, 5, 6), with: .color(ink))
                context.fill(circle(x + 1.6, 49.6, 1.9), with: .color(.white))
                context.fill(circle(x - 1.6, 55, 0.9), with: .color(.white))
            }
        case "happy": arc(40, up: true); arc(60, up: true)
        case "sleepy": arc(40, up: false); arc(60, up: false)
        case "wink": dot(40); arc(60, up: true)
        case "visor":
            context.fill(rect(29, 44.5, 42, 15, 7.5), with: .color(ink))
            context.fill(rect(35, 49.5, 8, 5, 2.5), with: .color(skin))
            context.fill(rect(57, 49.5, 8, 5, 2.5), with: .color(skin))
        default: dot(40); dot(60)
        }
    }

    private static func mouth(_ mouth: String, in context: inout GraphicsContext) {
        let pink = Color(hex: "#fb7185")
        switch mouth {
        case "grin":
            context.fill(path("M42.5 63.5H57.5Q57 72 50 72Q43 72 42.5 63.5Z"), with: .color(ink))
            context.fill(path("M45.5 69.6Q50 66.5 54.5 69.6Q52.6 71.8 50 71.8Q47.4 71.8 45.5 69.6Z"), with: .color(pink))
        case "tongue":
            context.fill(path("M47 66.5Q50 74 53 66.5Z"), with: .color(pink))
            context.stroke(path("M43.5 65Q50 70 56.5 65"), with: .color(ink), style: line(3))
        case "purr": context.stroke(path("M43 65Q46.5 69 50 65Q53.5 69 57 65"), with: .color(ink), style: line(3))
        case "o": context.fill(ellipse(50, 67, 3.2, 3.8), with: .color(ink))
        case "flat": context.stroke(path("M45 67H55"), with: .color(ink), style: line(3))
        default: context.stroke(path("M44 65Q50 70.5 56 65"), with: .color(ink), style: line(3))
        }
    }

    /// Headwear and face things; hats are drawn for a head starting at 24 and moved to where this one starts.
    private static func extra(_ extra: String, top: Double, in context: inout GraphicsContext) {
        var hat = context
        hat.translateBy(x: 0, y: top - 24)
        switch extra {
        case "headphones":
            context.stroke(path("M20 54C20 30 33 \(top - 4) 50 \(top - 4)C67 \(top - 4) 80 30 80 54"), with: .color(ink), style: line(4.5))
            context.fill(rect(13, 46, 11, 19, 5), with: .color(Color(hex: "#f43f5e")))
            context.fill(rect(76, 46, 11, 19, 5), with: .color(Color(hex: "#f43f5e")))
        case "glasses":
            for x in [40.0, 60.0] {
                context.fill(circle(x, 52, 8.6), with: .color(.white.opacity(0.18)))
                context.stroke(circle(x, 52, 8.6), with: .color(ink), lineWidth: 2.6)
            }
            context.stroke(path("M48.6 51Q50 49.6 51.4 51"), with: .color(ink), lineWidth: 2.6)
        case "beanie":
            hat.fill(path("M25 34C25 16 75 16 75 34Z"), with: .color(Color(hex: "#ef4444")))
            hat.fill(rect(23, 30, 54, 9, 4.5), with: .color(Color(hex: "#b91c1c")))
            hat.fill(circle(50, 13, 5.5), with: .color(Color(hex: "#fef2f2")))
        case "beret":
            hat.fill(path("M24 31C25 18 58 11 76 23C72 30 44 34 24 31Z"), with: .color(ink))
            hat.stroke(path("M56 15L58 9"), with: .color(ink), style: line(3))
        case "crown":
            let crown = path("M32 27L34 9L43 19L50 6L57 19L66 9L68 27Z")
            hat.fill(crown, with: .color(Color(hex: "#fbbf24")))
            hat.stroke(crown, with: .color(Color(hex: "#b45309")), style: StrokeStyle(lineWidth: 2, lineJoin: .round))
            hat.fill(circle(50, 20, 2.4), with: .color(Color(hex: "#ef4444")))
        case "sprout":
            hat.stroke(path("M50 25V12"), with: .color(Color(hex: "#16a34a")), style: line(3))
            hat.fill(path("M50 15C44 15 39 11 39 6C45 6 50 9 50 15Z"), with: .color(Color(hex: "#22c55e")))
            hat.fill(path("M50 13C55 13 61 9 61 4C55 4 50 7 50 13Z"), with: .color(Color(hex: "#4ade80")))
        case "bow":
            hat.fill(path("M64 24L56 17V31Z"), with: .color(Color(hex: "#ec4899")))
            hat.fill(path("M64 24L72 17V31Z"), with: .color(Color(hex: "#ec4899")))
            hat.fill(circle(64, 24, 3), with: .color(Color(hex: "#be185d")))
        case "wizard":
            hat.fill(path("M27 30L55 0L72 30Z"), with: .color(Color(hex: "#6d28d9")))
            hat.fill(rect(22, 27, 56, 7, 3.5), with: .color(Color(hex: "#4c1d95")))
            hat.fill(path("M54 12L55.4 15.4L59 15.6L56.2 17.8L57.2 21.2L54 19.2L50.8 21.2L51.8 17.8L49 15.6L52.6 15.4Z"), with: .color(Color(hex: "#fde68a")))
        case "headband":
            hat.fill(rect(21, 35, 58, 8, 2), with: .color(Color(hex: "#ef4444")))
            hat.fill(path("M79 38L88 33L86 41Z M79 40L87 45L80 46Z"), with: .color(Color(hex: "#dc2626")))
        default: break
        }
    }

    // MARK: Shapes

    private static func line(_ width: Double) -> StrokeStyle { StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round) }
    private static func circle(_ x: Double, _ y: Double, _ r: Double) -> Path { Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)) }
    private static func ellipse(_ x: Double, _ y: Double, _ rx: Double, _ ry: Double) -> Path { Path(ellipseIn: CGRect(x: x - rx, y: y - ry, width: rx * 2, height: ry * 2)) }
    private static func rect(_ x: Double, _ y: Double, _ width: Double, _ height: Double, _ radius: Double) -> Path {
        Path(roundedRect: CGRect(x: x, y: y, width: width, height: height), cornerRadius: radius, style: .circular)
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

/// Mix a look of your own (the web's look picker): Shuffle, then each part drawn on the current look so you see what
/// you'd get, the body color, and the background.
struct LookMixer: View {
    /// The look being worn: a ready-made one's or your own (a photo or an emoji starts from the first ready-made look).
    let parts: SidekickParts?
    let color: String
    /// A new look and background; no look (a photo kept) when only the background changed.
    let change: (SidekickParts?, String) -> Void

    var body: some View {
        let current = parts ?? SidekickLook.all.first.flatMap { SidekickParts($0.look) } ?? SidekickParts()
        VStack(alignment: .leading, spacing: 14) {
            Button {
                change(.random(), AgentColors.all.randomElement() ?? color)
            } label: {
                Label("Shuffle", systemImage: "dice")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("character.shuffle")
            row("Body", SidekickParts.bodies) { var next = current; next.body = $0; return next }
            row("Eyes", SidekickParts.eyeStyles) { var next = current; next.eyes = $0; return next }
            row("Mouth", SidekickParts.mouths) { var next = current; next.mouth = $0; return next }
            row("Extra", SidekickParts.extras) { var next = current; next.extra = $0; return next }
            swatches("Body Color", SidekickParts.skins.map { ($0.name, $0.hex) }, selected: parts == nil ? nil : current.skin) { skin in
                var next = current
                next.skin = skin
                change(next, color)
            }
            // Only the background: a photo stays a photo.
            swatches("Background", SidekickParts.backgrounds.map { ($0.name, $0.hex) }, selected: color) { change(parts, $0) }
            Toggle("Rosy Cheeks", isOn: Binding(get: { current.blush }, set: { var next = current; next.blush = $0; change(next, color) }))
                .accessibilityIdentifier("character.blush")
        }
        .padding(.vertical, 6)
        .sensoryFeedback(.selection, trigger: parts)
    }

    private func row(_ title: String, _ options: [String], _ apply: @escaping (String) -> SidekickParts) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(options, id: \.self) { option in
                        let preview = apply(option)
                        let selected = parts != nil && preview == parts
                        Button { change(preview, color) } label: {
                            SidekickArt(parts: preview, background: color)
                                .frame(width: 46, height: 46)
                                .padding(2)
                                .overlay { Circle().strokeBorder(selected ? Color.dexAccent : Color.secondary.opacity(0.25), lineWidth: selected ? 2.5 : 1) }
                                .contentShape(.circle)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(title): \(SidekickParts.label(option))")
                        .accessibilityAddTraits(selected ? .isSelected : [])
                        .accessibilityIdentifier("character.part.\(option)")
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
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollClipDisabled()
        }
    }
}
