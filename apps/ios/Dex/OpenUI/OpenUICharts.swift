import Charts
import DexCore
import SwiftUI

/// A chart's data: categories along one axis and named series of values (react-ui's buildChartData). Series come as
/// Series(...) components, or as rows from a Query (`labels` = column names, `series` = `[[label, v1, v2], …]`).
struct OUIChartData {
    struct Point: Identifiable {
        let id: Int
        let category: String
        let series: String
        let value: Double
    }

    var categories: [String] = []
    var names: [String] = []
    var points: [Point] = []

    init(labels: OpenUIValue?, series: OpenUIValue?) {
        let labels = labels?.array?.map { $0.text ?? "" } ?? []
        let raw = series?.array ?? []
        if let first = raw.first, first.array != nil {
            names = Array(labels.dropFirst())
            for row in raw {
                let cells = row.array ?? []
                let category = cells.first?.text ?? ""
                categories.append(category)
                for (index, name) in names.enumerated() {
                    let cell = index + 1 < cells.count ? cells[index + 1] : .null
                    points.append(Point(id: points.count, category: category, series: name, value: cell.number ?? 0))
                }
            }
            return
        }
        categories = labels
        let nodes = raw.compactMap(\.node)
        names = nodes.compactMap { $0.string("category") }
        for (index, label) in labels.enumerated() {
            for node in nodes {
                guard let name = node.string("category"), let values = node.props["values"]?.array, index < values.count else { continue }
                points.append(Point(id: points.count, category: label, series: name, value: values[index].number ?? 0))
            }
        }
    }

    /// Labels with values (pie, radial, single stacked bar), or legacy Slice(...) components.
    static func slices(labels: OpenUIValue?, values: OpenUIValue?) -> [(label: String, value: Double)] {
        let labels = labels?.array ?? []
        let values = values?.array ?? []
        if !labels.isEmpty, !values.isEmpty {
            return labels.enumerated().map { index, label in (label.text ?? "", index < values.count ? values[index].number ?? 0 : 0) }
        }
        return labels.compactMap(\.node).map { ($0.string("category") ?? "", $0.number("value") ?? 0) }
    }
}

/// The categorical colors by series name, in a fixed order.
struct OUIPalette {
    let names: [String]
    let dark: Bool

    func color(_ name: String) -> Color { OUIStyle.series(names.firstIndex(of: name) ?? 0, dark: dark) }
    var colors: [Color] { names.indices.map { OUIStyle.series($0, dark: dark) } }
}

// MARK: Bar, line, area

/// Bar (grouped or stacked, vertical or horizontal), line, and area charts with Swift Charts. Tap to read the values
/// at a category; long category lists scroll sideways.
struct OUICartesianChart: View {
    let node: OpenUINode
    @Environment(\.colorScheme) private var colorScheme
    @State private var selected: String?

