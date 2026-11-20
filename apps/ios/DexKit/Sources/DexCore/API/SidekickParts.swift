import CoreGraphics
import Foundation
import ImageIO

/// A sidekick's look (apps/web/src/shared/sidekick-look.ts): an Open Bot Avatar (github.com/DominikScholz/open-bot-avatar),
/// a little object with two dark eyes (a robot, a cloud, a mug…) in a color (`skin`): one of Dex's shapes (`shape`), or
/// `custom`, one a chat drew (`custom`, kept as the server sent it). The agent draws its picture (`image`); the app draws
/// Dex's own shapes from the layers bundled with `SidekickShapes` (`SidekickArt`), the same pixels.
///
/// The other parts (body, eyes, mouth, extra, blush, finish) are from before; they're still written so apps released
/// before Open Bot Avatar read looks (a finish has them show the picture), but nothing draws them any more.
public struct SidekickParts: Sendable, Hashable {
    /// One of `SidekickShapes.all`, or "custom".
    public var shape: String
    /// The shape when `shape` is "custom": its name, outline, and eyes, as the server sent them.
    public var custom: JSONValue?
    /// The face's color.
    public var skin: String
    public var body: String
    public var eyes: String
    public var mouth: String
    public var extra: String
    public var blush: Bool
    /// Always `legacyFinish` now.
    public var finish: Int?

    public init(shape: String = "bot", custom: JSONValue? = nil, skin: String = "peach", body: String = "bot", eyes: String = "round", mouth: String = "smile",
                extra: String = "none", blush: Bool = false, finish: Int? = SidekickParts.legacyFinish) {
        self.shape = shape; self.custom = custom; self.skin = skin; self.body = body; self.eyes = eyes; self.mouth = mouth; self.extra = extra
        self.blush = blush; self.finish = finish
    }

    /// A BoopFace finish number: apps from before Open Bot Avatar show a look's picture when it has one.
    public static let legacyFinish = 101

    /// The older apps' body nearest a shape.
    private static let bodyOf = ["bot": "bot", "blob": "blob", "ghost": "ghost", "cat": "cat", "bean": "bean", "cube": "cube"]

    /// Face colors (SKINS), in the web's order: light enough for the dark eyes.
    public static let skins: [(name: String, hex: String)] = [
        ("peach", "#ff6a1a"), ("lemon", "#facc15"), ("mint", "#34d399"), ("teal", "#2dd4bf"), ("sky", "#38bdf8"),
        ("lilac", "#a78bfa"), ("pink", "#f472b6"), ("coral", "#fb7185"), ("cloud", "#d4d4d8"), ("slate", "#94a3b8")
    ]
    /// The eyes' ink.
    public static let ink = "#151515"
    /// The agent colors' swatches (the first of each web pair): a sidekick's accent.
    public static let backgrounds: [(name: String, hex: String)] = [
        ("emerald", "#064e3b"), ("sky", "#0c4a6e"), ("violet", "#3b0764"), ("amber", "#78350f"),
        ("rose", "#881337"), ("orange", "#7c2d12"), ("teal", "#134e4a"), ("zinc", "#27272a")
    ]

    public static func skinHex(_ name: String) -> String { skins.first { $0.name == name }?.hex ?? skins[0].hex }
    public static func skinLabel(_ name: String) -> String { name.capitalized }
    public static func backgroundHex(_ name: String) -> String { backgrounds.first { $0.name == name }?.hex ?? "#3b0764" }

    /// A look of `shape` in `skin`, with the older apps' parts filled in (`makeLook`). "custom" needs `custom`.
    public static func make(_ shape: String, skin: String, custom: JSONValue? = nil) -> SidekickParts {
        let drawn = shape == "custom" && custom != nil
        let key = shape == "custom" && custom == nil ? "bot" : shape
        return SidekickParts(shape: key, custom: drawn ? custom : nil, skin: skin, body: drawn ? "blob" : bodyOf[key] ?? "blob")
    }

    /// A look from anything, as `cleanLook`: a color it doesn't know is the first, and a look without a shape it knows
    /// (from an older agent, or a newer one's new shape) takes the one nearest its body. Nil if it isn't a look at all.
    public init?(_ json: JSONValue?) {
        guard let object = json?.object else { return nil }
        let skin = object["skin"]?.string.flatMap { name in Self.skins.contains { $0.name == name } ? name : nil } ?? Self.skins[0].name
        let shape = object["shape"]?.string ?? ""
        if shape == "custom" {
            let custom = object["custom"].flatMap { $0.object?["path"]?.string?.isEmpty == false ? $0 : nil }
            self = Self.make("custom", skin: skin, custom: custom)
        } else if SidekickShapes.shape(shape) != nil {
            self = Self.make(shape, skin: skin)
        } else {
            let body = object["body"]?.string ?? ""
            self = Self.make(Self.bodyOf[body] ?? "bot", skin: skin)
        }
    }

