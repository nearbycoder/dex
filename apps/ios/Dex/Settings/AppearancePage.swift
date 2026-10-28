import SwiftUI

/// Settings → Appearance: light, dark, or the system's, and the color theme. Both are kept on this device and apply at
/// once to every window.
struct AppearancePage: View {
    @Bindable private var store = ThemeStore.shared

    var body: some View {
        Form {
            Section {
                Picker("Appearance", selection: $store.appearance) {
                    ForEach(Appearance.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
                .accessibilityIdentifier("appearance.mode")
            }

            Section {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 92, maximum: 140), spacing: 12)], spacing: 16) {
                    ForEach(Theme.all) { theme in
                        ThemeSwatch(theme: theme, selected: store.theme == theme) {
                            withAnimation(.smooth) { store.theme = theme }
                        }
                    }
                }
                .padding(.vertical, 8)
            } header: {
                Text("Theme")
            } footer: {
                Text("The accent for buttons, links, your messages, and selected rows. Each theme has a light and a dark shade.")
            }

            Section("Preview") {
                ThemePreview()
            }
        }
        .navigationTitle("Appearance")
        .sensoryFeedback(.selection, trigger: store.theme)
    }
}

/// One theme: its light and dark accents side by side in a circle, and its name.
private struct ThemeSwatch: View {
    let theme: Theme
    let selected: Bool
    let pick: () -> Void

    var body: some View {
        Button(action: pick) {
            VStack(spacing: 8) {
                ZStack {
                    HStack(spacing: 0) {
                        Color(uiColor: .hex(theme.accentLight))
                        Color(uiColor: .hex(theme.accentDark))
                    }
                    .frame(width: 52, height: 52)
                    .clipShape(.circle)
                    .overlay(Circle().strokeBorder(.primary.opacity(0.1)))
                    if selected {
                        Image(systemName: "checkmark")
                            .font(.body.weight(.bold))
                            .foregroundStyle(.white)
                            .shadow(color: .black.opacity(0.35), radius: 2)
                    }
                }
                .padding(4)
                .overlay(Circle().strokeBorder(selected ? Color(uiColor: theme.uiAccent) : .clear, lineWidth: 2.5))
                Text(theme.name)
                    .font(.footnote.weight(selected ? .semibold : .regular))
                    .foregroundStyle(selected ? .primary : .secondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(theme.name)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier("theme.\(theme.id)")
    }
}

/// How the theme looks: a message, a link, a toggle, and a button.
private struct ThemePreview: View {
    @State private var on = true

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Spacer(minLength: 40)
                Text("Make the chart weekly instead.")
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .foregroundStyle(.white)
                    .background(Color.selectionAccent.gradient, in: .rect(cornerRadius: 20, style: .continuous))
            }
            Text("Done — see [the updated chart](https://dex.example).")
            Toggle("On for new chats", isOn: $on)
            Button("Send") {}
                .prominentButton()
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("appearance.preview")
    }
}
