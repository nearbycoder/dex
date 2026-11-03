import Charts
import DexCore
import SwiftUI

/// The Usage page's sections (the web's tabs).
enum UsageTab: String, CaseIterable, Identifiable {
    case overview, models, machines, cloudflare
    var id: String { rawValue }
    var label: String {
        switch self {
        case .overview: "Overview"
        case .models: "Models"
        case .machines: "Machines"
        case .cloudflare: "Cloudflare"
        }
    }
}

/// Spending and usage across ClinePass, OpenCode Go, Command Code, ChatGPT, boat.dev, and Cloudflare (the web's Usage
/// page): Overview (the bill, one row per service, daily spend), Models (all subscriptions or one, with allowance
/// meters), Machines, and Cloudflare.
struct UsagePage: View {
    @Environment(DexClient.self) private var client
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @AppStorage("dex.usage.range") private var range: UsageRange = .month
    @State private var tab: UsageTab = .overview
    /// On the Models tab: one subscription instead of all of them.
    @State private var provider: UsageSubscription?
    @State private var reports: [UsageRange: UsageReport] = [:]
    @State private var loading = false
    @State private var error: String?
    @State private var width: CGFloat = 400

    var body: some View {
        let report = reports[range]
        let clineConnected = client.state?.cline.connected ?? true
        Form {
            Section {
                tabPicker
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            if let error {
                Section { InlineMessage(tone: .error, text: error) }
            }
            if let report {
                switch tab {
                case .overview: UsageOverview(report: report, clineConnected: clineConnected, tab: $tab, provider: $provider)
                case .models: UsageModels(report: report, clineConnected: clineConnected, provider: $provider)
                case .machines: UsageMachines(report: report)
                case .cloudflare: UsageCloudflare(report: report)
                }
                Section {
                } footer: {
                    Text("Estimates from Dex's own records (model responses, VM run times) and Cloudflare's analytics, priced at public list rates (ClinePass \(UsageFormat.usd(PlanFees.clinePass))/mo, OpenCode Go \(UsageFormat.usd(PlanFees.openCodeGo))/mo, Command Code Goat \(UsageFormat.usd(PlanFees.commandCode))/mo plus a processing fee, Workers Paid \(UsageFormat.usd(PlanFees.workersPaid))/mo, boat.dev small $0.018/h). Your invoices are the source of truth. VM time before usage tracking started is not included.")
                }
            } else {
                UsageSkeleton()
            }
        }
        .listSectionSpacing(.compact)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .animation(.smooth(duration: 0.25), value: tab)
        .animation(.smooth(duration: 0.25), value: provider)
        .sensoryFeedback(.selection, trigger: tab)
        .navigationTitle("Usage")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Range", selection: $range) {
                        ForEach(UsageRange.allCases) { Text($0.label).tag($0) }
                    }
                } label: {
                    // The short label on the narrowest phones, where the full one crowds the bar.
                    Label(width < 360 ? range.shortLabel : range.label, systemImage: "calendar")
                        .labelStyle(.titleOnly)
                }
                .menuIndicator(.visible)
                .accessibilityLabel("Range: \(range.label)")
                .accessibilityIdentifier("usage.range")
            }
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

    /// Four segments where they fit; a menu on the narrowest screens and at the largest text sizes.
    @ViewBuilder private var tabPicker: some View {
        let picker = Picker("Section", selection: $tab) {
            ForEach(UsageTab.allCases) { Text($0.label).tag($0) }
        }
        .accessibilityIdentifier("usage.tab")
        if width < 340 || dynamicTypeSize.isAccessibilitySize {
            picker.pickerStyle(.menu).padding(.horizontal, 16)
        } else {
            picker.pickerStyle(.segmented)
        }
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
        case .commandcode: Color(red: 0x8B / 255, green: 0x6F / 255, blue: 0xE0 / 255)
        }
    }
}

/// A share-used tint: the series' color, amber nearing the limit, red at it.
private func meterTint(_ percent: Double, limited: Bool = false, color: Color) -> Color {
    limited || percent >= 100 ? .red : percent >= 80 ? .orange : color
}

private struct Swatch: View {
    var color: Color
    var size: CGFloat = 10
    init(series: UsageSeries, size: CGFloat = 10) { color = series.color; self.size = size }
    init(color: Color, size: CGFloat = 10) { self.color = color; self.size = size }
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.3).fill(color).frame(width: size, height: size).accessibilityHidden(true)
    }
}

