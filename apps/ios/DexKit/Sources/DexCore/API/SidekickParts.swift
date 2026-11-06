import CoreGraphics
import Foundation
import ImageIO

/// A sidekick's look (apps/web/src/shared/sidekick-look.ts): a BoopFace, the robot head with two big eyes, in a color
/// (`skin`) or one of BoopFace's finishes (`finish`, its skin number). The app draws the plain color (`SidekickArt`) and
/// saves its PNG with it; a finish only the web can draw, so its PNG comes from there (or from the ready-made looks).
///
/// The other parts (body, eyes, mouth, extra, blush) are from before BoopFace; they're kept so the look stays what the
/// server and older apps read, but nothing draws them any more.
public struct SidekickParts: Sendable, Hashable {
    public var body: String
    /// The face's color, shown when there's no finish.
    public var skin: String
    public var eyes: String
    public var mouth: String
    public var extra: String
    public var blush: Bool
    /// A BoopFace skin number (605), or nil for the plain color.
    public var finish: Int?

    public init(body: String = "blob", skin: String = "mint", eyes: String = "dot", mouth: String = "smile", extra: String = "none", blush: Bool = false,
                finish: Int? = nil) {
        self.body = body; self.skin = skin; self.eyes = eyes; self.mouth = mouth; self.extra = extra; self.blush = blush; self.finish = finish
    }

    public static let bodies = ["blob", "bean", "cube", "ghost", "cat", "bot"]
    public static let eyeStyles = ["dot", "round", "sparkle", "happy", "sleepy", "wink", "visor"]
    public static let mouths = ["smile", "grin", "tongue", "purr", "o", "flat"]
    public static let extras = ["none", "headphones", "glasses", "beanie", "beret", "crown", "sprout", "bow", "wizard", "headband"]
    /// Face colors (SKINS), in the web's order: deep enough for the white eyes.
    public static let skins: [(name: String, hex: String)] = [
        ("mint", "#10b981"), ("sky", "#0ea5e9"), ("lilac", "#8b5cf6"), ("pink", "#ec4899"), ("peach", "#f97316"),
        ("lemon", "#eab308"), ("coral", "#ef4444"), ("teal", "#14b8a6"), ("cloud", "#71717a"), ("slate", "#3f3f46")
    ]
    /// The agent colors' swatches (the first of each web pair): a sidekick's accent.
    public static let backgrounds: [(name: String, hex: String)] = [
        ("emerald", "#064e3b"), ("sky", "#0c4a6e"), ("violet", "#3b0764"), ("amber", "#78350f"),
        ("rose", "#881337"), ("orange", "#7c2d12"), ("teal", "#134e4a"), ("zinc", "#27272a")
    ]

    public static let labels: [String: String] = [
        "blob": "Blob", "bean": "Bean", "cube": "Cube", "ghost": "Ghost", "cat": "Cat", "bot": "Bot",
        "dot": "Dots", "round": "Round", "sparkle": "Sparkle", "happy": "Happy", "sleepy": "Calm", "wink": "Wink", "visor": "Visor",
        "smile": "Smile", "grin": "Grin", "tongue": "Silly", "purr": "Purr", "o": "Ooh", "flat": "Deadpan",
        "none": "None", "headphones": "Headphones", "glasses": "Glasses", "beanie": "Beanie", "beret": "Beret", "crown": "Crown",
        "sprout": "Sprout", "bow": "Bow", "wizard": "Wizard hat", "headband": "Headband"
    ]

    public static func label(_ part: String) -> String { labels[part] ?? part.capitalized }
    public static func skinHex(_ name: String) -> String { skins.first { $0.name == name }?.hex ?? skins[0].hex }
    public static func skinLabel(_ name: String) -> String { name.capitalized }
    public static func backgroundHex(_ name: String) -> String { backgrounds.first { $0.name == name }?.hex ?? "#3b0764" }

    /// A look from anything: unknown parts fall back (as `cleanLook` does); nil if it isn't a look at all. A finish
    /// that isn't shaped like BoopFace's (series 1–17, then 01–30) is the plain color.
    public init?(_ json: JSONValue?) {
        guard let object = json?.object else { return nil }
        func pick(_ options: [String], _ key: String) -> String {
            object[key]?.string.flatMap { options.contains($0) ? $0 : nil } ?? options[0]
        }
        self.init(body: pick(Self.bodies, "body"), skin: pick(Self.skins.map(\.name), "skin"), eyes: pick(Self.eyeStyles, "eyes"),
                  mouth: pick(Self.mouths, "mouth"), extra: pick(Self.extras, "extra"), blush: object["blush"]?.bool == true,
                  finish: object["finish"]?.number.flatMap(Self.cleanFinish))
    }

