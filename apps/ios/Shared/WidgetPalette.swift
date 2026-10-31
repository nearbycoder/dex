import DexCore
import SwiftUI
import UIKit

/// The theme's accent (light and dark shades) as the widgets draw it. The app saves it in the App Group whenever the
/// theme changes; the widgets read it. Nonisolated: UIKit resolves dynamic colors on whatever thread draws.
nonisolated struct WidgetPalette: Equatable, Sendable {
    var light: UInt32
    var dark: UInt32

    /// Emerald, the default theme.
    static let standard = WidgetPalette(light: 0x059669, dark: 0x34D399)

    var accent: Color {
        let (light, dark) = (light, dark)
        return Color(uiColor: UIColor { @Sendable traits in Self.color(traits.userInterfaceStyle == .dark ? dark : light) })
    }

    /// Text on the accent: black where it's too light for white (as the app's `onAccent`).
    var onAccent: Color {
        let (light, dark) = (light, dark)
        return Color(uiColor: UIColor { @Sendable traits in Self.isLight(traits.userInterfaceStyle == .dark ? dark : light) ? .black : .white })
    }

    static func load(from defaults: UserDefaults? = AppGroup.defaults) -> WidgetPalette {
        guard let values = defaults?.array(forKey: AppGroup.accentKey) as? [Int], values.count == 2 else { return .standard }
        return WidgetPalette(light: UInt32(truncatingIfNeeded: values[0]), dark: UInt32(truncatingIfNeeded: values[1]))
    }

    func save(to defaults: UserDefaults? = AppGroup.defaults) {
        defaults?.set([Int(light), Int(dark)], forKey: AppGroup.accentKey)
    }

    private static func color(_ value: UInt32) -> UIColor {
        UIColor(red: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255, blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }

    /// White's contrast on it is under 3:1.
    private static func isLight(_ value: UInt32) -> Bool {
        func channel(_ shift: UInt32) -> Double {
            let c = Double((value >> shift) & 0xFF) / 255
            return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        let luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
        return 1.05 / (luminance + 0.05) < 3
    }
}