/// A thin share-used bar.
private struct MiniMeter: View {
    let percent: Double
    let color: Color
    var limited = false
    var height: CGFloat = 6

    var body: some View {
        let clamped = min(100, max(0, percent))
        Capsule()
            .fill(.quaternary)
            .frame(height: height)
            .overlay(alignment: .leading) {
                GeometryReader { geometry in
                    Capsule()
                        .fill(meterTint(clamped, limited: limited, color: color))
                        .frame(width: geometry.size.width * max(clamped, clamped > 0 ? 2 : 0) / 100)
                }
            }
            .accessibilityHidden(true)
    }
}

/// A grid of headline numbers: two across on a phone, four on wider screens.
private struct StatGrid: View {
    struct Item: Identifiable {
        let label: String
        let value: String
        var detail: String?
        var id: String { label }
    }
    let items: [Item]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 16, alignment: .topLeading)], alignment: .leading, spacing: 14) {
            ForEach(items) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.label).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Text(item.value)
                        .font(.title3.weight(.semibold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .contentTransition(.numericText())
                    if let detail = item.detail {
                        Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.vertical, 6)
        .accessibilityIdentifier("usage.stats")
    }
}

// MARK: Overview

private struct UsageOverview: View {
    let report: UsageReport
    let clineConnected: Bool
    @Binding var tab: UsageTab
    @Binding var provider: UsageSubscription?