    private static func cleanFinish(_ value: Double) -> Int? {
        guard value == value.rounded(), value >= 101, value <= 1799 else { return nil }
        let number = Int(value)
        return (1...30).contains(number % 100) ? number : nil
    }

    /// As `saveCharacter` takes it. `finish` always goes, null for the plain color: left out, the server would keep
    /// the finish it has.
    public var json: JSONValue {
        ["body": .string(body), "skin": .string(skin), "eyes": .string(eyes), "mouth": .string(mouth), "extra": .string(extra), "blush": .bool(blush),
         "finish": finish.map { .number(Double($0)) } ?? .null]
    }

    /// The web's `randomLook` without a finish (which only the web draws): any color, and parts as the web picks them.
    public static func random<G: RandomNumberGenerator>(using generator: inout G) -> SidekickParts {
        func any(_ options: [String]) -> String { options.randomElement(using: &generator)! }
        let body = any(bodies)
        return SidekickParts(
            body: body,
            skin: any(skins.map(\.name)),
            eyes: body == "bot" && Double.random(in: 0..<1, using: &generator) < 0.5 ? "visor" : any(eyeStyles.filter { $0 != "visor" }),
            mouth: any(mouths),
            extra: Double.random(in: 0..<1, using: &generator) < 0.25 ? "none" : any(extras.filter { $0 != "none" }),
            blush: Double.random(in: 0..<1, using: &generator) < 0.6
        )
    }

    public static func random() -> SidekickParts {
        var generator = SystemRandomNumberGenerator()
        return random(using: &generator)
    }
}