    var body: some View {
        let data = OUIChartData(labels: node.props["labels"], series: node.props["series"])
        let palette = OUIPalette(names: data.names, dark: colorScheme == .dark)
        let horizontal = node.type == "HorizontalBarChart"
        let stacked = node.string("variant") == "stacked"
        let height = CGFloat(node.number("height") ?? (horizontal ? max(160, Double(data.categories.count) * (stacked ? 34 : 22 * Double(max(data.names.count, 1)) + 14)) : 210))
        if !data.points.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                chart(data, palette: palette, horizontal: horizontal, stacked: stacked)
                    .chartForegroundStyleScale(domain: data.names, range: palette.colors)
                    .chartLegend(data.names.count > 1 ? .visible : .hidden)
                    .chartLegend(position: .top, alignment: .leading)
                    .modifier(OUIAxisLabels(x: horizontal ? node.string("yLabel") : node.string("xLabel"), y: horizontal ? node.string("xLabel") : node.string("yLabel")))
                    .chartYAxis { AxisMarks(position: horizontal ? .automatic : .leading) { _ in
                        if !horizontal { AxisGridLine().foregroundStyle(Color(uiColor: .separator)) }
                        AxisValueLabel()
                    } }
                    .chartXAxis { AxisMarks { _ in
                        if horizontal { AxisGridLine().foregroundStyle(Color(uiColor: .separator)) }
                        AxisValueLabel()
                    } }
                    .modifier(OUIScrollableChart(count: data.categories.count, horizontal: horizontal))
                    .frame(height: height)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("openui.chart.\(node.type)")
        }
    }

    @ViewBuilder
    private func chart(_ data: OUIChartData, palette: OUIPalette, horizontal: Bool, stacked: Bool) -> some View {
        let single = data.names.count <= 1
        let interpolation: InterpolationMethod = switch node.string("variant") {
        case "natural": .catmullRom
        case "step": .stepCenter
        default: .linear
        }
        let base = Chart {
            ForEach(data.points) { point in
                switch node.type {
                case "LineChart":
                    LineMark(x: .value("Category", point.category), y: .value("Value", point.value), series: .value("Series", point.series))
                        .foregroundStyle(by: .value("Series", point.series))
                        .interpolationMethod(interpolation)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                        .symbol(by: .value("Series", point.series))
                        .symbolSize(data.categories.count > 16 ? 0 : 24)
                case "AreaChart":
                    AreaMark(x: .value("Category", point.category), y: .value("Value", point.value), series: .value("Series", point.series), stacking: .unstacked)
                        .foregroundStyle(by: .value("Series", point.series))
                        .interpolationMethod(interpolation)
                        .opacity(single ? 0.25 : 0.18)
                    LineMark(x: .value("Category", point.category), y: .value("Value", point.value), series: .value("Series", point.series))
                        .foregroundStyle(by: .value("Series", point.series))
                        .interpolationMethod(interpolation)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                default:
                    if horizontal {
                        BarMark(x: .value("Value", point.value), y: .value("Category", point.category), height: .ratio(0.7))
                            .foregroundStyle(by: .value("Series", point.series))
                            .position(by: .value("Series", stacked ? "" : point.series))
                            .clipShape(.rect(cornerRadius: 4))
                    } else {
                        BarMark(x: .value("Category", point.category), y: .value("Value", point.value), width: .ratio(0.7))
                            .foregroundStyle(by: .value("Series", point.series))
                            .position(by: .value("Series", stacked ? "" : point.series))
                            .clipShape(.rect(cornerRadius: 4))
                    }
                }
            }
            if let selected {
                if horizontal {
                    RuleMark(y: .value("Category", selected))
                        .foregroundStyle(.secondary.opacity(0.4))
                        .annotation(position: .top, alignment: .trailing, overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))) {
                            OUIChartTip(category: selected, data: data, palette: palette)
                        }
                } else {
                    RuleMark(x: .value("Category", selected))
                        .foregroundStyle(.secondary.opacity(0.4))
                        .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))) {
                            OUIChartTip(category: selected, data: data, palette: palette)
                        }
                }
            }
        }
        // A tap (not a drag, which would fight the chat's scrolling) shows the values at a category.
        base.chartGesture { proxy in
            SpatialTapGesture().onEnded { tap in
                let category: String? = horizontal ? proxy.value(atY: tap.location.y) : proxy.value(atX: tap.location.x)
                selected = category == selected ? nil : category
            }
        }
    }
}

/// Axis titles, only when the program gives them (an empty one still takes room).
struct OUIAxisLabels: ViewModifier {
    let x: String?
    let y: String?

    func body(content: Content) -> some View {
        switch (x?.isEmpty == false ? x : nil, y?.isEmpty == false ? y : nil) {
        case let (x?, y?): content.chartXAxisLabel(x, alignment: .center).chartYAxisLabel(y)
        case let (x?, nil): content.chartXAxisLabel(x, alignment: .center)
        case let (nil, y?): content.chartYAxisLabel(y)
        default: content
        }
    }
}

/// Long category lists scroll sideways (8 visible) rather than crowding.
struct OUIScrollableChart: ViewModifier {
    let count: Int
    let horizontal: Bool

    func body(content: Content) -> some View {
        if !horizontal, count > 8 {
            content.chartScrollableAxes(.horizontal).chartXVisibleDomain(length: 8)
        } else {
            content
        }
    }
}

/// The values at one category, while you touch the chart.
struct OUIChartTip: View {
    let category: String
    let data: OUIChartData
    let palette: OUIPalette

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(category).font(.caption.weight(.semibold))
            ForEach(data.points.filter { $0.category == category }) { point in
                HStack(spacing: 5) {
                    Circle().fill(palette.color(point.series)).frame(width: 7, height: 7)
                    if data.names.count > 1 { Text(point.series).foregroundStyle(.secondary) }
                    Text(OpenUIValue.number(point.value).text ?? "").monospacedDigit()
                }
                .font(.caption2)
            }
        }
        .padding(8)
        .glassEffect(.regular, in: .rect(cornerRadius: 10))
    }
}

/// Names and colors (and values) under a chart.
struct OUILegend: View {
    let items: [(name: String, color: Color, detail: String?)]