    var body: some View {
        let visible = report.visibleSubscriptions(clineConnected: clineConnected)
        let bill = report.bill(clineConnected: clineConnected)
        let headline = report.headline(clineConnected: clineConnected)
        Section {
            VStack(alignment: .leading, spacing: 4) {
                Text(headline.label).font(.subheadline).foregroundStyle(.secondary)
                Text(UsageFormat.usd(headline.value))
                    .font(.system(.largeTitle, design: .rounded).weight(.semibold))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .accessibilityIdentifier("usage.headline")
                Text(headline.detail).font(.footnote).foregroundStyle(.secondary)
                if report.range == .month, bill.total > 0 {
                    BillBar(parts: bill.parts.filter { $0.value > 0 })
                        .padding(.top, 10)
                    FlowLayout(spacing: 12) {
                        ForEach(bill.parts) { part in
                            HStack(spacing: 5) {
                                Swatch(series: part.series, size: 8)
                                Text(part.series.label).foregroundStyle(.secondary)
                                Text(UsageFormat.usd(part.value)).monospacedDigit()
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                    .font(.caption)
                    .padding(.top, 6)
                }
            }
            .padding(.vertical, 4)
        }

        Section("Services") {
            ForEach(visible) { subscription in
                let usage = report.usage(subscription)
                ServiceRow(
                    series: subscription.series,
                    price: subscription.fee.map { "\(UsageFormat.usd($0))/mo" } ?? "ChatGPT plan",
                    summary: "\(UsageFormat.compact(usage.totalTokens)) tokens · \(UsageFormat.usd(usage.listCost)) \(subscription.rates)",
                    meter: report.meter(subscription)
                ) {
                    provider = subscription
                    tab = .models
                }
            }
            ServiceRow(series: .boat, price: UsageFormat.usd(report.boat.cost),
                       summary: "\(UsageFormat.duration(hours: report.boat.hours)) of VM time", running: report.boat.running) {
                tab = .machines
            }
            ServiceRow(series: .cloudflare, price: "\(UsageFormat.usd(PlanFees.workersPaid))/mo",
                       summary: report.cloudflare.configured
                           ? (report.cloudflare.error != nil ? "Analytics unavailable right now" : "\(UsageFormat.usd(report.cloudflare.meteredCost)) metered, inside the plan's allowance")
                           : "Add an analytics token to see usage") {
                tab = .cloudflare
            }
        }

        DailyUsage(daily: report.daily, available: report.chartSeries(clineConnected: clineConnected))
    }
}

/// What the bill is made of, as one bar.
private struct BillBar: View {
    let parts: [UsageReport.Bill.Part]

    var body: some View {
        let total = parts.reduce(0) { $0 + $1.value }
        GeometryReader { geometry in
            let gaps = CGFloat(max(0, parts.count - 1)) * 2
            HStack(spacing: 2) {
                ForEach(parts) { part in
                    Rectangle()
                        .fill(part.series.color)
                        .frame(width: max(2, (geometry.size.width - gaps) * part.value / max(total, 0.000_001)))
                }
            }
        }
        .frame(height: 10)
        .clipShape(.capsule)
        .accessibilityElement()
        .accessibilityLabel("What the bill is made of: " + parts.map { "\($0.series.label) \(UsageFormat.usd($0.value))" }.joined(separator: ", "))
        .accessibilityIdentifier("usage.bill")
    }
}

/// A service in the Overview: what it costs and a line about its usage; tapping goes to its tab.
private struct ServiceRow: View {
    let series: UsageSeries
    let price: String
    let summary: String
    var meter: (percent: Double, label: String)?
    var running = false
    let action: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Swatch(series: series)
                VStack(alignment: .leading, spacing: 3) {
                    // Large text: the price goes under the name rather than squeezing both.
                    let layout = dynamicTypeSize.isAccessibilitySize
                        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
                        : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
                    layout {
                        Text(series.label).foregroundStyle(.primary)
                        if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 4) }
                        Text(price).fontWeight(.semibold).monospacedDigit().foregroundStyle(.primary)
                    }
                    Group {
                        if running {
                            Text("\(summary)\(Text(" · running now").foregroundStyle(.green))")
                        } else {
                            Text(summary)
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    if let meter {
                        HStack(spacing: 8) {
                            MiniMeter(percent: meter.percent, color: series.color)
                            Text("\(Int(meter.percent.rounded()))% \(meter.label)")
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(.secondary)
                                .fixedSize()
                        }
                        .padding(.top, 2)
                    }
                }
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("usage.service.\(series.rawValue)")
    }
}

/// Daily spend, with a legend that doubles as a filter: tap a service to hide or show it.
private struct DailyUsage: View {
    let daily: [DailySpend]
    let available: [UsageSeries]
    @State private var view = "chart"
    @State private var hidden: Set<UsageSeries> = []

    var body: some View {
        let shown = available.filter { !hidden.contains($0) }
        Section {
            FlowLayout(spacing: 6) {
                ForEach(available) { item in
                    let on = !hidden.contains(item)
                    Button {
                        if on { hidden.insert(item) } else { hidden.remove(item) }
                    } label: {
                        HStack(spacing: 5) {
                            Swatch(color: on ? item.color : Color(uiColor: .tertiaryLabel), size: 8)
                            Text(item.label).strikethrough(!on)
                        }
                        .font(.caption)
                        .foregroundStyle(on ? .primary : .tertiary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .overlay(Capsule().strokeBorder(Color(uiColor: on ? .separator : .quaternaryLabel)))
                        .contentShape(.capsule)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(item.label)
                    .accessibilityValue(on ? "Shown" : "Hidden")
                    .accessibilityHint("Shows or hides it in the chart")
                    .accessibilityIdentifier("usage.legend.\(item.rawValue)")
                }
            }
            .padding(.vertical, 2)
            .sensoryFeedback(.selection, trigger: hidden)
            if view == "chart" {
                DailyChart(daily: daily, series: shown)
            } else {
                DailyTable(daily: daily, series: shown)
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
            Text("Model subscriptions are shown at what their tokens cost at each model's rates (API list prices, or the rates the plan counts against its allowance); you pay their flat plans. Cloudflare is metered usage at list rates, before the plan's included allowance.")
        }
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
        let empty = days.allSatisfy { $0.spend.total(series) == 0 }
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
        // With nothing to draw, a $0–$1 axis instead of ticks too small to tell apart.
        .chartYScale(domain: empty ? 0...1 : 0...(days.map { $0.spend.total(series) }.max() ?? 1))
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

// MARK: Models

private struct UsageModels: View {
    @Environment(DexClient.self) private var client
    let report: UsageReport
    let clineConnected: Bool
    @Binding var provider: UsageSubscription?

    var body: some View {
        let visible = report.visibleSubscriptions(clineConnected: clineConnected)
        let combined = report.combined(visible)
        // A subscription that's no longer shown falls back to All.
        let chosen = provider.flatMap { visible.contains($0) ? $0 : nil }
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    FilterChip(title: "All", tokens: combined.totalTokens, color: nil, selected: chosen == nil) { provider = nil }
                        .accessibilityIdentifier("usage.provider.all")
                    ForEach(visible) { subscription in
                        FilterChip(title: subscription.label, tokens: report.usage(subscription).totalTokens, color: subscription.series.color,
                                   selected: chosen == subscription) { provider = subscription }
                            .accessibilityIdentifier("usage.provider.\(subscription.rawValue)")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 2)
            }
            .scrollClipDisabled()
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            .sensoryFeedback(.selection, trigger: chosen)
        }

        if visible.isEmpty {
            Section {
                ContentUnavailableView("No Model Subscriptions", systemImage: "cpu",
                                       description: Text("Connect ClinePass, OpenCode Go, Command Code, or ChatGPT in Settings → Model Subscriptions."))
            }
        } else if let chosen {
            SubscriptionDetail(report: report, subscription: chosen)
        } else {
            Section {
                StatGrid(items: [
                    .init(label: "Responses", value: UsageFormat.compact(Double(combined.responses))),
                    .init(label: "Tokens", value: UsageFormat.compact(combined.totalTokens), detail: "\(UsageFormat.compact(combined.outputTokens)) output"),
                    .init(label: "Cached input", value: UsageFormat.compact(combined.cacheReadTokens)),
                    .init(label: "Worth at model rates", value: UsageFormat.usd(combined.listCost), detail: "covered by your plans")
                ])
            }
            ModelTable(title: "By Model", rows: combined.byModel.map { ($0.row, $0.subscription.series) },
                       footer: "Each subscription's tokens at its rates: API list prices for ClinePass and ChatGPT, the plans' own rates for OpenCode Go and Command Code.")
            TopChats(chats: combined.topChats)
        }
    }
}

private struct FilterChip: View {
    let title: String
    let tokens: Double
    let color: Color?
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let color { Swatch(color: color, size: 8) }
                Text(title)
                Text(UsageFormat.compact(tokens)).foregroundStyle(selected ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tertiary)).monospacedDigit()
            }
            .font(.subheadline)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(selected ? AnyShapeStyle(.tint.opacity(0.18)) : AnyShapeStyle(.quaternary.opacity(0.5)), in: .capsule)
            .overlay(Capsule().strokeBorder(selected ? AnyShapeStyle(.tint.opacity(0.5)) : AnyShapeStyle(.clear)))
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(UsageFormat.compact(tokens)) tokens")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct SubscriptionDetail: View {
    let report: UsageReport
    let subscription: UsageSubscription

    var body: some View {
        let usage = report.usage(subscription)
        Section {
            StatGrid(items: [
                .init(label: "Plan", value: subscription.fee.map { "\(UsageFormat.usd($0))/mo" } ?? "ChatGPT",
                      detail: subscription.fee == nil ? "your ChatGPT plan" : "flat fee"),
                .init(label: "Responses", value: UsageFormat.compact(Double(usage.responses))),
                .init(label: "Tokens", value: UsageFormat.compact(usage.totalTokens),
                      detail: "\(UsageFormat.compact(usage.inputTokens + usage.cacheReadTokens)) in · \(UsageFormat.compact(usage.outputTokens)) out"),
                .init(label: "Worth", value: UsageFormat.usd(usage.listCost), detail: subscription.rates)
            ])
        }
        switch subscription {
        case .opencodeGo: OpenCodeAllowance(usage: report.opencode)
        case .commandcode: CommandCodeAllowance(report: report)
        default: EmptyView()
        }
        ModelTable(title: "By Model", rows: usage.byModel.map { ($0, nil) }, footer: "Costs \(subscription.rates).")
        TopChats(chats: usage.byChat)
    }
}

/// OpenCode Go's allowance, read live from OpenCode.
private struct OpenCodeAllowance: View {
    let usage: ModelUsage

    var body: some View {
        Section {
            if let limits = usage.limits {
                AllowanceMeter(label: "5-hour window", percent: limits.rolling.clampedPercent, limited: limits.rolling.limited, color: UsageSeries.opencode.color,
                               value: limits.rolling.limited ? "Limit reached" : "\(Int(limits.rolling.clampedPercent.rounded()))% used", detail: limits.rolling.resetsLabel())
                AllowanceMeter(label: "This week", percent: limits.weekly.clampedPercent, limited: limits.weekly.limited, color: UsageSeries.opencode.color,
                               value: limits.weekly.limited ? "Limit reached" : "\(Int(limits.weekly.clampedPercent.rounded()))% used", detail: limits.weekly.resetsLabel())
                AllowanceMeter(label: "This month", percent: limits.monthly.clampedPercent, limited: limits.monthly.limited, color: UsageSeries.opencode.color,
                               value: limits.monthly.limited ? "Limit reached" : "\(Int(limits.monthly.clampedPercent.rounded()))% used", detail: limits.monthly.resetsLabel())
            } else {
                Text(usage.limitsError.map { "Couldn't read it from OpenCode: \($0)" } ?? "Connect OpenCode Go in Settings to see it.")
                    .font(.footnote)
                    .foregroundStyle(usage.limitsError == nil ? Color.secondary : Color.orange)
            }
            ExternalLink(title: "OpenCode console", url: "https://opencode.ai/auth")
        } header: {
            HStack(spacing: 6) { Swatch(series: .opencode); Text("Allowance") }
        } footer: {
            Text("Go's included usage is a dollar amount per month, counted at each model's rates. Any 5 hours may use up to 20% of it and any week 50%. Read live from OpenCode.")
        }
    }
}

/// Command Code's Goat allowance against what Dex used; Command Code has no API for its own meters.
private struct CommandCodeAllowance: View {
    let report: UsageReport

    var body: some View {
        Section {
            ForEach(report.commandCodeWindows, id: \.label) { window in
                let percent = window.spent / window.cap * 100
                AllowanceMeter(label: window.label, percent: percent, color: UsageSeries.commandcode.color,
                               value: UsageFormat.usd(window.spent), detail: "of \(UsageFormat.usd(window.cap))")
            }
            ExternalLink(title: "Command Code Studio", url: "https://commandcode.ai/usage")
        } header: {
            HStack(spacing: 6) { Swatch(series: .commandcode); Text("Allowance") }
        } footer: {
            Text("Estimated from Dex's chats only. The Goat plan includes up to \(UsageFormat.usd(CommandCodeLimits.month)) of usage a month at each model's API rates, with up to \(UsageFormat.usd(CommandCodeLimits.fiveHours)) in any 5 hours and \(UsageFormat.usd(CommandCodeLimits.week)) in any week. Command Code's CLI and other clients count too, and its windows start at your first request; Studio shows the exact meters.")
        }
    }
}

/// One allowance window: share used, status in words and color, and when it resets (or its cap).
private struct AllowanceMeter: View {
    let label: String
    let percent: Double
    var limited = false
    let color: Color
    let value: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    Text(label)
                    Spacer()
                    valueText
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                    valueText
                }
            }
            .font(.subheadline)
            MiniMeter(percent: percent, color: color, limited: limited, height: 8)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(Int(min(100, max(0, percent)).rounded()))% used, \(value) \(detail)")
        .accessibilityIdentifier("usage.allowance.\(label)")
    }

