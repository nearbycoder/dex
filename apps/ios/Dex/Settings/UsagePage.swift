import Charts
import DexCore
import SwiftUI

/// Spending and usage across ClinePass, OpenCode Go, ChatGPT, boat.dev, and Cloudflare (the web's Usage page).
struct UsagePage: View {
    @Environment(DexClient.self) private var client
    @AppStorage("dex.usage.range") private var range: UsageRange = .month
    @State private var reports: [UsageRange: UsageReport] = [:]
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        let report = reports[range]
        Form {
            Section {
                Picker("Range", selection: $range) {
                    ForEach(UsageRange.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
                .accessibilityIdentifier("usage.range")
            }
            if let error {
                Section { InlineMessage(tone: .error, text: error) }
            }
            if let report {
                UsageReportSections(report: report, clineConnected: client.state?.cline.connected ?? true)
            } else {
                UsageSkeleton()
            }
        }
        .listSectionSpacing(.compact)
        .navigationTitle("Usage")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await load() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                        .symbolEffect(.rotate, isActive: loading)
                }
                .disabled(loading)
                .keyboardShortcut("r", modifiers: .command)
                .accessibilityIdentifier("usage.refresh")
            }
        }
        .refreshable { await load() }
        .task(id: TaskKey(range: range, connected: client.isConnected)) { await load() }
    }

    private struct TaskKey: Equatable { let range: UsageRange; let connected: Bool }

    private func load() async {
        guard client.isConnected else { return }
        let range = range
        loading = true
        defer { loading = false }
        do {
            reports[range] = try await client.call("usageReport", .string(range.rawValue), as: UsageReport.self, timeout: 60)
            error = nil
        } catch {
            self.error = "Couldn't load usage: \(error.localizedDescription)"
        }
    }
}

extension DailySpend {
    /// "Oct 19" (the day is a UTC date).
    var label: String {
        guard let day else { return date }
        var style = Date.FormatStyle.dateTime.month(.abbreviated).day()
        style.timeZone = TimeZone(identifier: "UTC")!
        return day.formatted(style)
    }
}

extension UsageSeries {
    /// The web's validated categorical slots, in fixed order (checked against light and dark surfaces).
    var color: Color {
        switch self {
        case .cline: Color(red: 0x39 / 255, green: 0x87 / 255, blue: 0xE5 / 255)
        case .boat: Color(red: 0xD9 / 255, green: 0x59 / 255, blue: 0x26 / 255)
        case .cloudflare: Color(red: 0x19 / 255, green: 0x9E / 255, blue: 0x70 / 255)
        case .opencode: Color(red: 0xC9 / 255, green: 0x85 / 255, blue: 0x00 / 255)
        case .chatgpt: Color(red: 0xD5 / 255, green: 0x51 / 255, blue: 0x81 / 255)
        }
    }
}

private struct Swatch: View {
    let series: UsageSeries
    var body: some View {
        RoundedRectangle(cornerRadius: 3).fill(series.color).frame(width: 10, height: 10).accessibilityHidden(true)
    }
}

private struct UsageReportSections: View {
    @Environment(Router.self) private var router
    let report: UsageReport
    let clineConnected: Bool
    @State private var view = "chart"