/// BoopFace's shape (github.com/CX-ArtLab/BoopFace, `_renderShell` in boopface-core.js) on its 240-unit box, as the
/// web's PNG of a look frames it: the head, two white eyes clipped to it, and the antenna dot above, in the head's color.
public enum BoopFace {
    /// The head (`headShape`), drawn moved by `headOffset` and scaled by `headScale`.
    public static let headPath = "M 120.00 20.00 L 132.80 20.05 L 139.87 20.20 L 145.68 20.44 L 150.79 20.78 L 155.43 21.22 L 159.71 21.76 L 163.69 22.40 L 167.44 23.14 L 170.99 23.97 L 174.34 24.90 L 177.53 25.93 L 180.57 27.07 L 183.46 28.30 L 186.22 29.63 L 188.85 31.06 L 191.36 32.59 L 193.75 34.22 L 196.03 35.96 L 198.19 37.80 L 200.25 39.75 L 202.20 41.81 L 204.04 43.97 L 205.78 46.25 L 207.41 48.64 L 208.94 51.15 L 210.37 53.78 L 211.70 56.54 L 212.93 59.43 L 214.07 62.47 L 215.10 65.66 L 216.03 69.01 L 216.86 72.56 L 217.60 76.31 L 218.24 80.29 L 218.78 84.57 L 219.22 89.21 L 219.56 94.32 L 219.80 100.13 L 219.95 107.20 L 220.00 120.00 L 219.95 132.80 L 219.80 139.87 L 219.56 145.68 L 219.22 150.79 L 218.78 155.43 L 218.24 159.71 L 217.60 163.69 L 216.86 167.44 L 216.03 170.99 L 215.10 174.34 L 214.07 177.53 L 212.93 180.57 L 211.70 183.46 L 210.37 186.22 L 208.94 188.85 L 207.41 191.36 L 205.78 193.75 L 204.04 196.03 L 202.20 198.19 L 200.25 200.25 L 198.19 202.20 L 196.03 204.04 L 193.75 205.78 L 191.36 207.41 L 188.85 208.94 L 186.22 210.37 L 183.46 211.70 L 180.57 212.93 L 177.53 214.07 L 174.34 215.10 L 170.99 216.03 L 167.44 216.86 L 163.69 217.60 L 159.71 218.24 L 155.43 218.78 L 150.79 219.22 L 145.68 219.56 L 139.87 219.80 L 132.80 219.95 L 120.00 220.00 L 107.20 219.95 L 100.13 219.80 L 94.32 219.56 L 89.21 219.22 L 84.57 218.78 L 80.29 218.24 L 76.31 217.60 L 72.56 216.86 L 69.01 216.03 L 65.66 215.10 L 62.47 214.07 L 59.43 212.93 L 56.54 211.70 L 53.78 210.37 L 51.15 208.94 L 48.64 207.41 L 46.25 205.78 L 43.97 204.04 L 41.81 202.20 L 39.75 200.25 L 37.80 198.19 L 35.96 196.03 L 34.22 193.75 L 32.59 191.36 L 31.06 188.85 L 29.63 186.22 L 28.30 183.46 L 27.07 180.57 L 25.93 177.53 L 24.90 174.34 L 23.97 170.99 L 23.14 167.44 L 22.40 163.69 L 21.76 159.71 L 21.22 155.43 L 20.78 150.79 L 20.44 145.68 L 20.20 139.87 L 20.05 132.80 L 20.00 120.00 L 20.05 107.20 L 20.20 100.13 L 20.44 94.32 L 20.78 89.21 L 21.22 84.57 L 21.76 80.29 L 22.40 76.31 L 23.14 72.56 L 23.97 69.01 L 24.90 65.66 L 25.93 62.47 L 27.07 59.43 L 28.30 56.54 L 29.63 53.78 L 31.06 51.15 L 32.59 48.64 L 34.22 46.25 L 35.96 43.97 L 37.80 41.81 L 39.75 39.75 L 41.81 37.80 L 43.97 35.96 L 46.25 34.22 L 48.64 32.59 L 51.15 31.06 L 53.78 29.63 L 56.54 28.30 L 59.43 27.07 L 62.47 25.93 L 65.66 24.90 L 69.01 23.97 L 72.56 23.14 L 76.31 22.40 L 80.29 21.76 L 84.57 21.22 L 89.21 20.78 L 94.32 20.44 L 100.13 20.20 L 107.20 20.05 Z"
    public static let headOffset = 7.2
    public static let headScale = 0.94
    /// The eyes' centers, and their radii at rest.
    public static let eyes: [(x: Double, y: Double)] = [(86, 126), (154, 126)]
    public static let eyeRadius = (x: 27.0, y: 29.0)
    public static let antenna = (x: 120.0, y: 12.0, r: 15.0)
    /// What the PNG shows (the web's `lookPng`): room above the head for the antenna.
    public static let viewBox = (x: 0.0, y: -8.0, width: 240.0, height: 248.0)
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

/// SVG path data with absolute M, L, H, V, C, Q, and Z (all the looks use), as drawing steps.
public enum SVGPathData {
    public enum Step: Sendable, Hashable {
        case move(Double, Double)
        case line(Double, Double)
        case curve(Double, Double, Double, Double, Double, Double)
        case quad(Double, Double, Double, Double)
        case close
    }

    public static func parse(_ data: String) -> [Step] {
        var tokens: [String] = []
        var number = ""
        func flush() { if !number.isEmpty { tokens.append(number); number = "" } }
        for character in data {
            if character.isLetter {
                flush()
                tokens.append(String(character))
            } else if character == "-" {
                flush()
                number = "-"
            } else if character == " " || character == "," {
                flush()
            } else if character == ".", number.contains(".") {
                flush()
                number = "."
            } else {
                number.append(character)
            }
        }
        flush()
        var steps: [Step] = []
        var index = 0
        var command = ""
        var x = 0.0
        var y = 0.0
        func next() -> Double {
            defer { index += 1 }
            return index < tokens.count ? Double(tokens[index]) ?? 0 : 0
        }
        while index < tokens.count {
            if tokens[index].first?.isLetter == true {
                command = tokens[index]
                index += 1
                if command == "Z" { steps.append(.close); continue }
            }
            switch command {
            case "M": x = next(); y = next(); steps.append(.move(x, y)); command = "L"
            case "L": x = next(); y = next(); steps.append(.line(x, y))
            case "H": x = next(); steps.append(.line(x, y))
            case "V": y = next(); steps.append(.line(x, y))
            case "C":
                let (x1, y1, x2, y2) = (next(), next(), next(), next())
                x = next(); y = next()
                steps.append(.curve(x1, y1, x2, y2, x, y))
            case "Q":
                let (x1, y1) = (next(), next())
                x = next(); y = next()
                steps.append(.quad(x1, y1, x, y))
            default: index += 1
            }
        }
        return steps
    }
}
