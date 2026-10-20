import UIKit

/// OpenUI icons are lucide names (kebab-case, e.g. "circle-check"); this picks the closest SF Symbol. Unknown names
/// try a few spellings, then the icon's category (react-ui's categoryFallbacks), then a neutral dot.
enum LucideSymbols {
    static func symbol(for name: String, category: String? = nil) -> String {
        let key = kebab(name)
        if let found = cache[key + "|" + (category ?? "")] { return found }
        let result = resolve(key, category: category)
        cache[key + "|" + (category ?? "")] = result
        return result
    }

    @MainActor private static var cache: [String: String] = [:]

    private static func resolve(_ key: String, category: String?) -> String {
        var candidates = [key]
        // "circle-check" and "check-circle", "-2" variants, and "square-x" style prefixes.
        let parts = key.split(separator: "-").map(String.init)
        if parts.count > 1, ["circle", "square"].contains(parts[0]) { candidates.append(parts.dropFirst().joined(separator: "-") + "-" + parts[0]) }
        if let last = parts.last, Int(last) != nil { candidates.append(parts.dropLast().joined(separator: "-")) }
        if parts.count > 1 { candidates.append(parts.dropFirst().joined(separator: "-")) }
        for candidate in candidates {
            if let symbol = map[candidate], UIImage(systemName: symbol) != nil { return symbol }
            let dotted = candidate.replacingOccurrences(of: "-", with: ".")
            if UIImage(systemName: dotted) != nil { return dotted }
        }
        if let category = category?.trimmingCharacters(in: .whitespaces).lowercased(), let fallback = categories[category], let symbol = map[fallback] {
            return symbol
        }
        return "circle.dashed"
    }