    var body: some View {
        let summary = report.summary(clineConnected: clineConnected)
        Section {
            VStack(alignment: .leading, spacing: 4) {
                Text(summary.headlineLabel).font(.subheadline).foregroundStyle(.secondary)
                Text(UsageFormat.usd(summary.headline))
                    .font(.system(.largeTitle, design: .rounded).weight(.semibold))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .accessibilityIdentifier("usage.headline")
                Text(summary.headlineDetail).font(.footnote).foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
            if summary.showCline {
                ServiceRow(series: .cline, value: "\(UsageFormat.usd(PlanFees.clinePass))/mo",
                           detail: "\(UsageFormat.compact(report.cline.totalTokens)) tokens · \(UsageFormat.usd(report.cline.listCost)) at list prices")
            }
            if summary.showOpenCode {
                ServiceRow(series: .opencode, value: "\(UsageFormat.usd(PlanFees.openCodeGo))/mo",
                           detail: "\(UsageFormat.compact(report.opencode.totalTokens)) tokens · \(UsageFormat.usd(report.opencode.listCost)) at Go rates"
                               + (report.opencode.limits.map { "\n\(Int($0.monthly.percent.rounded()))% of this month's allowance" } ?? ""))
            }
            if summary.showChatGPT {
                ServiceRow(series: .chatgpt, value: "\(UsageFormat.compact(report.chatgpt.totalTokens)) tokens",
                           detail: "\(UsageFormat.usd(report.chatgpt.listCost)) at list prices · on your ChatGPT plan, not in the estimate")
            }
            ServiceRow(series: .boat, value: UsageFormat.usd(report.boat.cost),
                       detail: String(format: "%.1f h of VM time", report.boat.hours) + (report.boat.running ? " · running now" : ""))
            ServiceRow(series: .cloudflare, value: "\(UsageFormat.usd(PlanFees.workersPaid))/mo",
                       detail: report.cloudflare.configured
                           ? (report.cloudflare.error != nil ? "Analytics unavailable right now" : "\(UsageFormat.usd(report.cloudflare.meteredCost)) of metered usage, inside the plan's included allowance")
                           : "Add an analytics token to see usage")
        }

        Section {
            Legend(series: summary.series)
            if view == "chart" {
                DailyChart(daily: report.daily, series: summary.series)
            } else {
                DailyTable(daily: report.daily, series: summary.series)
            }
        } header: {
            HStack {
                Text("Daily Usage")
                Spacer()
                Picker("View", selection: $view) {
                    Image(systemName: "chart.bar.xaxis").accessibilityLabel("Chart").tag("chart")
                    Image(systemName: "tablecells").accessibilityLabel("Table").tag("table")
                }
                .pickerStyle(.segmented)
                .fixedSize()
                .accessibilityIdentifier("usage.view")
            }
        } footer: {
            Text("ClinePass and ChatGPT are shown at what their tokens would cost at API list prices and OpenCode Go at Go's rates; you pay their flat plans. Cloudflare is metered usage at list rates, before the plan's included allowance.")
        }

        if summary.showOpenCode {
            Section {
                if let limits = report.opencode.limits {
                    AllowanceMeter(label: "5-hour window", window: limits.rolling)
                    AllowanceMeter(label: "This week", window: limits.weekly)
                    AllowanceMeter(label: "This month", window: limits.monthly)
                } else {
                    Text(report.opencode.limitsError.map { "Couldn't read it from OpenCode: \($0)" } ?? "Connect OpenCode Go in Settings to see it.")
                        .font(.footnote)
                        .foregroundStyle(report.opencode.limitsError == nil ? Color.secondary : Color.orange)
                }
                ExternalLink(title: "OpenCode console", url: "https://opencode.ai/auth")
            } header: {
                HStack(spacing: 6) { Swatch(series: .opencode); Text("OpenCode Go Allowance") }
            } footer: {
                Text("Go's included usage is a dollar amount per month, counted at each model's rates. Any 5 hours may use up to 20% of it and any week 50%. Read live from OpenCode.")
            }
            ModelUsageSections(title: "OpenCode Go by Model", series: .opencode, usage: report.opencode, costLabel: "at Go rates")
        }
        if summary.showCline {
            ModelUsageSections(title: "ClinePass by Model", series: .cline, usage: report.cline, costLabel: "list price")
        }
        if summary.showChatGPT {
            ModelUsageSections(title: "ChatGPT by Model", series: .chatgpt, usage: report.chatgpt, costLabel: "list price")
        }

        Section {
            if report.boat.runs.isEmpty {
                Text("The VM did not run in this period.").foregroundStyle(.secondary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(report.boat.bySize) { size in
                            Text("\(size.size) · \(String(format: "%.1f", size.hours)) h · \(UsageFormat.usd(size.cost))")
                                .font(.caption.monospacedDigit())
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(.quaternary.opacity(0.6), in: .capsule)
                        }
                    }
                }
                ForEach(report.boat.runs) { run in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Format.dateTime(run.startedAt))
                            Text(run.endedAt == nil ? "\(run.size) · running" : run.size)
                                .font(.caption)
                                .foregroundStyle(run.endedAt == nil ? .green : .secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(UsageFormat.usd(run.cost)).monospacedDigit()
                            Text(run.durationLabel).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        } header: {
            HStack(spacing: 6) { Swatch(series: .boat); Text("boat.dev VM Time") }
        } footer: {
            Text("Billed per second.")
        }

        Section {
            if !report.cloudflare.configured {
                Text("Cloudflare usage comes from its Analytics API, which needs a read-only token: in the Cloudflare dashboard, My Profile → API Tokens → Create Token → Custom token with Account · Account Analytics · Read, then run `npx wrangler secret put CLOUDFLARE_API_TOKEN` and paste it.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if let error = report.cloudflare.error {
                InlineMessage(tone: .warning, text: error)
            } else {
                ForEach(report.cloudflare.lines) { line in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(line.label)
                            if line.accountWide == true { Text("whole account").font(.caption2).foregroundStyle(.secondary) }
                            Spacer()
                            Text(UsageFormat.usd(line.cost)).monospacedDigit()
                        }
                        Text("\(UsageFormat.compact(line.quantity)) \(line.unit)").font(.caption).foregroundStyle(.secondary)
                        if let used = line.allowanceUsed {
                            Gauge(value: min(1, max(0, used))) {
                                EmptyView()
                            } currentValueLabel: {
                                Text(used < 0.001 ? "<0.1% of the monthly allowance" : String(format: "%.1f%% of the monthly allowance", used * 100))
                            }
                            .gaugeStyle(.linearCapacity)
                            .tint(UsageSeries.cloudflare.color)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        } header: {
            HStack(spacing: 6) {
                Swatch(series: .cloudflare)
                Text("Cloudflare")
                if report.cloudflare.configured {
                    Spacer()
                    Text("since \(Format.date(report.cloudflare.since))").textCase(nil)
                }
            }
        } footer: {
            Text("Estimates from Dex's own records (model responses, VM run times) and Cloudflare's analytics, priced at public list rates (ClinePass \(UsageFormat.usd(PlanFees.clinePass))/mo, OpenCode Go \(UsageFormat.usd(PlanFees.openCodeGo))/mo, Workers Paid \(UsageFormat.usd(PlanFees.workersPaid))/mo, boat.dev small $0.018/h). Your invoices are the source of truth.")
        }
    }
}

private struct ServiceRow: View {
    let series: UsageSeries
    let value: String
    let detail: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Swatch(series: series)
            VStack(alignment: .leading, spacing: 2) {
                Text(series.label)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(value).font(.body.weight(.semibold)).monospacedDigit()
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("usage.service.\(series.rawValue)")
    }
}

private struct Legend: View {
    let series: [UsageSeries]
    var body: some View {
        HStack(spacing: 14) {
            ForEach(series) { item in
                HStack(spacing: 5) {
                    Swatch(series: item)
                    Text(item.label)
                }
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }
}

/// Daily cost as stacked bars by service; touch (or hover) a day for its breakdown.
private struct DailyChart: View {
    let daily: [DailySpend]
    let series: [UsageSeries]
    @State private var selected: Date?

    var body: some View {
        let days = daily.compactMap { day in day.day.map { (date: $0, spend: day) } }
        let picked = selected.flatMap { date in days.min { abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date)) } }
        Chart {
            ForEach(days, id: \.spend.date) { day in
                ForEach(series) { item in
                    BarMark(x: .value("Day", day.date, unit: .day), y: .value("Cost", day.spend.value(item)), width: .ratio(0.6))
                        .foregroundStyle(by: .value("Service", item.label))
                        .opacity(picked == nil || picked?.spend.date == day.spend.date ? 1 : 0.45)
                }
            }
            if let picked {
                RuleMark(x: .value("Day", picked.date, unit: .day))
                    .foregroundStyle(.secondary.opacity(0.25))
                    .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        DayTooltip(spend: picked.spend, series: series)
                    }
            }
        }
        .chartForegroundStyleScale(domain: series.map(\.label), range: series.map(\.color))
        .chartLegend(.hidden)
        .chartYAxis {
            AxisMarks(values: .automatic(desiredCount: 3)) { value in
                AxisGridLine().foregroundStyle(Color(uiColor: .separator))
                AxisValueLabel { if let cost = value.as(Double.self) { Text(UsageFormat.usd(cost)) } }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 5)) { _ in
                AxisValueLabel(format: .dateTime.month(.abbreviated).day(), centered: true)
            }
        }
        .chartXSelection(value: $selected)
        .frame(height: 220)
        .padding(.top, picked == nil ? 0 : 0)
        .accessibilityLabel("Daily usage cost by service")
        .accessibilityIdentifier("usage.chart")
    }
}

private struct DayTooltip: View {
    let spend: DailySpend
    let series: [UsageSeries]

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(spend.label)
                .font(.caption.weight(.semibold))
            ForEach(series) { item in
                HStack(spacing: 6) {
                    Swatch(series: item)
                    Text(item.label)
                    Spacer(minLength: 12)
                    Text(UsageFormat.usd(spend.value(item))).monospacedDigit()
                }
            }
            Divider()
            HStack {
                Text("Total")
                Spacer()
                Text(UsageFormat.usd(spend.total(series))).monospacedDigit()
            }
            .fontWeight(.medium)
        }
        .font(.caption2)
        .padding(10)
        .frame(width: 180)
        .glassEffect(.regular, in: .rect(cornerRadius: 14))
    }
}

/// The same numbers as rows, newest first (the chart's accessible alternative).
private struct DailyTable: View {
    let daily: [DailySpend]
    let series: [UsageSeries]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .trailing, horizontalSpacing: 14, verticalSpacing: 6) {
                GridRow {
                    Text("Date").gridColumnAlignment(.leading)
                    ForEach(series) { Text($0.label) }
                    Text("Total")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                Divider()
                ForEach(daily.reversed()) { day in
                    GridRow {
                        Text(day.label)
                        ForEach(series) { Text(UsageFormat.usd(day.value($0))) }
                        Text(UsageFormat.usd(day.total(series))).fontWeight(.medium)
                    }
                    .font(.caption.monospacedDigit())
                }
            }
            .padding(.vertical, 4)
        }
        .frame(maxHeight: 320)
        .accessibilityIdentifier("usage.table")
    }
}

