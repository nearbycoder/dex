import Foundation

/// The chat list as an inbox (the web's sidebar and session menu): chats needing you, then Snoozed (soonest first)
/// and Settled (most recent first). A chat leaves those groups when something new happens in it or its snooze ends.
public enum Inbox {
    public enum Place: String, Sendable { case inbox, snoozed, settled }

    public static func place(of session: SessionMeta, now: Double = .nowMs) -> Place {
        if let until = session.snoozedUntil, until > now { return .snoozed }
        if session.settledAt != nil { return .settled }
        return .inbox
    }

    public struct Groups: Sendable, Equatable {
        public var inbox: [SessionMeta]
        public var snoozed: [SessionMeta]
        public var settled: [SessionMeta]
    }

    public static func groups(_ sessions: [SessionMeta], now: Double = .nowMs) -> Groups {
        Groups(
            inbox: sessions.filter { place(of: $0, now: now) == .inbox }.sorted { $0.updatedAt > $1.updatedAt },
            snoozed: sessions.filter { place(of: $0, now: now) == .snoozed }.sorted { ($0.snoozedUntil ?? 0) < ($1.snoozedUntil ?? 0) },
            settled: sessions.filter { place(of: $0, now: now) == .settled }.sorted { ($0.settledAt ?? 0) > ($1.settledAt ?? 0) }
        )
    }

    public struct SnoozeOption: Sendable, Equatable, Identifiable {
        public let label: String
        public let at: Date
        public var id: String { label }
    }

    /// Snooze choices in local time: in an hour, this evening, tomorrow morning, the weekend, next week.
    public static func snoozeOptions(now: Date = .now, calendar: Calendar = .current) -> [SnoozeOption] {
        func at(days: Int, hour: Int) -> Date {
            let day = calendar.date(byAdding: .day, value: days, to: now) ?? now
            return calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day
        }
        var options = [SnoozeOption(label: "In 1 hour", at: now.addingTimeInterval(3600))]
        let evening = at(days: 0, hour: 18)
        if evening.timeIntervalSince(now) > 90 * 60 { options.append(SnoozeOption(label: "This evening", at: evening)) }
        options.append(SnoozeOption(label: "Tomorrow", at: at(days: 1, hour: 9)))
        // JavaScript's getDay(): Sunday is 0.
        let weekday = calendar.component(.weekday, from: now) - 1
        if (1...4).contains(weekday) { options.append(SnoozeOption(label: "This weekend", at: at(days: 6 - weekday, hour: 9))) }
        let toMonday = (8 - weekday) % 7
        options.append(SnoozeOption(label: "Next week", at: at(days: toMonday == 0 ? 7 : toMonday, hour: 9)))
        return options
    }

    /// "until 6:00 PM" today, else "until Sat 9:00 AM".
    public static func snoozedLabel(_ until: Double, now: Date = .now, calendar: Calendar = .current) -> String {
        let date = Date(timeIntervalSince1970: until / 1000)
        let time = date.formatted(date: .omitted, time: .shortened)
        if calendar.isDate(date, inSameDayAs: now) { return "until \(time)" }
        return "until \(date.formatted(.dateTime.weekday(.abbreviated))) \(time)"
    }
}
