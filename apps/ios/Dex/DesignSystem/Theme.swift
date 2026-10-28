import SwiftUI
import UIKit

/// A color theme: the accent (buttons, links, your messages, the tab bar) and the deeper selection color behind white
/// text on selected rows, each with a light and a dark shade. Chosen in Settings → Appearance, kept on this device.
/// Nonisolated: SwiftUI resolves its colors off the main thread.
nonisolated struct Theme: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let accentLight: UInt32
    let accentDark: UInt32
    let selectionLight: UInt32
    let selectionDark: UInt32

    var accent: Color { Color(uiColor: uiAccent) }
    var uiAccent: UIColor { .dynamic(light: accentLight, dark: accentDark) }
    var selection: Color { Color(uiColor: .dynamic(light: selectionLight, dark: selectionDark)) }
    /// Text and icons on an accent fill (your messages, prominent buttons): white, or black where the accent is light.
    var onAccent: Color {
        let (light, dark) = (accentLight, accentDark)
        return Color(uiColor: UIColor { @Sendable traits in
            UIColor.isLight(traits.userInterfaceStyle == .dark ? dark : light) ? .black : .white
        })
    }

    static let all: [Theme] = [
        Theme(id: "emerald", name: "Emerald", accentLight: 0x059669, accentDark: 0x34D399, selectionLight: 0x059669, selectionDark: 0x047857),
        Theme(id: "graphite", name: "Graphite", accentLight: 0x3F3F46, accentDark: 0xD4D4D8, selectionLight: 0x52525B, selectionDark: 0x3F3F46),
        Theme(id: "ocean", name: "Ocean", accentLight: 0x2563EB, accentDark: 0x60A5FA, selectionLight: 0x2563EB, selectionDark: 0x1D4ED8),
        Theme(id: "indigo", name: "Indigo", accentLight: 0x4F46E5, accentDark: 0x818CF8, selectionLight: 0x4F46E5, selectionDark: 0x4338CA),
        Theme(id: "violet", name: "Violet", accentLight: 0x7C3AED, accentDark: 0xA78BFA, selectionLight: 0x7C3AED, selectionDark: 0x6D28D9),
        Theme(id: "fuchsia", name: "Fuchsia", accentLight: 0xC026D3, accentDark: 0xE879F9, selectionLight: 0xC026D3, selectionDark: 0xA21CAF),
        Theme(id: "rose", name: "Rose", accentLight: 0xE11D48, accentDark: 0xFB7185, selectionLight: 0xE11D48, selectionDark: 0xBE123C),
        Theme(id: "sunset", name: "Sunset", accentLight: 0xEA580C, accentDark: 0xFB923C, selectionLight: 0xEA580C, selectionDark: 0xC2410C),
        Theme(id: "amber", name: "Amber", accentLight: 0xB45309, accentDark: 0xFBBF24, selectionLight: 0xB45309, selectionDark: 0x92400E),
        Theme(id: "teal", name: "Teal", accentLight: 0x0D9488, accentDark: 0x2DD4BF, selectionLight: 0x0D9488, selectionDark: 0x0F766E),
    ]

    static let `default` = all[0]

    /// The theme with this id, or the default for an unknown or missing one.
    static func named(_ id: String?) -> Theme { all.first { $0.id == id } ?? .default }
}

/// Light, dark, or the system's.
nonisolated enum Appearance: String, CaseIterable, Identifiable, Sendable {
    case system, light, dark
    var id: String { rawValue }
    var title: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
    var interfaceStyle: UIUserInterfaceStyle {
        switch self {
        case .system: .unspecified
        case .light: .light
        case .dark: .dark
        }
    }
}

/// This device's theme and appearance. Views that read `Color.dexAccent` (or the store) redraw when either changes, in
/// every window; UIKit's windows get the accent as their tint, for what SwiftUI doesn't draw (alerts, Safari).
@MainActor
@Observable
final class ThemeStore {
    static let shared = ThemeStore()
    static let themeKey = "dex.theme"
    static let appearanceKey = "dex.appearance"

    var theme: Theme {
        didSet {
            UserDefaults.standard.set(theme.id, forKey: Self.themeKey)
            applyToWindows()
        }
    }

    var appearance: Appearance {
        didSet {
            UserDefaults.standard.set(appearance.rawValue, forKey: Self.appearanceKey)
            applyToWindows()
        }
    }

    private init() {
        let defaults = UserDefaults.standard
        // A reset launch (UI tests) starts on the default theme, as on a new device.
        if LaunchOptions.current.resetState {
            defaults.removeObject(forKey: Self.themeKey)
            defaults.removeObject(forKey: Self.appearanceKey)
        }
        // UI tests and screenshots can start in a theme (`-DexTheme ocean`, or DEX_THEME in the environment), which
        // then sticks like a pick.
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "-DexTheme"), arguments.indices.contains(index + 1) {
            defaults.set(arguments[index + 1], forKey: Self.themeKey)
        } else if let theme = ProcessInfo.processInfo.environment["DEX_THEME"], !theme.isEmpty {
            defaults.set(theme, forKey: Self.themeKey)
        }
        theme = Theme.named(defaults.string(forKey: Self.themeKey))
        appearance = Appearance(rawValue: defaults.string(forKey: Self.appearanceKey) ?? "") ?? .system
    }

    /// Tints every window (and sets its light or dark style) to match.
    func applyToWindows() {
        for scene in UIApplication.shared.connectedScenes {
            guard let scene = scene as? UIWindowScene else { continue }
            for window in scene.windows {
                window.tintColor = theme.uiAccent
                window.overrideUserInterfaceStyle = appearance.interfaceStyle
            }
        }
    }
}

extension Color {
    /// The theme's accent. Use it rather than `Color.accentColor`, which is the asset catalog's fixed green.
    static var dexAccent: Color { ThemeStore.shared.theme.accent }
    /// The accent behind a selected row: deeper than the accent in dark mode, where white text on the accent is hard
    /// to read. Put it on the list itself, not its column, so the column's toolbar keeps the accent.
    static var selectionAccent: Color { ThemeStore.shared.theme.selection }
    /// Text and icons on an accent fill.
    static var onAccent: Color { ThemeStore.shared.theme.onAccent }
}

extension UIColor {
    nonisolated static func hex(_ value: UInt32) -> UIColor {
        UIColor(red: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255, blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }

    /// Resolved by UIKit and SwiftUI on whatever thread draws, so nothing in it may be main-actor isolated.
    nonisolated static func dynamic(light: UInt32, dark: UInt32) -> UIColor {
        UIColor { @Sendable traits in traits.userInterfaceStyle == .dark ? .hex(dark) : .hex(light) }
    }

    /// Too light for white text: white's contrast on it is under 3:1 (WCAG, large text and icons). Mid-tones keep
    /// white, as the app always had.
    nonisolated static func isLight(_ value: UInt32) -> Bool {
        func channel(_ shift: UInt32) -> Double {
            let c = Double((value >> shift) & 0xFF) / 255
            return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        let luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
        return 1.05 / (luminance + 0.05) < 3
    }
}

extension View {
    /// The filled button in the theme's accent, its text readable on it (black on the light accents, such as Graphite
    /// and Amber in dark mode). Buttons tinted with a color of their own (orange approvals) use `.glassProminent`.
    func prominentButton() -> some View {
        buttonStyle(.glassProminent).foregroundStyle(Color.onAccent)
    }
}