/// One allowance window: share used, status in words and color, and when it resets.
private struct AllowanceMeter: View {
    let label: String
    let window: OpenCodeWindow

    var body: some View {
        let percent = window.clampedPercent
        let tint: Color = window.limited || percent >= 100 ? .red : percent >= 80 ? .orange : UsageSeries.opencode.color
        Gauge(value: percent, in: 0...100) {
            HStack {
                Text(label)
                Spacer()
                Text(window.limited ? "Limit reached" : "\(Int(percent.rounded()))% used")
                    .foregroundStyle(window.limited ? .red : .primary)
                    .fontWeight(window.limited ? .semibold : .regular)
                Text("· \(window.resetsLabel())").foregroundStyle(.secondary)
            }
            .font(.subheadline)
        }
        .gaugeStyle(.linearCapacity)
        .tint(tint)
        .accessibilityLabel("\(label): \(Int(percent.rounded()))% used, \(window.resetsLabel())")
        .accessibilityIdentifier("usage.allowance.\(label)")
    }
}

/// A subscription's tokens by model, and its top chats (tap one to open it).
private struct ModelUsageSections: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let title: String
    let series: UsageSeries
    let usage: ModelUsage
    let costLabel: String

    var body: some View {
        Section {
            if usage.byModel.isEmpty {
                Text("No model usage in this period.").foregroundStyle(.secondary)
            }
            ForEach(usage.byModel) { row in
                HStack(spacing: 10) {
                    MakerLogo(maker: client.catalog.model(row.model)?.maker ?? "", size: 18)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(client.catalog.name(of: row.model))
                        Text("\(row.responses) responses · \(UsageFormat.compact(row.totalTokens)) tokens").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(UsageFormat.usd(row.listCost)).monospacedDigit()
                }
                .accessibilityElement(children: .combine)
            }
        } header: {
            HStack(spacing: 6) {
                Swatch(series: series)
                Text(title)
                Spacer()
                Text("\(UsageFormat.compact(usage.totalTokens)) tokens").textCase(nil)
            }
        } footer: {
            Text("Costs \(costLabel).")
        }
        if !usage.byChat.isEmpty {
            Section("Top Chats · \(series.label)") {
                ForEach(usage.byChat) { chat in
                    Button {
                        router.openChat(chat.sessionId)
                    } label: {
                        HStack {
                            Text(chat.title).foregroundStyle(chat.isDeleted ? .secondary : .primary).lineLimit(1)
                            Spacer()
                            Text("\(UsageFormat.compact(chat.totalTokens)) · \(UsageFormat.usd(chat.listCost))")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                            if !chat.isDeleted { Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary) }
                        }
                    }
                    .disabled(chat.isDeleted)
                    .accessibilityIdentifier("usage.chat.\(chat.sessionId)")
                }
            }
        }
    }
}

/// Placeholder sections while a report loads, in the real sections' shapes.
private struct UsageSkeleton: View {
    var body: some View {
        Section {
            LineBone(width: 160, font: .subheadline)
            LineBone(width: 120, font: .largeTitle)
            ForEach(0..<3, id: \.self) { _ in LineBone(width: 240) }
        }
        Section {
            RoundedRectangle(cornerRadius: 12).fill(.quaternary.opacity(0.5)).frame(height: 220)
        }
        Section {
            ForEach(0..<3, id: \.self) { _ in LineBone(width: 200) }
        }
        .accessibilityIdentifier("usage.skeleton")
    }
}