    private var valueText: some View {
        Text("\(Text(value).foregroundStyle(limited ? .red : .primary).fontWeight(limited ? .semibold : .regular))\(Text(" · \(detail)").foregroundStyle(.secondary))")
            .monospacedDigit()
    }
}

/// Tokens by model; with a subscription color per row in the combined table.
private struct ModelTable: View {
    @Environment(DexClient.self) private var client
    let title: String
    let rows: [(row: ModelUsageRow, series: UsageSeries?)]
    let footer: String

    var body: some View {
        Section {
            if rows.isEmpty {
                Text("No model usage in this period.").foregroundStyle(.secondary)
            }
            ForEach(rows, id: \.row.model) { item in
                HStack(spacing: 10) {
                    MakerLogo(maker: client.catalog.model(item.row.model)?.maker ?? "", size: 18)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(modelName(item.row.model)).lineLimit(1)
                            if let series = item.series { Swatch(series: series, size: 7).accessibilityLabel(series.label) }
                        }
                        Text("\(item.row.responses) responses · \(UsageFormat.compact(item.row.totalTokens)) tokens").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(UsageFormat.usd(item.row.listCost)).monospacedDigit()
                }
                .accessibilityElement(children: .combine)
            }
        } header: {
            Text(title)
        } footer: {
            Text(footer)
        }
    }

    /// A model's name, or its id without the subscription and maker prefixes if the catalog doesn't have it (yet).
    private func modelName(_ id: String) -> String {
        client.catalog.model(id)?.name ?? id.split(separator: "/").last.map(String.init) ?? id
    }
}

