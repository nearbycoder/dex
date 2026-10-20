import Foundation

// Spending and usage across ClinePass, OpenCode Go, boat.dev, and Cloudflare (`usageReport(range)`), mirroring
// apps/web/src/shared/usage.ts.

public enum UsageRange: String, Codable, Sendable, Hashable, CaseIterable, Identifiable {
    case month
    case days30 = "30d"
    case all
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .month: "This month"
        case .days30: "Last 30 days"
        case .all: "All time"
        }
    }
}

/// Plan fees, in USD per month: the flat parts of each bill.
public enum PlanFees {
    public static let clinePass = 9.99
    public static let openCodeGo = 10.0
    public static let workersPaid = 5.0
}

public struct DailySpend: Codable, Sendable, Hashable, Identifiable {
    /// UTC date, YYYY-MM-DD.
    public var date: String
    public var cline: Double
    public var opencode: Double
    public var boat: Double
    public var cloudflare: Double
    public var id: String { date }

    public init(date: String, cline: Double = 0, opencode: Double = 0, boat: Double = 0, cloudflare: Double = 0) {
        self.date = date; self.cline = cline; self.opencode = opencode; self.boat = boat; self.cloudflare = cloudflare
    }

    public func value(_ series: UsageSeries) -> Double {
        switch series {
        case .cline: cline
        case .opencode: opencode
        case .boat: boat
        case .cloudflare: cloudflare
        }
    }

    public func total(_ series: [UsageSeries]) -> Double { series.reduce(0) { $0 + value($1) } }

    /// Midnight UTC of `date`.
    public var day: Date? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}

/// The services in the daily chart, in the web's fixed order.
public enum UsageSeries: String, Sendable, Hashable, CaseIterable, Identifiable {
    case cline, boat, cloudflare, opencode
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .cline: "ClinePass"
        case .boat: "boat.dev"
        case .cloudflare: "Cloudflare"
        case .opencode: "OpenCode Go"
        }
    }
    public var note: String {
        switch self {
        case .cline: "at API list prices"
        case .boat: "VM time"
        case .cloudflare: "metered"
        case .opencode: "at Go rates"
        }
    }
}

public struct ModelUsageRow: Codable, Sendable, Hashable, Identifiable {
    public var model: String
    public var responses: Int
    public var totalTokens: Double
    public var listCost: Double
    public var id: String { model }
    public init(model: String, responses: Int, totalTokens: Double, listCost: Double) {
        self.model = model; self.responses = responses; self.totalTokens = totalTokens; self.listCost = listCost
    }
}

public struct ChatUsageRow: Codable, Sendable, Hashable, Identifiable {
    public var sessionId: String
    public var title: String
    public var totalTokens: Double
    public var listCost: Double
    public var id: String { sessionId }
    public var isDeleted: Bool { title == "Deleted chat" }
    public init(sessionId: String, title: String, totalTokens: Double, listCost: Double) {
        self.sessionId = sessionId; self.title = title; self.totalTokens = totalTokens; self.listCost = listCost
    }
}

/// One subscription's model usage (ClinePass, or OpenCode Go's with its allowance).
public struct ModelUsage: Codable, Sendable, Hashable {
    public var responses: Int
    public var inputTokens: Double
    public var outputTokens: Double
    public var cacheReadTokens: Double
    public var totalTokens: Double
    /// What these tokens cost at the models' rates (API list prices for ClinePass, Go's rates for OpenCode).
    public var listCost: Double
    public var byModel: [ModelUsageRow]
    public var byChat: [ChatUsageRow]
    /// OpenCode Go only.
    public var connected: Bool?
    public var limits: OpenCodeLimits?
    public var limitsError: String?

    public init(responses: Int = 0, inputTokens: Double = 0, outputTokens: Double = 0, cacheReadTokens: Double = 0, totalTokens: Double = 0,
                listCost: Double = 0, byModel: [ModelUsageRow] = [], byChat: [ChatUsageRow] = [], connected: Bool? = nil,
                limits: OpenCodeLimits? = nil, limitsError: String? = nil) {
        self.responses = responses; self.inputTokens = inputTokens; self.outputTokens = outputTokens; self.cacheReadTokens = cacheReadTokens
        self.totalTokens = totalTokens; self.listCost = listCost; self.byModel = byModel; self.byChat = byChat; self.connected = connected
        self.limits = limits; self.limitsError = limitsError
    }

