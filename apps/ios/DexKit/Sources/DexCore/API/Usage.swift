import Foundation

// Spending and usage across ClinePass, OpenCode Go, ChatGPT, Command Code, OpenRouter, boat.dev, and Cloudflare (`usageReport(range)`),
// mirroring apps/web/src/shared/usage.ts.

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
    /// For the narrowest phones.
    public var shortLabel: String {
        switch self {
        case .month: "Month"
        case .days30: "30 days"
        case .all: "All"
        }
    }
}

/// Plan fees, in USD per month: the flat parts of each bill.
public enum PlanFees {
    public static let clinePass = 9.99
    public static let openCodeGo = 10.0
    /// Command Code's Goat plan (plus a processing fee).
    public static let commandCode = 10.0
    public static let workersPaid = 5.0
}

/// Command Code's Goat allowance, in dollars of usage at each model's API rates: any 5 hours may use $20, any 7 days $50,
/// and the month $100. Command Code has no API for the live meters.
public enum CommandCodeLimits {
    public static let fiveHours = 20.0
    public static let week = 50.0
    public static let month = 100.0
}

public struct DailySpend: Codable, Sendable, Hashable, Identifiable {
    /// UTC date, YYYY-MM-DD.
    public var date: String
    public var cline: Double
    public var opencode: Double
    /// At API list prices. Missing from an older agent's report.
    public var chatgpt: Double?
    /// At Command Code's rates. Missing from an older agent's report.
    public var commandcode: Double?
    /// OpenRouter's free models cost nothing, so 0 unless a paid one ran. Missing from an older agent's report.
    public var openrouter: Double?
    public var boat: Double
    public var cloudflare: Double
    public var id: String { date }

    public init(date: String, cline: Double = 0, opencode: Double = 0, chatgpt: Double? = nil, commandcode: Double? = nil, openrouter: Double? = nil,
                boat: Double = 0, cloudflare: Double = 0) {
        self.date = date; self.cline = cline; self.opencode = opencode; self.chatgpt = chatgpt; self.commandcode = commandcode; self.openrouter = openrouter
        self.boat = boat; self.cloudflare = cloudflare
    }

    public func value(_ series: UsageSeries) -> Double {
        switch series {
        case .cline: cline
        case .opencode: opencode
        case .chatgpt: chatgpt ?? 0
        case .commandcode: commandcode ?? 0
        case .openrouter: openrouter ?? 0
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
    case cline, boat, cloudflare, opencode, chatgpt, commandcode, openrouter
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .cline: "ClinePass"
        case .boat: "boat.dev"
        case .cloudflare: "Cloudflare"
        case .opencode: "OpenCode Go"
        case .chatgpt: "ChatGPT"
        case .commandcode: "Command Code"
        case .openrouter: "OpenRouter"
        }
    }
}

/// The model subscriptions in the Usage page's order: which part of the report is theirs, and how their token costs are priced.
public enum UsageSubscription: String, Sendable, Hashable, CaseIterable, Identifiable {
    case clinepass
    case opencodeGo = "opencode-go"
    case commandcode
    /// Paid for with your ChatGPT plan, outside Dex's estimate.
    case chatgpt
    /// Free models only.
    case openrouter
    public var id: String { rawValue }