/// The chats that used the most (tap one to open it).
private struct TopChats: View {
    @Environment(Router.self) private var router
    let chats: [ChatUsageRow]

    var body: some View {
        Section("Top Chats") {
            if chats.isEmpty {
                Text("No chats used models in this period.").foregroundStyle(.secondary)
            }
            ForEach(chats) { chat in
                Button {
                    router.openChat(chat.sessionId)
                } label: {
                    HStack {
                        Text(chat.title).foregroundStyle(chat.isDeleted ? .secondary : .primary).lineLimit(1)
                        Spacer()
                        Text("\(UsageFormat.compact(chat.totalTokens)) · \(UsageFormat.usd(chat.listCost))")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .fixedSize()
                        if !chat.isDeleted { Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary) }
                    }
                }
                .disabled(chat.isDeleted)
                .accessibilityIdentifier("usage.chat.\(chat.sessionId)")
            }
        }
    }
}

// MARK: Machines and Cloudflare

private struct UsageMachines: View {
    let report: UsageReport

    var body: some View {
        let boat = report.boat
        Section {
            StatGrid(items: [
                .init(label: "VM time cost", value: UsageFormat.usd(boat.cost), detail: "billed per second"),
                .init(label: "Hours", value: String(format: "%.1f", boat.hours)),
                .init(label: "Runs", value: "\(boat.runs.count)", detail: boat.runs.count >= 20 ? "latest 20 below" : nil),
                .init(label: "Now", value: boat.running ? "Running" : "Stopped")
            ])
        }
        Section {
            if boat.runs.isEmpty {
                Text("The VM did not run in this period.").foregroundStyle(.secondary)
            }
            ForEach(boat.runs) { run in
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
                .accessibilityElement(children: .combine)
            }
        } header: {
            HStack(spacing: 6) { Swatch(series: .boat); Text("boat.dev VM Runs") }
        } footer: {
            if !boat.bySize.isEmpty {
                Text(boat.bySize.map { "\($0.size) \(UsageFormat.duration(hours: $0.hours)) · \(UsageFormat.usd($0.cost))" }.joined(separator: "   "))
            }
        }
    }
}

