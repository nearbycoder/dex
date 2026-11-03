import Foundation

/// A sidekick's own look, mixed from parts (apps/web/src/shared/sidekick-look.ts): a body, eyes, a mouth, an extra, a
/// body color, and cheeks, on their background color. The app draws it (`SidekickArt`) and saves its PNG with it.
public struct SidekickParts: Sendable, Hashable {
    public var body: String
    public var skin: String
    public var eyes: String
    public var mouth: String
    public var extra: String
    public var blush: Bool

    public init(body: String = "blob", skin: String = "mint", eyes: String = "dot", mouth: String = "smile", extra: String = "none", blush: Bool = false) {
        self.body = body; self.skin = skin; self.eyes = eyes; self.mouth = mouth; self.extra = extra; self.blush = blush
    }

    public static let bodies = ["blob", "bean", "cube", "ghost", "cat", "bot"]
    public static let eyeStyles = ["dot", "round", "sparkle", "happy", "sleepy", "wink", "visor"]
    public static let mouths = ["smile", "grin", "tongue", "purr", "o", "flat"]
    public static let extras = ["none", "headphones", "glasses", "beanie", "beret", "crown", "sprout", "bow", "wizard", "headband"]
    /// Body colors, in the web's order.
    public static let skins: [(name: String, hex: String)] = [
        ("mint", "#6ee7b7"), ("sky", "#7dd3fc"), ("lilac", "#c4b5fd"), ("pink", "#f9a8d4"), ("peach", "#fdba74"),
        ("lemon", "#fde68a"), ("coral", "#fca5a5"), ("teal", "#5eead4"), ("cloud", "#e4e4e7"), ("slate", "#94a3b8")
    ]
    /// The agent colors' backgrounds (the first of each web pair), which a look sits on.
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
    public static func backgroundHex(_ name: String) -> String { backgrounds.first { $0.name == name }?.hex ?? "#3b0764" }

    /// A look from anything: unknown parts fall back (as `cleanLook` does); nil if it isn't a look at all.
    public init?(_ json: JSONValue?) {
        guard let object = json?.object else { return nil }
        func pick(_ options: [String], _ key: String) -> String {
            object[key]?.string.flatMap { options.contains($0) ? $0 : nil } ?? options[0]
        }
        self.init(body: pick(Self.bodies, "body"), skin: pick(Self.skins.map(\.name), "skin"), eyes: pick(Self.eyeStyles, "eyes"),
                  mouth: pick(Self.mouths, "mouth"), extra: pick(Self.extras, "extra"), blush: object["blush"]?.bool == true)
    }

    /// As `saveCharacter` takes it.
    public var json: JSONValue {
        ["body": .string(body), "skin": .string(skin), "eyes": .string(eyes), "mouth": .string(mouth), "extra": .string(extra), "blush": .bool(blush)]
    }

    /// The web's `randomLook`: any body and color; a bot often gets the visor; most get an extra.
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

    /// Where each body's head starts (hats sit on it), and its outline (and the cat's ears), on a 100×100 canvas.
    public static func shape(_ body: String) -> (top: Double, path: String, extra: String?) {
        switch body {
        case "bean": (20, "M50 20C67 20 76 32 76 50V64C76 79 66 88 50 88C34 88 24 79 24 64V50C24 32 33 20 50 20Z", nil)
        case "cube": (27, "M36 27H64C73 27 79 33 79 42V70C79 79 73 85 64 85H36C27 85 21 79 21 70V42C21 33 27 27 36 27Z", nil)
        case "ghost": (22, "M23 54C23 34 35 22 50 22C65 22 77 34 77 54V84C77 87 74 88 72 86L67 81L61 86C59 88 57 88 55 86L50 81L45 86C43 88 41 88 39 86L33 81L28 86C26 88 23 87 23 84Z", nil)
        case "cat": (28, "M50 28C70 28 80 41 80 58C80 76 67 86 50 86C33 86 20 76 20 58C20 41 30 28 50 28Z",
                     "M24 44L27 17C27.4 14.6 30 13.8 31.7 15.5L45 30ZM76 44L73 17C72.6 14.6 70 13.8 68.3 15.5L55 30Z")
        case "bot": (31, "M34 31H66C74 31 79 36 79 44V71C79 79 74 84 66 84H34C26 84 21 79 21 71V44C21 36 26 31 34 31Z", nil)
        default: (24, "M50 24C71 24 80 37 80 56C80 75 68 86 50 86C32 86 20 75 20 56C20 37 29 24 50 24Z", nil)
        }
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
