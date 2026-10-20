import Foundation

/// Formatting shared by every screen, matching the web's client/lib/format.ts.
public enum Format {
    /// "just now", "5 min. ago", "3 hr. ago", "yesterday", "2 wk. ago" (the web's Intl short relative time).
    public static func ago(_ milliseconds: Double, now: Date = .now) -> String {
        let date = Date(timeIntervalSince1970: milliseconds / 1000)
        if abs(now.timeIntervalSince(date)) < 60 { return "just now" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        formatter.dateTimeStyle = .named
        return formatter.localizedString(for: date, relativeTo: now)
    }

    /// "Oct 19" (or "Oct 19, 2025" in another year).
    public static func date(_ milliseconds: Double, now: Date = .now) -> String {
        let date = Date(timeIntervalSince1970: milliseconds / 1000)
        let sameYear = Calendar.current.isDate(date, equalTo: now, toGranularity: .year)
        return date.formatted(sameYear ? .dateTime.month(.abbreviated).day() : .dateTime.month(.abbreviated).day().year())
    }

    /// "Oct 19, 5:08 PM".
    public static func dateTime(_ milliseconds: Double) -> String {
        Date(timeIntervalSince1970: milliseconds / 1000).formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }

    /// "5:08 PM".
    public static func time(_ milliseconds: Double) -> String {
        Date(timeIntervalSince1970: milliseconds / 1000).formatted(.dateTime.hour().minute())
    }

    /// "34.2 KB".
    public static func bytes(_ count: Int) -> String {
        if count < 1024 { return "\(count) B" }
        let units = ["KB", "MB", "GB", "TB"]
        var value = Double(count) / 1024
        var unit = 0
        while value >= 1024, unit < units.count - 1 { value /= 1024; unit += 1 }
        return String(format: value >= 100 ? "%.0f %@" : "%.1f %@", value, units[unit])
    }

    /// "1.2M", "34K", "980".
    public static func tokens(_ count: Double) -> String {
        if count >= 1_000_000 { return String(format: "%.1fM", count / 1_000_000) }
        if count >= 1_000 { return String(format: count >= 10_000 ? "%.0fK" : "%.1fK", count / 1_000) }
        return String(Int(count))
    }

    /// "$1.23", or "<$0.01".
    public static func usd(_ value: Double) -> String {
        if value > 0, value < 0.01 { return "<$0.01" }
        return value.formatted(.currency(code: "USD"))
    }

    /// "36s", "4m 12s", "1h 5m".
    public static func duration(_ milliseconds: Double) -> String {
        let seconds = Int((milliseconds / 1000).rounded())
        if seconds < 60 { return "\(max(seconds, 1))s" }
        let minutes = seconds / 60
        if minutes < 60 { return seconds % 60 == 0 ? "\(minutes)m" : "\(minutes)m \(seconds % 60)s" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }

    /// The skill a message asks for: `/name …` at its start.
    public static func invokedSkill(_ text: String) -> String? {
        let trimmed = text.drop { $0.isWhitespace }
        guard trimmed.first == "/" else { return nil }
        let name = trimmed.dropFirst().prefix { $0.isLetter || $0.isNumber || $0 == "-" }
        guard let first = name.first, first.isLowercase || first.isNumber, name.count <= 64,
              name.allSatisfy({ ($0.isLowercase && $0.isASCII) || $0.isNumber || $0 == "-" }) else { return nil }
        let rest = trimmed.dropFirst(1 + name.count)
        return rest.isEmpty || rest.first!.isWhitespace ? String(name) : nil
    }
}

public extension Double {
    /// Milliseconds since 1970 for now.
    static var nowMs: Double { Date.now.timeIntervalSince1970 * 1000 }
}
