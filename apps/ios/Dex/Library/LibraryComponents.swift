import DexCore
import SwiftUI

// Pieces the Library pages share: moving between routes, the icon and color pickers, skeletons, and small badges.

extension Router {
    /// Every Library stack (the compact tab's and each sidebar page's).
    private var libraryPaths: [ReferenceWritableKeyPath<Router, [LibraryRoute]>] { [\.libraryPath, \.agentsPath, \.projectsPath, \.skillsPath, \.mcpPath] }

    /// Swaps a route for another wherever it's open (a new item that was just created becomes that item).
    func replaceLibrary(_ old: LibraryRoute, with new: LibraryRoute) {
        for path in libraryPaths {
            if let index = self[keyPath: path].lastIndex(of: old) { self[keyPath: path][index] = new }
        }
    }

    /// Closes a route (and anything opened from it) wherever it's open: after a delete, or cancelling a new item.
    func closeLibrary(_ route: LibraryRoute) {
        for path in libraryPaths {
            if let index = self[keyPath: path].firstIndex(of: route) { self[keyPath: path].removeSubrange(index...) }
        }
    }
}

/// The grid of icons an agent or project can wear.
struct IconGrid: View {
    @Binding var selection: String
    let color: String

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 44, maximum: 56), spacing: 8)], spacing: 8) {
            ForEach(AgentIcons.all, id: \.self) { icon in
                let selected = icon == selection
                Button {
                    selection = icon
                } label: {
                    Image(systemName: AgentIcons.symbol(icon))
                        .font(.system(size: 18, weight: .medium))
                        .frame(width: 44, height: 44)
                        .foregroundStyle(selected ? AgentColors.color(color) : .secondary)
                        .background(selected ? AgentColors.color(color).opacity(0.18) : Color(.tertiarySystemFill), in: .rect(cornerRadius: 12, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(selected ? AgentColors.color(color) : .clear, lineWidth: 2)
                        }
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(icon.replacingOccurrences(of: "-", with: " "))
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("icon.\(icon)")
            }
        }
        .padding(.vertical, 6)
        .sensoryFeedback(.selection, trigger: selection)
    }
}

/// The row of avatar colors.
struct ColorRow: View {
    @Binding var selection: String

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AgentColors.all, id: \.self) { name in
                let selected = name == selection
                Button {
                    selection = name
                } label: {
                    Circle()
                        .fill(AgentColors.color(name).gradient)
                        .frame(width: 30, height: 30)
                        .padding(4)
                        .overlay(Circle().strokeBorder(selected ? AgentColors.color(name) : .clear, lineWidth: 2.5))
                        .overlay {
                            if selected { Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.white) }
                        }
                        .frame(maxWidth: .infinity)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(name.capitalized)
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("color.\(name)")
            }
        }
        .padding(.vertical, 4)
        .sensoryFeedback(.selection, trigger: selection)
    }
}

/// The live preview at the top of an agent or project editor.
struct ProfileHeader: View {
    let icon: String
    let color: String
    var image: String? = nil
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 16) {
            AgentAvatar(icon: icon, color: color, image: image, size: 60)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.title2.bold()).lineLimit(2)
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// A multi-line text field for instructions, scripts, and notes.
struct LongTextField: View {
    let title: String
    @Binding var text: String
    var prompt: String = ""
    var monospaced = false
    var lines: ClosedRange<Int> = 4...14

    var body: some View {
        TextField(title, text: $text, prompt: Text(prompt), axis: .vertical)
            .lineLimit(lines)
            .font(monospaced ? .callout.monospaced() : .body)
            .autocorrectionDisabled(monospaced)
            .textInputAutocapitalization(monospaced ? .never : .sentences)
    }
}

/// A short inline problem under a field.
struct FieldProblem: View {
    let text: String
    var body: some View {
        Label(text, systemImage: "exclamationmark.circle.fill")
            .font(.footnote)
            .foregroundStyle(.red)
    }
}

/// Loading rows for a Library list: an avatar and two lines.
struct LibraryRowSkeleton: View {
    var avatar = true

    var body: some View {
        HStack(spacing: 12) {
            if avatar { RoundedRectangle(cornerRadius: 11, style: .continuous).fill(.quaternary).frame(width: 40, height: 40) }
            VStack(alignment: .leading, spacing: 4) {
                LineBone(width: 150)
                LineBone(width: 220, font: .subheadline)
            }
        }
        .padding(.vertical, 2)
        .accessibilityHidden(true)
    }
}

/// An editor's loading state: its header and a few sections, in the Form's own spacing.
struct EditorSkeleton: View {
    var body: some View {
        Form {
            Section {
                HStack(spacing: 16) {
                    RoundedRectangle(cornerRadius: 17, style: .continuous).fill(.quaternary).frame(width: 60, height: 60)
                    VStack(alignment: .leading, spacing: 6) {
                        LineBone(width: 160, font: .title2)
                        LineBone(width: 220, font: .subheadline)
                    }
                }
            }
            ForEach(0..<3, id: \.self) { _ in
                Section {
                    LineBone(width: 200)
                    LineBone(width: 260)
                }
            }
        }
        .accessibilityIdentifier("library.loading")
    }
}

/// A small capsule label beside a name (Private, Runs on VM, API key…).
struct Tag: View {
    let text: String
    var symbol: String? = nil
    var color: Color = .secondary

    var body: some View {
        HStack(spacing: 3) {
            if let symbol { Image(systemName: symbol) }
            Text(text)
        }
        .font(.caption2.weight(.medium))
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .foregroundStyle(color)
        .background(color.opacity(0.13), in: .capsule)
    }
}

/// A GitHub owner's avatar (a URL or a data URL), or their initial.
struct OwnerAvatar: View {
    let owner: String
    var url: String = ""
    var size: CGFloat = 36

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
        Group {
            if let image = AgentAvatar.decode(url) {
                Image(uiImage: image).resizable().interpolation(.medium).scaledToFill()
            } else {
                AsyncImage(url: URL(string: url.isEmpty ? "https://avatars.githubusercontent.com/\(owner)?s=96" : url)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Text(String(owner.prefix(1)).uppercased())
                        .font(.system(size: size * 0.42, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(.tertiarySystemFill))
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(shape)
        .accessibilityHidden(true)
    }
}

/// An MCP server's connection state as a status dot.
struct McpStatusDot: View {
    let status: String

    var body: some View {
        StatusDot(kind: kind)
    }

    private var kind: StatusDot.Kind {
        switch status {
        case "ready": .running
        case "failed": .failed
        case "connecting", "connected", "discovering", "authenticating": .working
        default: .idle
        }
    }
}

/// An icon tight beside its text, for metadata inside a row (a list's default label spacing is for whole rows).
struct CompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) {
            configuration.icon.imageScale(.small)
            configuration.title
        }
    }
}

extension LabelStyle where Self == CompactLabelStyle {
    static var compact: CompactLabelStyle { CompactLabelStyle() }
}

extension View {
    /// A Library list's "nothing here" message, placed as the list's only row.
    func libraryEmptyRow() -> some View {
        listRowBackground(Color.clear).listRowSeparator(.hidden).frame(maxWidth: .infinity)
    }
}
