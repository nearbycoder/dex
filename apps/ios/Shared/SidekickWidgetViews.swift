import DexCore
import SwiftUI
import UIKit
import WidgetKit

// The home-screen and Lock Screen widgets' views, compiled into the widget extension and the app (which renders them
// for its tests' screenshots). They take everything they show; DexWidgets fetches it.

/// A sidekick as a widget shows them: what the snapshot says, and their picture.
struct WidgetSidekickItem: Identifiable, Hashable {
    let sidekick: WidgetSidekick
    let picture: UIImage?
    var id: String { sidekick.id }

    init(_ sidekick: WidgetSidekick, picture: UIImage?) {
        self.sidekick = sidekick
        self.picture = picture
    }

    /// Decodes a kept picture, shrunk for a widget (WidgetKit limits how big a widget's images may be).
    static func picture(_ data: Data?, side: CGFloat = 160) -> UIImage? {
        guard let data, let image = UIImage(data: data) else { return nil }
        return image.preparingThumbnail(of: CGSize(width: side, height: side)) ?? image
    }
}

/// What the Sidekick widget shows.
enum SidekickWidgetContent: Hashable {
    case sidekick(WidgetSidekickItem)
    /// Signed out of the app (or the session ended).
    case signedOut
    /// Signed in, but there are no sidekicks yet (or the one picked is gone).
    case noSidekicks
    /// Dex couldn't be reached and nothing is kept yet.
    case unavailable
}

/// A sidekick's round face: their picture on their color, else their emoji or initial; a dot while they have
/// something you haven't read.
struct WidgetFace: View {
    let sidekick: WidgetSidekick
    let picture: UIImage?
    var size: CGFloat = 52
    var accent: Color = .accentColor
    var showsUnread = true

    var body: some View {
        let tint = AgentColors.color(sidekick.color)
        ZStack {
            Circle().fill(tint.opacity(0.22).gradient)
            if let picture {
                Image(uiImage: picture)
                    .resizable()
                    .widgetAccentedRenderingMode(.accentedDesaturated)
                    .scaledToFill()
            } else {
                Text(sidekick.glyph)
                    .font(.system(size: size * 0.44, weight: .semibold, design: .rounded))
                    .foregroundStyle(tint)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
            }
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .overlay(Circle().strokeBorder(.primary.opacity(0.08)))
        .overlay(alignment: .topTrailing) {
            if showsUnread, sidekick.unread {
                UnreadBadgeDot(accent: accent, size: max(9, size * 0.24))
                    .offset(x: size * 0.02, y: -size * 0.02)
            }
        }
        .accessibilityHidden(true)
    }
}

/// The dot that says "new": the accent, ringed so it reads on a picture.
struct UnreadBadgeDot: View {
    var accent: Color
    var size: CGFloat = 10

    var body: some View {
        Circle()
            .fill(accent)
            .frame(width: size, height: size)
            .overlay(Circle().strokeBorder(Color(uiColor: .systemBackground), lineWidth: max(1.5, size * 0.16)))
            .widgetAccentable()
    }
}

/// Behind a widget: the system background, warmed with a color (the sidekick's, or the theme's accent).
struct WidgetBackdrop: View {
    let tint: Color

