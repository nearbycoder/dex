import Foundation

/// A model Dex can run (apps/web/src/shared/models.ts). The app has no list of its own: it gets the agent's
/// (`modelCatalog()`) and keeps the last one on the device.
public struct DexModel: Codable, Sendable, Hashable, Identifiable {
    public struct Cost: Codable, Sendable, Hashable {
        public var input: Double
        public var output: Double
        public var cacheRead: Double
        public var cacheWrite: Double
        public init(input: Double, output: Double, cacheRead: Double = 0, cacheWrite: Double = 0) {
            self.input = input; self.output = output; self.cacheRead = cacheRead; self.cacheWrite = cacheWrite
        }
    }

    public var id: String
    public var apiId: String
    /// clinepass, opencode-go, chatgpt, or commandcode
    public var provider: String
    public var name: String
    public var maker: String
    public var input: [String]
    public var contextWindow: Int
    public var maxTokens: Int
    public var cost: Cost
    /// null marks a level the model rejects; a missing key uses the provider's default.
    public var thinkingLevelMap: [String: String?]?
    public var trainsOnData: Bool?
    /// When the model came out ("2026-11-03"), from the catalogs; nil when none says (and from older agents).
    public var releasedAt: String?

    public init(id: String, apiId: String? = nil, provider: String, name: String, maker: String, input: [String] = ["text"], contextWindow: Int = 128_000,
                maxTokens: Int = 32_000, cost: Cost = .init(input: 0, output: 0, cacheRead: 0, cacheWrite: 0), thinkingLevelMap: [String: String?]? = nil, trainsOnData: Bool? = nil,
                releasedAt: String? = nil) {
        self.id = id; self.apiId = apiId ?? id; self.provider = provider; self.name = name; self.maker = maker; self.input = input
        self.contextWindow = contextWindow; self.maxTokens = maxTokens; self.cost = cost; self.thinkingLevelMap = thinkingLevelMap; self.trainsOnData = trainsOnData
        self.releasedAt = releasedAt
    }

    enum CodingKeys: String, CodingKey { case id, apiId, provider, name, maker, input, contextWindow, maxTokens, cost, thinkingLevelMap, trainsOnData, releasedAt }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        apiId = c.value(.apiId, default: id)
        provider = c.value(.provider, default: "clinepass")
        name = c.value(.name, default: id)
        maker = c.value(.maker, default: "")
        input = c.value(.input, default: ["text"])
        contextWindow = c.value(.contextWindow, default: 0)
        maxTokens = c.value(.maxTokens, default: 0)
        cost = c.value(.cost, default: .init(input: 0, output: 0, cacheRead: 0, cacheWrite: 0))
        // Keep explicit nulls: they mean "rejected", unlike a missing key.
        if let raw = try? c.decodeIfPresent(JSONValue.self, forKey: .thinkingLevelMap), let object = raw.object {
            thinkingLevelMap = object.mapValues { $0.string }
        } else {
            thinkingLevelMap = nil
        }
        trainsOnData = c.value(.trainsOnData, default: nil)
        releasedAt = c.value(.releasedAt, default: nil)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(apiId, forKey: .apiId); try c.encode(provider, forKey: .provider); try c.encode(name, forKey: .name)
        try c.encode(maker, forKey: .maker); try c.encode(input, forKey: .input); try c.encode(contextWindow, forKey: .contextWindow)
        try c.encode(maxTokens, forKey: .maxTokens); try c.encode(cost, forKey: .cost); try c.encodeIfPresent(trainsOnData, forKey: .trainsOnData)
        try c.encodeIfPresent(releasedAt, forKey: .releasedAt)
        if let map = thinkingLevelMap {
            try c.encode(JSONValue.object(map.mapValues { $0.map(JSONValue.string) ?? .null }), forKey: .thinkingLevelMap)
        }
    }

    public var isFree: Bool { cost.input == 0 && cost.output == 0 }
    public var acceptsImages: Bool { input.contains("image") }

    /// How long a model counts as new (a badge in the picker), as on the web.
    public static let newDays = 14

    /// The day it came out (midnight UTC), or nil when that isn't known or isn't a date.
    public var releaseDate: Date? {
        guard let releasedAt else { return nil }
        let parts = releasedAt.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, (1...12).contains(parts[1]), (1...31).contains(parts[2]) else { return nil }
        let date = DateComponents(calendar: .utc, timeZone: .gmt, year: parts[0], month: parts[1], day: parts[2]).date
        // Not a day that exists (Feb 30 rolls over).
        guard let date, Calendar.utc.component(.day, from: date) == parts[2] else { return nil }
        return date
    }

    /// Days since it came out, or nil when that isn't known (`daysSinceRelease` in models.ts).
    public func daysSinceRelease(now: Date = .now) -> Int? {
        releaseDate.map { max(0, Int((now.timeIntervalSince($0) / 86_400).rounded(.down))) }
    }

    /// It came out within the last two weeks (`isNewModel`).
    public func isNew(now: Date = .now) -> Bool { daysSinceRelease(now: now).map { $0 <= Self.newDays } ?? false }

    /// When it came out, short: "Nov 3" this year, "Mar 2025" before (in UTC, like the date itself).
    public func releaseLabel(now: Date = .now, locale: Locale = .current) -> String? {
        guard let date = releaseDate else { return nil }
        var style = Date.FormatStyle(locale: locale, calendar: .utc, timeZone: .gmt).month(.abbreviated)
        style = Calendar.utc.component(.year, from: date) == Calendar.utc.component(.year, from: now) ? style.day() : style.year()
        return date.formatted(style)
    }

    /// Levels the menu offers: null is rejected, a missing level up to `high` is the provider default, and `xhigh`
    /// needs to be listed (or `max`).
    public var supportedThinkingLevels: [ThinkingLevel] {
        let map = thinkingLevelMap ?? [:]
        func listed(_ key: String) -> Bool { if let value = map[key] { value != nil } else { false } }
        return ThinkingLevels.all.filter { level in
            if level == "xhigh" { return listed("xhigh") || listed("max") }
            if let value = map[level] { return value != nil }
            return true
        }
    }

    /// The requested level if supported, else the nearest supported one.
    public func clampThinking(_ level: ThinkingLevel) -> ThinkingLevel {
        let supported = supportedThinkingLevels
        if supported.isEmpty || supported.contains(level) { return level }
        let target = ThinkingLevels.all.firstIndex(of: level) ?? 0
        return supported.min { abs((ThinkingLevels.all.firstIndex(of: $0) ?? 0) - target) < abs((ThinkingLevels.all.firstIndex(of: $1) ?? 0) - target) } ?? level
    }
}

