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
    /// clinepass or opencode-go
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

    public init(id: String, apiId: String? = nil, provider: String, name: String, maker: String, input: [String] = ["text"], contextWindow: Int = 128_000,
                maxTokens: Int = 32_000, cost: Cost = .init(input: 0, output: 0, cacheRead: 0, cacheWrite: 0), thinkingLevelMap: [String: String?]? = nil, trainsOnData: Bool? = nil) {
        self.id = id; self.apiId = apiId ?? id; self.provider = provider; self.name = name; self.maker = maker; self.input = input
        self.contextWindow = contextWindow; self.maxTokens = maxTokens; self.cost = cost; self.thinkingLevelMap = thinkingLevelMap; self.trainsOnData = trainsOnData
    }

    enum CodingKeys: String, CodingKey { case id, apiId, provider, name, maker, input, contextWindow, maxTokens, cost, thinkingLevelMap, trainsOnData }
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
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(apiId, forKey: .apiId); try c.encode(provider, forKey: .provider); try c.encode(name, forKey: .name)
        try c.encode(maker, forKey: .maker); try c.encode(input, forKey: .input); try c.encode(contextWindow, forKey: .contextWindow)
        try c.encode(maxTokens, forKey: .maxTokens); try c.encode(cost, forKey: .cost); try c.encodeIfPresent(trainsOnData, forKey: .trainsOnData)
        if let map = thinkingLevelMap {
            try c.encode(JSONValue.object(map.mapValues { $0.map(JSONValue.string) ?? .null }), forKey: .thinkingLevelMap)
        }
    }

    public var isFree: Bool { cost.input == 0 && cost.output == 0 }
    public var acceptsImages: Bool { input.contains("image") }

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

public struct ModelCatalog: Codable, Sendable, Hashable {
    public var version: String
    public var updatedAt: Double
    public var models: [DexModel]
    public init(version: String, updatedAt: Double, models: [DexModel]) { self.version = version; self.updatedAt = updatedAt; self.models = models }

    public static let empty = ModelCatalog(version: "", updatedAt: 0, models: [])

    public static let providers: [(id: String, name: String, short: String)] = [("clinepass", "ClinePass", "Cline"), ("opencode-go", "OpenCode Go", "OpenCode")]

    public static func providerName(_ id: String) -> String { providers.first { $0.id == id }?.name ?? id }

    public static let makers: [String: String] = [
        "zai": "Z.ai", "moonshot": "Moonshot AI", "deepseek": "DeepSeek", "qwen": "Alibaba Qwen", "minimax": "MiniMax", "xiaomi": "Xiaomi",
        "meta": "Meta", "anthropic": "Anthropic", "openai": "OpenAI", "xai": "xAI", "google": "Google", "meituan": "Meituan",
        "tencent": "Tencent", "stepfun": "StepFun", "opencode": "OpenCode"
    ]

    public func model(_ id: String) -> DexModel? { models.first { $0.id == id } }
    public func models(of provider: String) -> [DexModel] { models.filter { $0.provider == provider } }

    /// Which subscription a chat's model runs on (an unlisted id counts as ClinePass, as on the web).
    public func provider(of id: String) -> String { model(id)?.provider ?? (id.hasPrefix("opencode-go/") ? "opencode-go" : "clinepass") }

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