    var body: some View {
        ZStack {
            Color(uiColor: .secondarySystemGroupedBackground)
            LinearGradient(colors: [tint.opacity(0.24), tint.opacity(0.05)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }
}

// MARK: Sidekick (one)

/// One sidekick: their face, name, and (with room) their latest words and a Message button. Tapping opens their chat.
struct SidekickWidgetView: View {
    let content: SidekickWidgetContent
    let family: WidgetFamily
    var accent: Color = .accentColor
    /// Text on an accent fill: white, or black where the accent is light.
    var onAccent: Color = .white

    var body: some View {
        switch content {
        case .sidekick(let item):
            sidekick(item)
                .widgetURL(DexLink.chat(item.sidekick.sessionId))
                .containerBackground(for: .widget) { background(AgentColors.color(item.sidekick.color)) }
        case .signedOut:
            WidgetNote(family: family, symbol: "person.crop.circle.badge.exclamationmark", title: "Sign in to Dex", detail: "Your sidekicks show up here.")
                .containerBackground(for: .widget) { background(accent) }
        case .noSidekicks:
            WidgetNote(family: family, symbol: "theatermasks", title: "No sidekick", detail: "Make one in Dex, then pick them here.")
                .widgetURL(DexLink.newSidekick)
                .containerBackground(for: .widget) { background(accent) }
        case .unavailable:
            WidgetNote(family: family, symbol: "wifi.slash", title: "Can't reach Dex", detail: "Your sidekicks show up here once it's back.")
                .containerBackground(for: .widget) { background(accent) }
        }
    }

    @ViewBuilder
    private func background(_ tint: Color) -> some View {
        switch family {
        case .accessoryCircular, .accessoryRectangular, .accessoryInline: Color.clear
        default: WidgetBackdrop(tint: tint)
        }
    }

    @ViewBuilder
    private func sidekick(_ item: WidgetSidekickItem) -> some View {
        let sidekick = item.sidekick
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                WidgetFace(sidekick: sidekick, picture: item.picture, size: 44, accent: accent, showsUnread: false)
            }
            .overlay(alignment: .topTrailing) {
                if sidekick.unread { Circle().fill(.primary).frame(width: 10, height: 10).widgetAccentable() }
            }
            .accessibilityElement()
            .accessibilityLabel(sidekick.unread ? "\(sidekick.name), new message" : sidekick.name)
        case .accessoryRectangular:
            HStack(spacing: 8) {
                WidgetFace(sidekick: sidekick, picture: item.picture, size: 36, accent: accent, showsUnread: false)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text(sidekick.name).font(.headline).lineLimit(1).widgetAccentable()
                        if sidekick.unread { Circle().frame(width: 7, height: 7).widgetAccentable() }
                    }
                    Text(sidekick.busy ? "typing…" : sidekick.line)
                        .font(.caption)
                        .lineLimit(2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
        case .systemMedium:
            medium(item)
        default:
            small(item)
        }
    }

    private func status(_ sidekick: WidgetSidekick) -> (text: String, highlighted: Bool) {
        if sidekick.busy { return ("typing…", true) }
        if sidekick.unread { return ("New message", true) }
        return (sidekick.tagline.isEmpty ? "Say hi" : sidekick.tagline, false)
    }

    private func small(_ item: WidgetSidekickItem) -> some View {
        let sidekick = item.sidekick
        let status = status(sidekick)
        return VStack(alignment: .leading, spacing: 0) {
            WidgetFace(sidekick: sidekick, picture: item.picture, size: 58, accent: accent)
            Spacer(minLength: 8)
            Text(sidekick.name)
                .font(.headline.weight(sidekick.unread ? .bold : .semibold))
                .lineLimit(1)
            Text(status.text)
                .font(.caption.weight(status.highlighted ? .semibold : .regular))
                .foregroundStyle(status.highlighted ? accent : .secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .combine)
    }

    private func medium(_ item: WidgetSidekickItem) -> some View {
        let sidekick = item.sidekick
        let tint = AgentColors.color(sidekick.color)
        return HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 6) {
                WidgetFace(sidekick: sidekick, picture: item.picture, size: 66, accent: accent)
                Text(sidekick.name)
                    .font(.subheadline.weight(sidekick.unread ? .bold : .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(width: 84)
            VStack(alignment: .leading, spacing: 8) {
                // Their latest words, as a message from them.
                Text(sidekick.busy ? "typing…" : sidekick.line.isEmpty ? "Say hi to \(sidekick.name)." : sidekick.line)
                    .font(.subheadline)
                    .foregroundStyle(sidekick.busy ? accent : .primary)
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 8)
                    .background(tint.opacity(0.16), in: UnevenRoundedRectangle(topLeadingRadius: 4, bottomLeadingRadius: 16, bottomTrailingRadius: 16, topTrailingRadius: 16, style: .continuous))
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    if sidekick.unread {
                        UnreadBadgeDot(accent: accent, size: 8)
                        Text("New").font(.caption.weight(.semibold)).foregroundStyle(accent)
                    } else if let at = sidekick.repliedAt {
                        Text(Format.ago(at)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 4)
                    Link(destination: DexLink.chat(sidekick.sessionId, compose: true)) {
                        Label("Message", systemImage: "square.and.pencil")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(onAccent)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 6)
                            .background(accent, in: .capsule)
                            .widgetAccentable()
                    }
                    .accessibilityLabel("Message \(sidekick.name)")
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// A widget with nothing of theirs to show yet: a symbol and a line or two.
struct WidgetNote: View {
    let family: WidgetFamily
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: symbol).font(.title3)
            }
            .accessibilityLabel(title)
        case .accessoryRectangular, .accessoryInline:
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.headline).widgetAccentable()
                Text(detail).font(.caption).lineLimit(2).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            VStack(alignment: .leading, spacing: 4) {
                Image(systemName: symbol)
                    .font(.title2)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 4)
                Text(title).font(.headline).lineLimit(2)
                Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(3)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

// MARK: Sidekicks (all)

/// What the Sidekicks widget shows.
enum SidekicksWidgetContent: Hashable {
    /// Their faces (in the app's order), and how many chats are unread in all.
    case sidekicks([WidgetSidekickItem], unread: Int)
    case signedOut
    case unavailable
}

/// Every sidekick (up to 4, or 8 on the large widget) in a grid, each opening their chat, with the unread count.
struct SidekicksWidgetView: View {
    let content: SidekicksWidgetContent
    let family: WidgetFamily
    var accent: Color = .accentColor
    var onAccent: Color = .white

    /// How many fit.
    static func capacity(_ family: WidgetFamily) -> Int { family == .systemLarge ? 8 : 4 }

    /// The ones shown when there are more than fit: those with something unread first, then in order; kept in order.
    static func shown(_ items: [WidgetSidekickItem], capacity: Int) -> [WidgetSidekickItem] {
        guard items.count > capacity else { return items }
        let picked = Set((items.filter(\.sidekick.unread) + items.filter { !$0.sidekick.unread }).prefix(capacity).map(\.id))
        return items.filter { picked.contains($0.id) }
    }

    var body: some View {
        Group {
            switch content {
            case .sidekicks(let items, let unread):
                if items.isEmpty {
                    WidgetNote(family: family, symbol: "theatermasks", title: "No sidekicks yet", detail: "Make one in Dex: they show up here.")
                        .widgetURL(DexLink.newSidekick)
                } else {
                    grid(Self.shown(items, capacity: Self.capacity(family)), unread: unread)
                }
            case .signedOut:
                WidgetNote(family: family, symbol: "person.crop.circle.badge.exclamationmark", title: "Sign in to Dex", detail: "Your sidekicks show up here.")
            case .unavailable:
                WidgetNote(family: family, symbol: "wifi.slash", title: "Can't reach Dex", detail: "Your sidekicks show up here once it's back.")
            }
        }
        .containerBackground(for: .widget) { WidgetBackdrop(tint: accent) }
    }

    private func grid(_ items: [WidgetSidekickItem], unread: Int) -> some View {
        let large = family == .systemLarge
        return VStack(alignment: .leading, spacing: large ? 14 : 10) {
            HStack(spacing: 6) {
                Image(systemName: "theatermasks.fill").foregroundStyle(accent).widgetAccentable()
                Text("Sidekicks").font(.headline)
                Spacer(minLength: 4)
                if unread > 0 {
                    Text("\(unread) unread")
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(onAccent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(accent, in: .capsule)
                        .widgetAccentable()
                        .accessibilityLabel("\(unread) unread chats")
                }
            }
            // Centered in the space under the header.
            Spacer(minLength: 0)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: 4), spacing: large ? 26 : 8) {
                ForEach(items) { item in
                    Link(destination: DexLink.chat(item.sidekick.sessionId)) {
                        cell(item, large: large)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func cell(_ item: WidgetSidekickItem, large: Bool) -> some View {
        let sidekick = item.sidekick
        return VStack(spacing: 4) {
            WidgetFace(sidekick: sidekick, picture: item.picture, size: large ? 64 : 54, accent: accent)
            Text(sidekick.name)
                .font(.caption.weight(sidekick.unread ? .bold : .medium))
                // Not `.primary`: inside a Link that's the link's tint.
                .foregroundStyle(Color(uiColor: .label))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            if large {
                Text(sidekick.busy ? "typing…" : sidekick.unread ? "New message" : sidekick.tagline)
                    .font(.caption2)
                    .foregroundStyle(sidekick.busy || sidekick.unread ? accent : .secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(sidekick.unread ? "\(sidekick.name), new message" : sidekick.name)
    }
}

// MARK: Samples

/// Sidekicks for widget previews, the gallery's placeholder, and the app's screenshots of the widgets.
enum WidgetSamples {
    static func items() -> [WidgetSidekickItem] {
        let now = Date.now.timeIntervalSince1970 * 1000
        let looks = Dictionary(uniqueKeysWithValues: SidekickLook.all.map { ($0.id, $0) })
        func item(_ id: String, _ name: String, _ tagline: String, _ color: String, unread: Bool = false, busy: Bool = false, reply: String? = nil, minutes: Double = 60) -> WidgetSidekickItem {
            let sidekick = WidgetSidekick(id: id, name: name, tagline: tagline, color: looks[id]?.color ?? color, sessionId: "s-\(id)", unread: unread, busy: busy,
                                          lastReply: reply, repliedAt: reply == nil ? nil : now - minutes * 60_000)
            let data = looks[id].flatMap { WidgetSidekick(id: id, name: name, image: $0.image, sessionId: "").imageData }
            return WidgetSidekickItem(sidekick, picture: WidgetSidekickItem.picture(data))
        }
        return [
            item("atlas", "Atlas", "Keeps your life organized", "sky", unread: true,
                 reply: "Morning! Quick check-in: you wanted the studio lease signed by Friday. Still on track?", minutes: 25),
            item("muse", "Muse", "Your creative sparring partner", "violet", reply: "Knew it. Mud Club has a secret-society feel. Want me to sketch a logo next?", minutes: 40),
            item("sage", "Sage", "A thinking partner for the big questions", "teal", busy: true),
            item("rex", "Rex", "Coach, hype man, accountability buddy", "orange", unread: true, reply: "Day 12 of the streak. LET'S GO.", minutes: 90)
        ]
    }
}