    enum CodingKeys: String, CodingKey { case responses, inputTokens, outputTokens, cacheReadTokens, totalTokens, listCost, byModel, byChat, connected, limits, limitsError }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        responses = c.value(.responses, default: 0)
        inputTokens = c.value(.inputTokens, default: 0)
        outputTokens = c.value(.outputTokens, default: 0)
        cacheReadTokens = c.value(.cacheReadTokens, default: 0)
        totalTokens = c.value(.totalTokens, default: 0)
        listCost = c.value(.listCost, default: 0)
        byModel = c.value(.byModel, default: [])
        byChat = c.value(.byChat, default: [])
        connected = c.value(.connected, default: nil)
        limits = c.value(.limits, default: nil)
        limitsError = c.value(.limitsError, default: nil)
    }
}

/// One of OpenCode Go's allowance windows: share used (0–100) and when it resets.
public struct OpenCodeWindow: Codable, Sendable, Hashable {
    public var percent: Double
    /// ISO 8601.
    public var resetsAt: String
    /// Requests are blocked until it resets.
    public var limited: Bool
    public init(percent: Double, resetsAt: String, limited: Bool = false) { self.percent = percent; self.resetsAt = resetsAt; self.limited = limited }

    public var clampedPercent: Double { min(100, max(0, percent)) }
    public var resetDate: Date? { ISODates.parse(resetsAt) }

    /// "resets in 3 h", "resets in 12 min", "resets Oct 31", "resetting now" (the web's wording).
    public func resetsLabel(now: Date = .now) -> String {
        guard let date = resetDate else { return "resetting now" }
        let ms = date.timeIntervalSince(now) * 1000
        if ms <= 0 { return "resetting now" }
        let hours = ms / 3_600_000
        if hours < 1 { return "resets in \(max(1, Int((ms / 60_000).rounded()))) min" }
        if hours < 48 { return "resets in \(Int(hours.rounded())) h" }
        return "resets \(date.formatted(.dateTime.month(.abbreviated).day()))"
    }
}

/// OpenCode Go's allowance: 5-hour (20% of the month's), weekly (50%), and monthly windows.
public struct OpenCodeLimits: Codable, Sendable, Hashable {
    public var rolling: OpenCodeWindow
    public var weekly: OpenCodeWindow
    public var monthly: OpenCodeWindow
    public init(rolling: OpenCodeWindow, weekly: OpenCodeWindow, monthly: OpenCodeWindow) { self.rolling = rolling; self.weekly = weekly; self.monthly = monthly }
}

public struct BoatUsage: Codable, Sendable, Hashable {
    public struct SizeRow: Codable, Sendable, Hashable, Identifiable {
        public var size: String
        public var hours: Double
        public var cost: Double
        public var id: String { size }
        public init(size: String, hours: Double, cost: Double) { self.size = size; self.hours = hours; self.cost = cost }
    }

    public struct Run: Codable, Sendable, Hashable, Identifiable {
        public var startedAt: Double
        public var endedAt: Double?
        public var size: String
        public var hours: Double
        public var cost: Double
        public var id: Double { startedAt }
        public init(startedAt: Double, endedAt: Double?, size: String, hours: Double, cost: Double) {
            self.startedAt = startedAt; self.endedAt = endedAt; self.size = size; self.hours = hours; self.cost = cost
        }
        /// "25 min" or "1.5 h".
        public var durationLabel: String { hours < 1 ? "\(Int((hours * 60).rounded())) min" : String(format: "%.1f h", hours) }
    }

    public var hours: Double
    public var cost: Double
    public var running: Bool
    public var bySize: [SizeRow]
    public var runs: [Run]

    public init(hours: Double = 0, cost: Double = 0, running: Bool = false, bySize: [SizeRow] = [], runs: [Run] = []) {
        self.hours = hours; self.cost = cost; self.running = running; self.bySize = bySize; self.runs = runs
    }

    enum CodingKeys: String, CodingKey { case hours, cost, running, bySize, runs }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        hours = c.value(.hours, default: 0)
        cost = c.value(.cost, default: 0)
        running = c.value(.running, default: false)
        bySize = c.value(.bySize, default: [])
        runs = c.value(.runs, default: [])
    }
}

public struct CloudflareLine: Codable, Sendable, Hashable, Identifiable {
    public var label: String
    public var quantity: Double
    public var unit: String
    /// At list rates, before the plan's included allowance.
    public var cost: Double
    /// Share of the monthly included allowance used, 0–1.
    public var allowanceUsed: Double?
    public var accountWide: Bool?
    public var id: String { label }
    public init(label: String, quantity: Double, unit: String, cost: Double, allowanceUsed: Double? = nil, accountWide: Bool? = nil) {
        self.label = label; self.quantity = quantity; self.unit = unit; self.cost = cost; self.allowanceUsed = allowanceUsed; self.accountWide = accountWide
    }
}