    public var series: UsageSeries {
        switch self {
        case .clinepass: .cline
        case .opencodeGo: .opencode
        case .commandcode: .commandcode
        case .chatgpt: .chatgpt
        case .openrouter: .openrouter
        }
    }
    public var label: String { series.label }
    public var rates: String {
        switch self {
        case .clinepass, .chatgpt: "at API list prices"
        case .opencodeGo: "at Go's rates"
        case .commandcode: "at the plan's rates"
        case .openrouter: "free models"
        }
    }
    public var column: String {
        switch self {
        case .clinepass, .chatgpt: "List price"
        case .opencodeGo: "Go rates"
        case .commandcode: "Plan rates"
        case .openrouter: "Cost"
        }
    }
    /// The plan's monthly fee; nil for ChatGPT, whose plan Dex doesn't know, and OpenRouter's free models.
    public var fee: Double? {
        switch self {
        case .clinepass: PlanFees.clinePass
        case .opencodeGo: PlanFees.openCodeGo
        case .commandcode: PlanFees.commandCode
        case .chatgpt, .openrouter: nil
        }
    }
    /// How its price reads: in the Services list (`price`), and as the Plan stat (`value`, `detail`).
    public var plan: (price: String, value: String, detail: String) {
        switch self {
        case .chatgpt: ("ChatGPT plan", "ChatGPT", "your ChatGPT plan")
        case .openrouter: ("Free", "Free", "free models only")
        default: fee.map { ("\(UsageFormat.usd($0))/mo", "\(UsageFormat.usd($0))/mo", "flat fee") } ?? ("", "", "")
        }
    }
}

/// What Dex spent on Command Code in its allowance's windows, to set against `CommandCodeLimits`.
public struct CommandCodeSpent: Codable, Sendable, Hashable {
    public var fiveHours: Double
    public var week: Double
    public var month: Double
    public init(fiveHours: Double = 0, week: Double = 0, month: Double = 0) { self.fiveHours = fiveHours; self.week = week; self.month = month }

    enum CodingKeys: String, CodingKey { case fiveHours, week, month }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        fiveHours = c.value(.fiveHours, default: 0)
        week = c.value(.week, default: 0)
        month = c.value(.month, default: 0)
    }
}

/// OpenRouter's own numbers for the connected key, across every app that uses the key (`OpenRouterAccount` in usage.ts).
public struct OpenRouterAccount: Codable, Sendable, Hashable {
    /// Free-model requests today (UTC) against the account's daily allowance: 50, or 1,000 once it has bought $10 of credits.
    public struct FreeRequests: Codable, Sendable, Hashable {
        public var used: Double
        public var limit: Double
        public init(used: Double, limit: Double) { self.used = used; self.limit = limit }
        public var percent: Double { limit > 0 ? used / limit * 100 : 0 }
        /// "12 of 50".
        public var label: String { "\(Int(used).formatted()) of \(Int(limit).formatted())" }
    }
    /// USD the key spent today, this week, and this month (UTC), and in all.
    public struct Spent: Codable, Sendable, Hashable {
        public var day: Double
        public var week: Double
        public var month: Double
        public var total: Double
        public init(day: Double = 0, week: Double = 0, month: Double = 0, total: Double = 0) { self.day = day; self.week = week; self.month = month; self.total = total }

