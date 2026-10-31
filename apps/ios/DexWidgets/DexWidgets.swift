import AppIntents
import DexCore
import SwiftUI
import WidgetKit

/// Dex's widgets: one sidekick (Home Screen and Lock Screen), and all of them. They fetch `GET /api/sidekicks` with the
/// session the app shares through the App Group (the Keychain), keep what they got there for when Dex can't be reached,
/// and refresh about every 15 minutes; the app reloads them when its sidekicks or chats change and when a push arrives.
@main
struct DexWidgetsBundle: WidgetBundle {
    var body: some Widget {
        SidekickWidget()
        SidekicksWidget()
    }
}

enum WidgetKinds {
    static let sidekick = "dev.trydex.Dex.sidekick"
    static let sidekicks = "dev.trydex.Dex.sidekicks"
}

/// Where the widgets' data comes from.
enum WidgetData {
    static let refreshInterval: TimeInterval = 15 * 60

    static var store: WidgetStore? { .shared }

    /// Fetches the snapshot from Dex (falling back to the kept one).
    static func refresh() async -> WidgetLoad {
        await WidgetFeed.load(store: store, credentials: AppGroup.credentials.load())
    }

    /// The kept snapshot, without fetching (the widget gallery's snapshot), or a fetch when nothing is kept yet.
    static func keptOrRefresh() async -> WidgetLoad {
        guard AppGroup.credentials.load() != nil else { return .signedOut }
        if let kept = store?.load() { return .ready(kept, stale: true) }
        return await refresh()
    }

    static func items(_ snapshot: SidekickSnapshot) -> [WidgetSidekickItem] {
        snapshot.sidekicks.map { WidgetSidekickItem($0, picture: WidgetSidekickItem.picture(store?.picture($0.id))) }
    }

    static func next(_ date: Date = .now) -> Date { date.addingTimeInterval(refreshInterval) }
}

// MARK: Sidekick

/// A sidekick to put on a widget, from the kept snapshot.
struct SidekickEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Sidekick"
    static let defaultQuery = SidekickQuery()

    let id: String
    let name: String
    let tagline: String
    let picture: Data?

    init(_ sidekick: WidgetSidekick, picture: Data?) {
        id = sidekick.id
        name = sidekick.name
        tagline = sidekick.tagline
        self.picture = picture
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: tagline.isEmpty ? nil : "\(tagline)", image: picture.map { .init(data: $0) })
    }
}

/// Your sidekicks, for the widget's settings.
struct SidekickQuery: EntityQuery {
    func entities(for identifiers: [SidekickEntity.ID]) async throws -> [SidekickEntity] {
        await all().filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [SidekickEntity] { await all() }

    func defaultResult() async -> SidekickEntity? { await all().first }

    private func all() async -> [SidekickEntity] {
        let snapshot: SidekickSnapshot? = if let kept = WidgetData.store?.load(), !kept.sidekicks.isEmpty {
            kept
        } else if case .ready(let fresh, _) = await WidgetData.refresh() {
            fresh
        } else {
            nil
        }
        return snapshot?.sidekicks.map { SidekickEntity($0, picture: WidgetData.store?.picture($0.id)) } ?? []
    }
}

struct PickSidekickIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Sidekick"
    static let description = IntentDescription("Pick which sidekick this widget shows.")

    @Parameter(title: "Sidekick")
    var sidekick: SidekickEntity?

    init() {}
}

struct SidekickEntry: TimelineEntry {
    let date: Date
    let content: SidekickWidgetContent
    let palette: WidgetPalette
}

struct SidekickProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> SidekickEntry {
        SidekickEntry(date: .now, content: .sidekick(WidgetSamples.items()[0]), palette: .load())
    }

    func snapshot(for configuration: PickSidekickIntent, in context: Context) async -> SidekickEntry {
        let load = await WidgetData.keptOrRefresh()
        // The gallery before you've signed in: show what the widget looks like.
        if context.isPreview, case .ready(let snapshot, _) = load, !snapshot.sidekicks.isEmpty {
            return entry(load, configuration)
        }
        return context.isPreview ? placeholder(in: context) : entry(load, configuration)
    }

    func timeline(for configuration: PickSidekickIntent, in context: Context) async -> Timeline<SidekickEntry> {
        Timeline(entries: [entry(await WidgetData.refresh(), configuration)], policy: .after(WidgetData.next()))
    }

    private func entry(_ load: WidgetLoad, _ configuration: PickSidekickIntent) -> SidekickEntry {
        let content: SidekickWidgetContent = switch load {
        case .signedOut: .signedOut
        case .unavailable: .unavailable
        case .ready(let snapshot, _):
            // The one picked, or (not picked yet) the first; one that's gone says so.
            if let sidekick = configuration.sidekick.map({ snapshot.sidekick($0.id) }) ?? snapshot.sidekicks.first {
                .sidekick(WidgetSidekickItem(sidekick, picture: WidgetSidekickItem.picture(WidgetData.store?.picture(sidekick.id))))
            } else {
                .noSidekicks
            }
        }
        return SidekickEntry(date: .now, content: content, palette: .load())
    }
}

struct SidekickWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SidekickEntry

    var body: some View {
        SidekickWidgetView(content: entry.content, family: family, accent: entry.palette.accent, onAccent: entry.palette.onAccent)
    }
}

struct SidekickWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: WidgetKinds.sidekick, intent: PickSidekickIntent.self, provider: SidekickProvider()) { entry in
            SidekickWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Sidekick")
        .description("One of your sidekicks: their latest words, and a tap to talk.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
    }
}

// MARK: Sidekicks

struct SidekicksEntry: TimelineEntry {
    let date: Date
    let content: SidekicksWidgetContent
    let palette: WidgetPalette
}

struct SidekicksProvider: TimelineProvider {
    func placeholder(in context: Context) -> SidekicksEntry {
        SidekicksEntry(date: .now, content: .sidekicks(WidgetSamples.items(), unread: 2), palette: .load())
    }

    func getSnapshot(in context: Context, completion: @escaping @Sendable (SidekicksEntry) -> Void) {
        let preview = context.isPreview
        let placeholder = placeholder(in: context)
        Task {
            let load = await WidgetData.keptOrRefresh()
            // The gallery before you've signed in (or made one): show what the widget looks like.
            if preview, case .ready(let snapshot, _) = load, !snapshot.sidekicks.isEmpty { return completion(Self.entry(load)) }
            completion(preview ? placeholder : Self.entry(load))
        }
    }

    func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<SidekicksEntry>) -> Void) {
        Task {
            completion(Timeline(entries: [Self.entry(await WidgetData.refresh())], policy: .after(WidgetData.next())))
        }
    }

    private static func entry(_ load: WidgetLoad) -> SidekicksEntry {
        let content: SidekicksWidgetContent = switch load {
        case .signedOut: .signedOut
        case .unavailable: .unavailable
        case .ready(let snapshot, _): .sidekicks(WidgetData.items(snapshot), unread: snapshot.unread)
        }
        return SidekicksEntry(date: .now, content: content, palette: .load())
    }
}

struct SidekicksWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SidekicksEntry

    var body: some View {
        SidekicksWidgetView(content: entry.content, family: family, accent: entry.palette.accent, onAccent: entry.palette.onAccent)
    }
}

struct SidekicksWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKinds.sidekicks, provider: SidekicksProvider()) { entry in
            SidekicksWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Sidekicks")
        .description("All your sidekicks, who has something new, and a tap to talk to any of them.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