    var body: some View {
        OUIFlow(spacing: 12) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(spacing: 5) {
                    Circle().fill(item.color).frame(width: 8, height: 8)
                    Text(item.name).foregroundStyle(.secondary)
                    if let detail = item.detail { Text(detail).monospacedDigit().foregroundStyle(.primary) }
                }
                .font(.caption)
            }
        }
    }
}

// MARK: Radar

/// A spider chart: one polygon per series over the categories.
struct OUIRadarChart: View {
    let node: OpenUINode
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let data = OUIChartData(labels: node.props["labels"], series: node.props["series"])
        let palette = OUIPalette(names: data.names, dark: colorScheme == .dark)
        let top = max(data.points.map(\.value).max() ?? 1, 1)
        let count = data.categories.count
        if count >= 3 {
            VStack(alignment: .leading, spacing: 10) {
                Canvas { context, size in
                    let center = CGPoint(x: size.width / 2, y: size.height / 2)
                    let radius = min(size.width, size.height) / 2 - 28
                    func point(_ index: Int, _ fraction: Double) -> CGPoint {
                        let angle = -Double.pi / 2 + Double(index) * 2 * .pi / Double(count)
                        return CGPoint(x: center.x + cos(angle) * radius * fraction, y: center.y + sin(angle) * radius * fraction)
                    }
                    for ring in 1...4 {
                        var path = Path()
                        for index in 0..<count {
                            let p = point(index, Double(ring) / 4)
                            if index == 0 { path.move(to: p) } else { path.addLine(to: p) }
                        }
                        path.closeSubpath()
                        context.stroke(path, with: .color(.secondary.opacity(0.25)), lineWidth: 0.5)
                    }
                    for (index, category) in data.categories.enumerated() {
                        var spoke = Path()
                        spoke.move(to: center)
                        spoke.addLine(to: point(index, 1))
                        context.stroke(spoke, with: .color(.secondary.opacity(0.25)), lineWidth: 0.5)
                        let label = context.resolve(Text(category).font(.caption2).foregroundStyle(.secondary))
                        context.draw(label, at: point(index, 1.16))
                    }
                    for name in data.names {
                        var shape = Path()
                        for (index, category) in data.categories.enumerated() {
                            let value = data.points.first { $0.series == name && $0.category == category }?.value ?? 0
                            let p = point(index, value / top)
                            if index == 0 { shape.move(to: p) } else { shape.addLine(to: p) }
                        }
                        shape.closeSubpath()
                        context.fill(shape, with: .color(palette.color(name).opacity(0.18)))
                        context.stroke(shape, with: .color(palette.color(name)), lineWidth: 2)
                    }
                }
                .frame(height: 240)
                if data.names.count > 1 { OUILegend(items: data.names.map { ($0, palette.color($0), nil) }) }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Radar chart of \(data.names.joined(separator: ", "))")
            .accessibilityIdentifier("openui.chart.RadarChart")
        }
    }
}

// MARK: Pie, radial, single stacked bar

struct OUIPieChart: View {
    let node: OpenUINode
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let slices = OUIChartData.slices(labels: node.props["labels"], values: node.props["values"])
        let palette = OUIPalette(names: slices.map(\.label), dark: colorScheme == .dark)
        let total = slices.reduce(0) { $0 + max($1.value, 0) }
        let donut = node.string("variant") == "donut"
        let semi = node.string("appearance") == "semiCircular"
        if slices.isEmpty {
            if node.loading { Circle().fill(.quaternary).frame(width: 160, height: 160).frame(maxWidth: .infinity) }
        } else {
            VStack(spacing: 12) {
                Chart {
                    ForEach(Array(slices.enumerated()), id: \.offset) { index, slice in
                        SectorMark(angle: .value("Value", max(slice.value, 0)), innerRadius: .ratio(donut ? 0.6 : 0), angularInset: 1.5)
                            .foregroundStyle(palette.color(slice.label))
                            .cornerRadius(4)
                    }
                    if semi {
                        SectorMark(angle: .value("Value", total)).foregroundStyle(.clear)
                    }
                }
                .chartLegend(.hidden)
                .frame(width: 200, height: 200)
                .rotationEffect(.degrees(semi ? -90 : 0))
                .frame(height: semi ? 100 : 200, alignment: .top)
                .clipped()
                .frame(maxWidth: .infinity)
                OUILegend(items: slices.map { ($0.label, palette.color($0.label), total > 0 ? "\(Int((max($0.value, 0) / total * 100).rounded()))%" : nil) })
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(slices.map { "\($0.label) \(OpenUIValue.number($0.value).text ?? "")" }.joined(separator: ", "))
            .accessibilityIdentifier("openui.chart.PieChart")
        }
    }
}