        enum CodingKeys: String, CodingKey { case day, week, month, total }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            day = c.value(.day, default: 0)
            week = c.value(.week, default: 0)
            month = c.value(.month, default: 0)
            total = c.value(.total, default: 0)
        }
    }
    /// The key's own spending cap and what's left of it.
    public struct KeyLimit: Codable, Sendable, Hashable {
        public var limit: Double
        public var remaining: Double
        public init(limit: Double, remaining: Double) { self.limit = limit; self.remaining = remaining }
        public var used: Double { max(0, limit - remaining) }
    }
    /// The account's credits: bought, and used.
    public struct Credits: Codable, Sendable, Hashable {
        public var total: Double
        public var used: Double
        public init(total: Double, used: Double) { self.total = total; self.used = used }
    }

    public var freeRequests: FreeRequests?
    public var spent: Spent
    /// nil when the key has no cap.
    public var keyLimit: KeyLimit?
    /// nil when the key can't read them.
    public var credits: Credits?

    public init(freeRequests: FreeRequests? = nil, spent: Spent = .init(), keyLimit: KeyLimit? = nil, credits: Credits? = nil) {
        self.freeRequests = freeRequests; self.spent = spent; self.keyLimit = keyLimit; self.credits = credits
    }

    enum CodingKeys: String, CodingKey { case freeRequests, spent, keyLimit, credits }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        freeRequests = c.value(.freeRequests, default: nil)
        spent = c.value(.spent, default: .init())
        keyLimit = c.value(.keyLimit, default: nil)
        credits = c.value(.credits, default: nil)
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
    /// OpenCode Go, ChatGPT, Command Code, and OpenRouter only.
    public var connected: Bool?
    /// OpenCode Go only.
    public var limits: OpenCodeLimits?
    public var limitsError: String?
    /// Command Code only.
    public var spent: CommandCodeSpent?
    /// OpenRouter only: the key's live numbers, nil when it isn't connected or they couldn't be read (then `accountError` may say why).
    public var account: OpenRouterAccount?
    public var accountError: String?

    public init(responses: Int = 0, inputTokens: Double = 0, outputTokens: Double = 0, cacheReadTokens: Double = 0, totalTokens: Double = 0,
                listCost: Double = 0, byModel: [ModelUsageRow] = [], byChat: [ChatUsageRow] = [], connected: Bool? = nil,
                limits: OpenCodeLimits? = nil, limitsError: String? = nil, spent: CommandCodeSpent? = nil,
                account: OpenRouterAccount? = nil, accountError: String? = nil) {
        self.responses = responses; self.inputTokens = inputTokens; self.outputTokens = outputTokens; self.cacheReadTokens = cacheReadTokens
        self.totalTokens = totalTokens; self.listCost = listCost; self.byModel = byModel; self.byChat = byChat; self.connected = connected
        self.limits = limits; self.limitsError = limitsError; self.spent = spent; self.account = account; self.accountError = accountError
    }

    enum CodingKeys: String, CodingKey {
        case responses, inputTokens, outputTokens, cacheReadTokens, totalTokens, listCost, byModel, byChat, connected, limits, limitsError, spent, account, accountError
    }
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
        spent = c.value(.spent, default: nil)
        account = c.value(.account, default: nil)
        accountError = c.value(.accountError, default: nil)
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
        public var durationLabel: String { UsageFormat.duration(hours: hours) }
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
    /// Tokens on the ChatGPT plan, at API list prices. Empty in an older agent's report.
    public var chatgpt: ModelUsage
    /// At the rates Command Code's plan counts against its allowance, with `spent`. Empty in an older agent's report.
    public var commandcode: ModelUsage
    /// Its free models' tokens (at $0), with `account`. Empty in an older agent's report.
    public var openrouter: ModelUsage
    public var boat: BoatUsage
    public var cloudflare: CloudflareUsage
    public var daily: [DailySpend]

    public init(range: UsageRange, since: Double, until: Double, cline: ModelUsage = .init(), opencode: ModelUsage = .init(), chatgpt: ModelUsage = .init(),
                commandcode: ModelUsage = .init(), openrouter: ModelUsage = .init(), boat: BoatUsage = .init(), cloudflare: CloudflareUsage = .init(),
                daily: [DailySpend] = []) {
        self.range = range; self.since = since; self.until = until; self.cline = cline; self.opencode = opencode; self.chatgpt = chatgpt
        self.commandcode = commandcode; self.openrouter = openrouter; self.boat = boat; self.cloudflare = cloudflare; self.daily = daily
    }

    enum CodingKeys: String, CodingKey { case range, since, until, cline, opencode, chatgpt, commandcode, openrouter, boat, cloudflare, daily }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        range = c.value(.range, default: .month)
        since = c.value(.since, default: 0)
        until = c.value(.until, default: 0)
        cline = c.value(.cline, default: .init())
        opencode = c.value(.opencode, default: .init())
        chatgpt = c.value(.chatgpt, default: .init())
        commandcode = c.value(.commandcode, default: .init())
        openrouter = c.value(.openrouter, default: .init())
        boat = c.value(.boat, default: .init())
        cloudflare = c.value(.cloudflare, default: .init())
        daily = c.value(.daily, default: [])
    }

    public func usage(_ subscription: UsageSubscription) -> ModelUsage {
        switch subscription {
        case .clinepass: cline
        case .opencodeGo: opencode
        case .commandcode: commandcode
        case .chatgpt: chatgpt
        case .openrouter: openrouter
        }
    }

    /// Whether the subscription is connected now (ClinePass's comes from the synced state).
    public func isLinked(_ subscription: UsageSubscription, clineConnected: Bool) -> Bool {
        subscription == .clinepass ? clineConnected : usage(subscription).connected == true
    }

    /// The subscriptions the page shows: each appears once it's connected or was used in the period.
    public func visibleSubscriptions(clineConnected: Bool) -> [UsageSubscription] {
        UsageSubscription.allCases.filter { isLinked($0, clineConnected: clineConnected) || usage($0).totalTokens > 0 }
    }

    /// The daily chart's series: boat.dev, Cloudflare, and the visible subscriptions, in the fixed order.
    public func chartSeries(clineConnected: Bool) -> [UsageSeries] {
        let visible = Set(visibleSubscriptions(clineConnected: clineConnected).map(\.series))
        return UsageSeries.allCases.filter { $0 == .boat || $0 == .cloudflare || visible.contains($0) }
    }

    /// What this month's bill is made of: the flat plans Dex knows about, plus VM time.
    public struct Bill: Sendable, Hashable {
        public struct Part: Sendable, Hashable, Identifiable {
            public var series: UsageSeries
            public var value: Double
            public var id: UsageSeries { series }
        }
        public var parts: [Part]
        public var plans: Double
        public var total: Double
    }

    public func bill(clineConnected: Bool) -> Bill {
        var parts = visibleSubscriptions(clineConnected: clineConnected).compactMap { subscription -> Bill.Part? in
            guard let fee = subscription.fee, isLinked(subscription, clineConnected: clineConnected) else { return nil }
            return Bill.Part(series: subscription.series, value: fee)
        }
        parts.append(Bill.Part(series: .cloudflare, value: PlanFees.workersPaid))
        let plans = parts.reduce(0) { $0 + $1.value }
        parts.append(Bill.Part(series: .boat, value: boat.cost))
        return Bill(parts: parts, plans: plans, total: plans + boat.cost)
    }

    /// The Overview's headline: this month's estimated bill, or VM time for other ranges (plans are monthly).
    public func headline(clineConnected: Bool) -> (label: String, value: Double, detail: String) {
        let bill = bill(clineConnected: clineConnected)
        return range == .month
            ? ("Estimated bill this month", bill.total, "\(UsageFormat.usd(bill.plans)) in plans + \(UsageFormat.usd(boat.cost)) of VM time")
            : ("VM time in this period", boat.cost, "Plans add \(UsageFormat.usd(bill.plans)) a month")
    }

    /// A subscription's allowance as one share-used number for the Services list (OpenCode Go's live month, Command Code's
    /// estimated 30 days, OpenRouter's live free requests today).
    public func meter(_ subscription: UsageSubscription) -> (percent: Double, label: String)? {
        switch subscription {
        case .opencodeGo: opencode.limits.map { ($0.monthly.percent, "of this month's allowance") }
        case .commandcode: commandcode.spent.map { $0.month / CommandCodeLimits.month * 100 }.map { ($0, "of 30 days' allowance") }
        case .openrouter: openRouterFreeRequests.map { ($0.percent, "of today's free requests") }
        default: nil
        }
    }

    /// OpenRouter's free-model requests today, while its key is connected and OpenRouter answered.
    public var openRouterFreeRequests: OpenRouterAccount.FreeRequests? {
        openrouter.connected == true ? openrouter.account?.freeRequests : nil
    }

    /// The Services list's line about a subscription's usage.
    public func serviceSummary(_ subscription: UsageSubscription) -> String {
        let usage = usage(subscription)
        if subscription == .openrouter, let free = openRouterFreeRequests {
            return "\(UsageFormat.compact(usage.totalTokens)) tokens · \(free.label) free today"
        }
        return "\(UsageFormat.compact(usage.totalTokens)) tokens · \(UsageFormat.usd(usage.listCost)) \(subscription.rates)"
    }

    /// Command Code's estimated windows: label, spent, cap.
    public var commandCodeWindows: [(label: String, spent: Double, cap: Double)] {
        let spent = commandcode.spent ?? .init()
        return [("Last 5 hours", spent.fiveHours, CommandCodeLimits.fiveHours), ("Last 7 days", spent.week, CommandCodeLimits.week),
                ("Last 30 days", spent.month, CommandCodeLimits.month)]
    }

    /// A model's row tagged with its subscription, for the combined table.
    public struct TaggedModelRow: Sendable, Hashable, Identifiable {
        public var row: ModelUsageRow
        public var subscription: UsageSubscription
        public var id: String { subscription.rawValue + "|" + row.model }
    }

    /// Every visible subscription's usage summed (the Models tab's "All").
    public struct Combined: Sendable, Hashable {
        public var responses: Int
        public var totalTokens: Double
        public var outputTokens: Double
        public var cacheReadTokens: Double
        public var listCost: Double
        /// By value, highest first.
        public var byModel: [TaggedModelRow]
        /// A chat used on several subscriptions is one row; the ten highest by value.
        public var topChats: [ChatUsageRow]
    }

    public func combined(_ subscriptions: [UsageSubscription]) -> Combined {
        let all = subscriptions.map { ($0, usage($0)) }
        let byModel = all.flatMap { subscription, usage in usage.byModel.map { TaggedModelRow(row: $0, subscription: subscription) } }
            .sorted { $0.row.listCost > $1.row.listCost }
        var chats: [String: ChatUsageRow] = [:]
        var order: [String] = []
        for chat in all.flatMap({ $0.1.byChat }) {
            if var merged = chats[chat.sessionId] {
                merged.totalTokens += chat.totalTokens
                merged.listCost += chat.listCost
                chats[chat.sessionId] = merged
            } else {
                chats[chat.sessionId] = chat
                order.append(chat.sessionId)
            }
        }
        let top = order.compactMap { chats[$0] }.enumerated().sorted { $0.element.listCost != $1.element.listCost ? $0.element.listCost > $1.element.listCost : $0.offset < $1.offset }
            .prefix(10).map(\.element)
        return Combined(
            responses: all.reduce(0) { $0 + $1.1.responses }, totalTokens: all.reduce(0) { $0 + $1.1.totalTokens },
            outputTokens: all.reduce(0) { $0 + $1.1.outputTokens }, cacheReadTokens: all.reduce(0) { $0 + $1.1.cacheReadTokens },
            listCost: all.reduce(0) { $0 + $1.1.listCost }, byModel: byModel, topChats: Array(top)
        )
    }

    /// Cloudflare's most used included allowance, 0–1, when the analytics are in and the range is a month or shorter.
    public var cloudflareTopAllowance: Double? {
        guard cloudflare.configured, cloudflare.error == nil, range != .all else { return nil }
        return cloudflare.lines.compactMap(\.allowanceUsed).max() ?? 0
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

    /// "<0.1%", "12.5%" (a 0–1 share).
    public static func share(_ value: Double) -> String { value < 0.001 ? "<0.1%" : String(format: "%.1f%%", value * 100) }

    /// "25 min" or "1.5 h".
    public static func duration(hours: Double) -> String { hours < 1 ? "\(Int((hours * 60).rounded())) min" : String(format: "%.1f h", hours) }

    /// "980", "1.2K", "3.4M".
    public static func compact(_ value: Double) -> String {
        value.formatted(.number.notation(.compactName).precision(.fractionLength(0...(value < 1000 ? 0 : 1))).locale(Locale(identifier: "en_US")))
    }
}