    private static func kebab(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespaces)
            .replacing(/([a-z0-9])([A-Z])/, with: { "\($0.output.1)-\($0.output.2)" })
            .replacingOccurrences(of: "_", with: "-")
            .replacingOccurrences(of: " ", with: "-")
            .lowercased()
    }

    /// react-ui's category fallbacks (lucide names).
    private static let categories: [String: String] = [
        "accessibility": "accessibility", "account": "user", "animals": "cat", "arrows": "arrow-right", "brands": "box", "buildings": "building",
        "charts": "chart-line", "communication": "message-square", "connectivity": "wifi", "cursors": "mouse-pointer", "design": "palette",
        "development": "code", "devices": "smartphone", "emoji": "smile", "files": "file", "finance": "dollar-sign", "food-beverage": "cooking-pot",
        "gaming": "gamepad", "home": "house", "layout": "layout", "mail": "mail", "math": "calculator", "medical": "heart-pulse",
        "multimedia": "music", "nature": "tree-pine", "navigation": "map-pin", "notifications": "bell", "people": "users",
        "photography": "camera", "science": "microscope", "seasons": "sun", "security": "shield", "shapes": "circle",
        "shopping": "shopping-cart", "social": "share-2", "sports": "trophy", "sustainability": "leaf", "text": "type", "time": "clock",
        "tools": "wrench", "transportation": "car", "travel": "plane", "weather": "cloud"
    ]

    /// Lucide name → SF Symbol, for the icons models use most.
    private static let map: [String: String] = [
        // Status and marks
        "check": "checkmark", "circle-check": "checkmark.circle", "check-circle": "checkmark.circle", "circle-check-big": "checkmark.circle",
        "badge-check": "checkmark.seal", "x": "xmark", "circle-x": "xmark.circle", "x-circle": "xmark.circle", "plus": "plus",
        "circle-plus": "plus.circle", "minus": "minus", "circle-minus": "minus.circle", "info": "info.circle", "circle-help": "questionmark.circle",
        "help-circle": "questionmark.circle", "alert-circle": "exclamationmark.circle", "circle-alert": "exclamationmark.circle",
        "alert-triangle": "exclamationmark.triangle", "triangle-alert": "exclamationmark.triangle", "ban": "nosign", "star": "star",
        "heart": "heart", "thumbs-up": "hand.thumbsup", "thumbs-down": "hand.thumbsdown", "flag": "flag", "bookmark": "bookmark",
        "award": "rosette", "trophy": "trophy", "medal": "medal", "crown": "crown", "sparkles": "sparkles", "zap": "bolt", "flame": "flame",
        "target": "target", "circle": "circle", "circle-dot": "smallcircle.filled.circle", "square": "square", "triangle": "triangle",
        "hexagon": "hexagon", "diamond": "diamond", "shapes": "square.on.circle",
        // Arrows and navigation
        "arrow-right": "arrow.right", "arrow-left": "arrow.left", "arrow-up": "arrow.up", "arrow-down": "arrow.down",
        "arrow-up-right": "arrow.up.right", "arrow-down-right": "arrow.down.right", "chevron-right": "chevron.right", "chevron-left": "chevron.left",
        "chevron-down": "chevron.down", "chevron-up": "chevron.up", "external-link": "arrow.up.right.square", "refresh-cw": "arrow.clockwise",
        "refresh-ccw": "arrow.counterclockwise", "rotate-cw": "arrow.clockwise", "repeat": "repeat", "shuffle": "shuffle", "undo": "arrow.uturn.backward",
        "redo": "arrow.uturn.forward", "move": "arrow.up.and.down.and.arrow.left.and.right", "maximize": "arrow.up.left.and.arrow.down.right",
        "minimize": "arrow.down.right.and.arrow.up.left", "map-pin": "mappin.and.ellipse", "map": "map", "navigation": "location.north",
        "compass": "safari", "locate": "location", "route": "point.topleft.down.to.point.bottomright.curvepath", "signpost": "signpost.right",
        // Charts and data
        "chart-line": "chart.xyaxis.line", "line-chart": "chart.xyaxis.line", "chart-bar": "chart.bar", "bar-chart": "chart.bar",
        "bar-chart-2": "chart.bar", "bar-chart-3": "chart.bar", "chart-column": "chart.bar", "chart-pie": "chart.pie", "pie-chart": "chart.pie",
        "trending-up": "chart.line.uptrend.xyaxis", "trending-down": "chart.line.downtrend.xyaxis", "activity": "waveform.path.ecg",
        "gauge": "gauge.with.dots.needle.33percent", "percent": "percent", "hash": "number", "sigma": "sum", "calculator": "plusminus.circle",
        "database": "cylinder.split.1x2", "server": "server.rack", "table": "tablecells", "list": "list.bullet", "list-checks": "checklist",
        "layers": "square.3.layers.3d", "filter": "line.3.horizontal.decrease", "sliders": "slider.horizontal.3",
        "sliders-horizontal": "slider.horizontal.3", "settings": "gearshape", "cog": "gearshape", "search": "magnifyingglass",
        "layout": "rectangle.3.group", "layout-grid": "square.grid.2x2", "grid": "square.grid.3x3", "kanban": "rectangle.split.3x1",
        // People and communication
        "user": "person", "users": "person.2", "user-plus": "person.badge.plus", "user-minus": "person.badge.minus", "user-check": "person.badge.shield.checkmark",
        "user-round": "person.crop.circle", "contact": "person.crop.rectangle", "smile": "face.smiling", "message-square": "bubble.left",
        "message-circle": "bubble.left.circle", "messages-square": "bubble.left.and.bubble.right", "mail": "envelope", "inbox": "tray",
        "send": "paperplane", "phone": "phone", "video": "video", "megaphone": "megaphone", "bell": "bell", "bell-ring": "bell.badge",
        "share": "square.and.arrow.up", "share-2": "square.and.arrow.up", "at-sign": "at", "headphones": "headphones", "mic": "mic",
        "accessibility": "accessibility", "hand": "hand.raised", "handshake": "hand.wave",
        // Files and code
        "file": "doc", "file-text": "doc.text", "files": "doc.on.doc", "folder": "folder", "folder-open": "folder", "archive": "archivebox",
        "clipboard": "clipboard", "copy": "doc.on.doc", "download": "arrow.down.circle", "upload": "arrow.up.circle", "paperclip": "paperclip",
        "link": "link", "code": "chevron.left.forwardslash.chevron.right", "code-2": "chevron.left.forwardslash.chevron.right",
        "terminal": "terminal", "git-branch": "arrow.triangle.branch", "git-pull-request": "arrow.triangle.pull", "github": "chevron.left.forwardslash.chevron.right",
        "bug": "ant", "cpu": "cpu", "hard-drive": "internaldrive", "cloud": "cloud", "cloud-upload": "icloud.and.arrow.up", "wifi": "wifi",
        "bluetooth": "dot.radiowaves.left.and.right", "globe": "globe", "rss": "dot.radiowaves.up.forward", "box": "shippingbox",
        "package": "shippingbox", "puzzle": "puzzlepiece", "type": "textformat", "pencil": "pencil", "pen": "pencil", "edit": "square.and.pencil",
        "trash": "trash", "trash-2": "trash", "save": "square.and.arrow.down", "printer": "printer", "book": "book", "book-open": "book",
        "notebook": "book.closed", "newspaper": "newspaper", "scroll": "scroll", "tag": "tag", "tags": "tag", "key": "key",
        "lock": "lock", "unlock": "lock.open", "shield": "shield", "shield-check": "checkmark.shield", "eye": "eye", "eye-off": "eye.slash",
        "fingerprint": "touchid", "qr-code": "qrcode", "scan": "viewfinder",
        // Devices and media
        "smartphone": "iphone", "tablet": "ipad", "laptop": "laptopcomputer", "monitor": "desktopcomputer", "tv": "tv", "watch": "applewatch",
        "camera": "camera", "image": "photo", "images": "photo.on.rectangle", "film": "film", "music": "music.note", "disc-3": "opticaldisc",
        "play": "play", "pause": "pause", "volume-2": "speaker.wave.2", "gamepad": "gamecontroller", "gamepad-2": "gamecontroller",
        "mouse-pointer": "cursorarrow", "palette": "paintpalette", "brush": "paintbrush", "pen-tool": "pencil.tip", "microscope": "microscope",
        "flask-conical": "flask", "atom": "atom", "dna": "allergens", "heart-pulse": "heart.text.square", "stethoscope": "stethoscope",
        "pill": "pills", "syringe": "syringe", "brain": "brain",
        // Time and weather
        "clock": "clock", "timer": "timer", "alarm-clock": "alarm", "hourglass": "hourglass", "calendar": "calendar", "calendar-days": "calendar",
        "history": "clock.arrow.circlepath", "sun": "sun.max", "moon": "moon", "cloud-rain": "cloud.rain", "cloud-sun": "cloud.sun",
        "snowflake": "snowflake", "wind": "wind", "umbrella": "umbrella", "thermometer": "thermometer.medium", "droplet": "drop",
        "rainbow": "rainbow", "zap-off": "bolt.slash",
        // Places, travel, nature
        "house": "house", "home": "house", "building": "building", "building-2": "building.2", "landmark": "building.columns",
        "store": "storefront", "school": "graduationcap", "hospital": "cross.case", "factory": "building.2", "tent": "tent", "mountain": "mountain.2",
        "waves": "water.waves", "tree-pine": "tree", "trees": "tree", "leaf": "leaf", "flower": "camera.macro", "sprout": "leaf",
        "recycle": "arrow.3.trianglepath", "plane": "airplane", "car": "car", "bus": "bus", "train-front": "tram", "train": "tram",
        "bike": "bicycle", "ship": "ferry", "rocket": "paperplane", "fuel": "fuelpump", "luggage": "suitcase.rolling", "briefcase": "briefcase",
        "ticket": "ticket", "bed": "bed.double", "hotel": "building", "cat": "cat", "dog": "dog", "bird": "bird", "fish": "fish", "paw-print": "pawprint",
        // Food and shopping
        "utensils": "fork.knife", "utensils-crossed": "fork.knife", "coffee": "cup.and.saucer", "cooking-pot": "frying.pan", "pizza": "fork.knife",
        "wine": "wineglass", "beer": "mug", "apple": "applelogo", "cake": "birthday.cake", "shopping-cart": "cart", "shopping-bag": "bag",
        "gift": "gift", "credit-card": "creditcard", "wallet": "wallet.bifold", "banknote": "banknote", "receipt": "receipt",
        "dollar-sign": "dollarsign", "circle-dollar-sign": "dollarsign.circle", "euro": "eurosign", "piggy-bank": "banknote",
        "coins": "dollarsign.circle", "scale": "scalemass", "trophy-2": "trophy", "dumbbell": "dumbbell", "football": "football",
        // Tools
        "wrench": "wrench.adjustable", "hammer": "hammer", "screwdriver": "screwdriver", "settings-2": "gearshape.2", "plug": "powerplug",
        "battery": "battery.100", "power": "power", "lightbulb": "lightbulb", "magnet": "magnifyingglass", "anchor": "sailboat"
    ]
}