public struct CloudflareUsage: Codable, Sendable, Hashable {
    /// False until the deployment has an analytics token.
    public var configured: Bool
    public var error: String?
    /// Cloudflare keeps analytics about a month, so longer ranges are clipped.
    public var since: Double
    public var lines: [CloudflareLine]
    public var meteredCost: Double

    public init(configured: Bool = false, error: String? = nil, since: Double = 0, lines: [CloudflareLine] = [], meteredCost: Double = 0) {
        self.configured = configured; self.error = error; self.since = since; self.lines = lines; self.meteredCost = meteredCost
    }

    enum CodingKeys: String, CodingKey { case configured, error, since, lines, meteredCost }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        configured = c.value(.configured, default: false)
        error = c.value(.error, default: nil)
        since = c.value(.since, default: 0)
        lines = c.value(.lines, default: [])
        meteredCost = c.value(.meteredCost, default: 0)
    }
}

public struct UsageReport: Codable, Sendable, Hashable {
    public var range: UsageRange
    public var since: Double
    public var until: Double
    public var cline: ModelUsage
    /// Its token costs are at Go's rates, which is what counts against the plan's allowance.
    public var opencode: ModelUsage
    public var boat: BoatUsage
    public var cloudflare: CloudflareUsage
    public var daily: [DailySpend]

    public init(range: UsageRange, since: Double, until: Double, cline: ModelUsage = .init(), opencode: ModelUsage = .init(), boat: BoatUsage = .init(),
                cloudflare: CloudflareUsage = .init(), daily: [DailySpend] = []) {
        self.range = range; self.since = since; self.until = until; self.cline = cline; self.opencode = opencode; self.boat = boat
        self.cloudflare = cloudflare; self.daily = daily
    }

    enum CodingKeys: String, CodingKey { case range, since, until, cline, opencode, boat, cloudflare, daily }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        range = c.value(.range, default: .month)
        since = c.value(.since, default: 0)
        until = c.value(.until, default: 0)
        cline = c.value(.cline, default: .init())
        opencode = c.value(.opencode, default: .init())
        boat = c.value(.boat, default: .init())
        cloudflare = c.value(.cloudflare, default: .init())
        daily = c.value(.daily, default: [])
    }

    /// What the Usage page shows from a report, worked out as the web does.
    public struct Summary: Sendable, Hashable {
        public var showCline: Bool
        public var showOpenCode: Bool
        /// The chart's series: a subscription appears once it's connected or was used in the period.
        public var series: [UsageSeries]
        /// The month's plan fees.
        public var plans: Double
        /// The headline: plans + VM time this month, or the variable spend for other ranges.
        public var headline: Double
        public var headlineLabel: String
        public var headlineDetail: String
    }

    public func summary(clineConnected: Bool) -> Summary {
        let showCline = clineConnected || cline.totalTokens > 0
        let showOpenCode = opencode.connected == true || opencode.totalTokens > 0
        let series = UsageSeries.allCases.filter { $0 == .cline ? showCline : $0 == .opencode ? showOpenCode : true }
        let plans = PlanFees.workersPaid + (clineConnected ? PlanFees.clinePass : 0) + (opencode.connected == true ? PlanFees.openCodeGo : 0)
        let isMonth = range == .month
        return Summary(
            showCline: showCline, showOpenCode: showOpenCode, series: series, plans: plans,
            headline: isMonth ? plans + boat.cost : boat.cost,
            headlineLabel: isMonth ? "Estimated bill this month" : "Variable spend",
            headlineDetail: isMonth ? "Plans \(UsageFormat.usd(plans)) + boat.dev \(UsageFormat.usd(boat.cost))" : "boat.dev VM time. Plans add \(UsageFormat.usd(plans))/month."
        )
    }
}

/// The Usage page's number formats (the web's `usd` and `compact`).
public enum UsageFormat {
    /// "$0.00", "<$0.01", "$12.34", "$1,234".
    public static func usd(_ value: Double) -> String {
        if value == 0 { return "$0.00" }
        if value < 0.01 { return "<$0.01" }
        if value < 100 { return String(format: "$%.2f", value) }
        return "$" + Int(value.rounded()).formatted(.number.grouping(.automatic).locale(Locale(identifier: "en_US")))
    }

    /// "980", "1.2K", "3.4M".
    public static func compact(_ value: Double) -> String {
        value.formatted(.number.notation(.compactName).precision(.fractionLength(0...(value < 1000 ? 0 : 1))).locale(Locale(identifier: "en_US")))
    }
}