extension Calendar {
    /// Gregorian in UTC: release dates are days, not moments.
    static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        return calendar
    }()
}

public struct ModelCatalog: Codable, Sendable, Hashable {
    public var version: String
    public var updatedAt: Double
    public var models: [DexModel]
    public init(version: String, updatedAt: Double, models: [DexModel]) { self.version = version; self.updatedAt = updatedAt; self.models = models }

    public static let empty = ModelCatalog(version: "", updatedAt: 0, models: [])

    public static let providers: [(id: String, name: String, short: String)] = [
        ("clinepass", "ClinePass", "Cline"), ("opencode-go", "OpenCode Go", "OpenCode"), ("chatgpt", "ChatGPT", "ChatGPT"),
        ("commandcode", "Command Code", "Command")
    ]

    public static func providerName(_ id: String) -> String { providers.first { $0.id == id }?.name ?? id }

    public static let makers: [String: String] = [
        "zai": "Z.ai", "moonshot": "Moonshot AI", "deepseek": "DeepSeek", "qwen": "Alibaba Qwen", "minimax": "MiniMax", "xiaomi": "Xiaomi",
        "meta": "Meta", "anthropic": "Anthropic", "openai": "OpenAI", "xai": "xAI", "google": "Google", "meituan": "Meituan",
        "tencent": "Tencent", "stepfun": "StepFun", "opencode": "OpenCode",
        // Other makers Command Code serves (Mistral, NVIDIA, Sakana, …), under its mark.
        "commandcode": "Command Code",
        // Stealth models (their maker unannounced) and makers without a logo here.
        "other": "Other"
    ]

    /// The newest-first list's sections, by how many days ago a model came out (then "Release date unknown").
    public static let releasePeriods: [(days: Int, label: String)] = [(7, "This week"), (30, "This month"), (90, "Past 3 months"), (.max, "Earlier")]
    /// The "released within" filter's choices (0: any time).
    public static let releaseWithin: [(days: Int, label: String)] = [(0, "Any time"), (7, "7 days"), (30, "30 days"), (90, "90 days")]

    /// `models` newest first (then connected subscriptions first, else as listed), in `releasePeriods`' sections and
    /// one for those without a date, leaving out the empty ones.
    public static func byRelease(_ models: [DexModel], connected: [String: Bool] = [:], now: Date = .now) -> [(label: String, models: [DexModel])] {
        let sorted = models.enumerated().sorted { a, b in
            let (x, y) = (a.element, b.element)
            if x.releasedAt ?? "" != y.releasedAt ?? "" { return x.releasedAt ?? "" > y.releasedAt ?? "" }
            let (cx, cy) = (connected[x.provider] == true, connected[y.provider] == true)
            return cx != cy ? cx : a.offset < b.offset
        }.map(\.element)
        var sections: [(label: String, models: [DexModel])] = []
        var after = -1
        for period in releasePeriods {
            sections.append((period.label, sorted.filter { $0.daysSinceRelease(now: now).map { $0 > after && $0 <= period.days } ?? false }))
            after = period.days
        }
        sections.append(("Release date unknown", sorted.filter { $0.daysSinceRelease(now: now) == nil }))
        return sections.filter { !$0.models.isEmpty }
    }

    public func model(_ id: String) -> DexModel? { models.first { $0.id == id } }
    public func models(of provider: String) -> [DexModel] { models.filter { $0.provider == provider } }

    /// Which subscription a chat's model runs on (an unlisted id goes by its prefix, else ClinePass, as on the web).
    public func provider(of id: String) -> String {
        model(id)?.provider ?? (id.hasPrefix("opencode-go/") ? "opencode-go" : id.hasPrefix("chatgpt/") ? "chatgpt" : id.hasPrefix("commandcode/") ? "commandcode" : "clinepass")
    }

    /// The model's name, or a readable form of its id when it isn't listed.
    public func name(of id: String) -> String { model(id)?.name ?? id.split(separator: "/").last.map(String.init) ?? id }

    /// The same model on the other provider, when it offers it.
    public func counterpart(_ id: String, provider: String) -> DexModel? {
        guard let model = model(id) else { return nil }
        if model.provider == provider { return model }
        let slug = model.apiId.replacingOccurrences(of: "cline-pass/", with: "")
        return models.first { $0.provider == provider && $0.apiId.replacingOccurrences(of: "cline-pass/", with: "") == slug }
    }

    /// A model that can run with the connected subscriptions (see `usableModel` in models.ts).
    public func usableModel(_ id: String, connected: [String: Bool]) -> String {
        if connected[provider(of: id)] == true { return id }
        guard let other = Self.providers.map(\.id).first(where: { connected[$0] == true }) else { return id }
        return (counterpart(id, provider: other) ?? models.first { $0.provider == other })?.id ?? id
    }
}