/// Radial bars: one ring per value, against the largest.
struct OUIRadialChart: View {
    let node: OpenUINode
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let slices = OUIChartData.slices(labels: node.props["labels"], values: node.props["values"])
        let palette = OUIPalette(names: slices.map(\.label), dark: colorScheme == .dark)
        let top = max(slices.map(\.value).max() ?? 1, 1)
        if !slices.isEmpty {
            VStack(spacing: 12) {
                ZStack {
                    ForEach(Array(slices.enumerated()), id: \.offset) { index, slice in
                        let inset = CGFloat(index) * 18
                        Circle().stroke(.quaternary.opacity(0.6), lineWidth: 12).padding(inset)
                        Circle()
                            .trim(from: 0, to: max(0, min(1, slice.value / top)) * 0.75)
                            .stroke(palette.color(slice.label), style: StrokeStyle(lineWidth: 12, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                            .padding(inset)
                    }
                }
                .frame(width: 180, height: 180)
                .frame(maxWidth: .infinity)
                OUILegend(items: slices.map { ($0.label, palette.color($0.label), OpenUIValue.number($0.value).text) })
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(slices.map { "\($0.label) \(OpenUIValue.number($0.value).text ?? "")" }.joined(separator: ", "))
            .accessibilityIdentifier("openui.chart.RadialChart")
        }
    }
}

/// One bar split into parts, with a legend of shares.
struct OUIStackedBarChart: View {
    let node: OpenUINode
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let slices = OUIChartData.slices(labels: node.props["labels"], values: node.props["values"])
        let palette = OUIPalette(names: slices.map(\.label), dark: colorScheme == .dark)
        let total = slices.reduce(0) { $0 + max($1.value, 0) }
        if total > 0 {
            VStack(alignment: .leading, spacing: 10) {
                GeometryReader { geometry in
                    HStack(spacing: 2) {
                        ForEach(Array(slices.enumerated()), id: \.offset) { _, slice in
                            Rectangle()
                                .fill(palette.color(slice.label))
                                .frame(width: max(0, (geometry.size.width - CGFloat(slices.count - 1) * 2) * max(slice.value, 0) / total))
                        }
                    }
                }
                .frame(height: 16)
                .clipShape(.capsule)
                OUILegend(items: slices.map { ($0.label, palette.color($0.label), "\(Int((max($0.value, 0) / total * 100).rounded()))%") })
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(slices.map { "\($0.label) \(OpenUIValue.number($0.value).text ?? "")" }.joined(separator: ", "))
            .accessibilityIdentifier("openui.chart.SingleStackedBarChart")
        }
    }
}

// MARK: Scatter

struct OUIScatterChart: View {
    let node: OpenUINode
    @Environment(\.colorScheme) private var colorScheme

    private struct Dot: Identifiable {
        let id: Int
        let series: String
        let x: Double
        let y: Double
        let z: Double?
    }

    var body: some View {
        let sets = node.props["datasets"]?.array ?? []
        var dots: [Dot] = []
        var names: [String] = []
        for set in sets {
            let props = set.node?.props ?? set.object ?? [:]
            let name = props["name"]?.text ?? ""
            names.append(name)
            for point in props["points"]?.array ?? [] {
                let values = point.node?.props ?? point.object ?? [:]
                guard let x = values["x"]?.number, let y = values["y"]?.number else { continue }
                dots.append(Dot(id: dots.count, series: name, x: x, y: y, z: values["z"]?.number))
            }
        }
        let palette = OUIPalette(names: names, dark: colorScheme == .dark)
        return Group {
            if !dots.isEmpty {
                Chart(dots) { dot in
                    PointMark(x: .value(node.string("xLabel") ?? "x", dot.x), y: .value(node.string("yLabel") ?? "y", dot.y))
                        .foregroundStyle(by: .value("Series", dot.series))
                        .symbolSize(dot.z.map { max(30, min(400, $0 * 12)) } ?? 64)
                }
                .chartForegroundStyleScale(domain: names, range: palette.colors)
                .chartLegend(names.count > 1 ? .visible : .hidden)
                .chartLegend(position: .top, alignment: .leading)
                .modifier(OUIAxisLabels(x: node.string("xLabel"), y: node.string("yLabel")))
                .frame(height: 220)
                .accessibilityIdentifier("openui.chart.ScatterChart")
            }
        }
    }
}