    /// Whether the app draws this look itself: one of Dex's shapes it has (a shape a chat drew is the agent's picture).
    public var isDrawable: Bool { shape != "custom" && SidekickShapes.shape(shape) != nil }

    /// The shape's name.
    public var shapeName: String {
        shape == "custom" ? custom?["name"]?.string ?? "Custom" : SidekickShapes.shape(shape)?.name ?? shape.capitalized
    }

    /// As `saveCharacter` takes it: every part, the finish always (older apps show the picture of a look with one).
    public var json: JSONValue {
        ["shape": .string(shape), "custom": custom ?? .null, "skin": .string(skin), "body": .string(body), "eyes": .string(eyes), "mouth": .string(mouth),
         "extra": .string(extra), "blush": .bool(blush), "finish": finish.map { .number(Double($0)) } ?? .null]
    }

    /// The web's `randomLook`: any of Dex's shapes in any color.
    public static func random<G: RandomNumberGenerator>(using generator: inout G) -> SidekickParts {
        make(SidekickShapes.all.randomElement(using: &generator)?.key ?? "bot", skin: skins.randomElement(using: &generator)!.name)
    }

    public static func random() -> SidekickParts {
        var generator = SystemRandomNumberGenerator()
        return random(using: &generator)
    }
}

/// One of Dex's shapes (SHAPES), bundled from assets/sidekicks: its key (stored in looks), its name, and where its eyes
/// are, as fractions of its picture's height (they close toward their middle to blink).
public struct SidekickShape: Sendable, Hashable, Identifiable {
    public let key: String
    public let name: String
    public let eyesTop: Double
    public let eyesBottom: Double
    public var id: String { key }
}

public enum SidekickShapes {
    /// Dex's shapes, in the picker's order (Sidekicks/shapes.json, drawn by the agent's renderer).
    public static let all: [SidekickShape] = {
        guard let url = Bundle.module.url(forResource: "shapes", withExtension: "json", subdirectory: "Sidekicks"),
              let data = try? Data(contentsOf: url), let shapes = try? JSONValue.parse(String(decoding: data, as: UTF8.self))["shapes"]?.array else { return [] }
        return shapes.compactMap { shape in
            guard let key = shape["key"]?.string else { return nil }
            return SidekickShape(key: key, name: shape["name"]?.string ?? key.capitalized,
                                 eyesTop: shape["eyes"]?["top"]?.number ?? 0.4, eyesBottom: shape["eyes"]?["bottom"]?.number ?? 0.6)
        }
    }()

    public static func shape(_ key: String) -> SidekickShape? { all.first { $0.key == key } }

    /// A shape's `part` ("body", in white, or "eyes") as a 256-pixel PNG; nil for one this build doesn't have.
    public static func layer(_ key: String, _ part: String) -> Data? {
        Bundle.module.url(forResource: "\(key)-\(part)", withExtension: "png", subdirectory: "Sidekicks/shapes").flatMap { try? Data(contentsOf: $0) }
    }
}

/// What a sidekick's picture is, for what gets only the picture (the widgets, notifications): a look's PNG is a face on
/// a clear background, shown whole; a photo (a JPEG) is opaque, cropped round.
public enum SidekickPicture {
    /// Whether the top left corner is clear, which a look leaves it and a photo can't.
    public static func isFace(_ image: CGImage) -> Bool {
        guard ![.none, .noneSkipFirst, .noneSkipLast].contains(image.alphaInfo) else { return false }
        var pixel: [UInt8] = [0, 0, 0, 0]
        guard let context = CGContext(data: &pixel, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        // Drawn so its top left pixel lands on the one-pixel context (Core Graphics counts from the bottom).
        context.draw(image, in: CGRect(x: 0, y: 1 - CGFloat(image.height), width: CGFloat(image.width), height: CGFloat(image.height)))
        return pixel[3] < 16
    }

    public static func isFace(_ data: Data) -> Bool {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return false }
        return isFace(image)
    }
}