private struct UsageCloudflare: View {
    let report: UsageReport

    var body: some View {
        let cloudflare = report.cloudflare
        let ready = cloudflare.configured && cloudflare.error == nil
        Section {
            StatGrid(items: [
                .init(label: "Plan", value: "\(UsageFormat.usd(PlanFees.workersPaid))/mo", detail: "Workers Paid"),
                .init(label: "Metered", value: ready ? UsageFormat.usd(cloudflare.meteredCost) : "—", detail: "at list rates"),
                .init(label: "Most used allowance", value: report.cloudflareTopAllowance.map(UsageFormat.share) ?? "—"),
                .init(label: "Since", value: Format.date(cloudflare.since), detail: "Cloudflare keeps ~30 days")
            ])
        }
        Section {
            if !cloudflare.configured {
                Text("Cloudflare usage comes from its Analytics API, which needs a read-only token: in the Cloudflare dashboard, My Profile → API Tokens → Create Token → Custom token with Account · Account Analytics · Read, then run `npx wrangler secret put CLOUDFLARE_API_TOKEN` and paste it.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if let error = cloudflare.error {
                InlineMessage(tone: .warning, text: error)
            } else {
                ForEach(cloudflare.lines) { line in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(line.label)
                            if line.accountWide == true { Text("whole account").font(.caption2).foregroundStyle(.secondary) }
                            Spacer()
                            Text(UsageFormat.usd(line.cost)).monospacedDigit()
                        }
                        Text("\(UsageFormat.compact(line.quantity)) \(line.unit)").font(.caption).foregroundStyle(.secondary)
                        if let used = line.allowanceUsed {
                            HStack(spacing: 8) {
                                MiniMeter(percent: max(1, used * 100), color: UsageSeries.cloudflare.color)
                                Text("\(UsageFormat.share(used)) of the monthly allowance")
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(.secondary)
                                    .fixedSize()
                            }
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        } header: {
            HStack(spacing: 6) { Swatch(series: .cloudflare); Text("Meters") }
        }
    }
}

/// Placeholder sections while a report loads, in the real sections' shapes.
private struct UsageSkeleton: View {
    var body: some View {
        Section {
            LineBone(width: 160, font: .subheadline)
            LineBone(width: 120, font: .largeTitle)
            Capsule().fill(.quaternary).frame(height: 10)
        }
        Section {
            ForEach(0..<4, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 3) {
                    LineBone(width: 200)
                    LineBone(width: 240, font: .caption)
                }
            }
        }
        Section {
            RoundedRectangle(cornerRadius: 12).fill(.quaternary.opacity(0.5)).frame(height: 220)
        }
        .accessibilityIdentifier("usage.skeleton")
    }
}
