import DexCore
import SwiftUI

/// A status dot: running (green), working (amber, pulsing), stopped (gray), failed (red).
struct StatusDot: View {
    enum Kind { case running, working, idle, failed }
    let kind: Kind
    var size: CGFloat = 8

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .symbolEffect(.pulse, isActive: kind == .working)
            .phaseAnimator([1.0, 0.35], trigger: kind == .working) { view, phase in
                view.opacity(kind == .working ? phase : 1)
            }
            .accessibilityHidden(true)
    }

    private var color: Color {
        switch kind {
        case .running: .green
        case .working: .orange
        case .idle: .secondary
        case .failed: .red
        }
    }

    static func vm(_ vm: VmInfo) -> Kind {
        if vm.status == "error" || vm.setup.status == "error" { return .failed }
        if vm.status == "starting" || vm.status == "stopping" || vm.setup.status == "running" || vm.busy { return .working }
        if vm.status == "running" { return .running }
        return .idle
    }
}

/// A rounded glass panel for content that floats over a page (cards, the composer, popovers).
struct GlassPanel<Content: View>: View {
    var cornerRadius: CGFloat = 22
    var interactive = false
    @ViewBuilder var content: Content

    var body: some View {
        content
            .glassEffect(interactive ? .regular.interactive() : .regular, in: .rect(cornerRadius: cornerRadius))
    }
}

/// A card on a page's background: grouped content with a soft surface (not glass: glass is for controls and chrome).
struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background.secondary, in: .rect(cornerRadius: 20, style: .continuous))
    }
}

/// A placeholder bone for loading states, in a line box of the text it stands for.
struct LineBone: View {
    var width: CGFloat? = nil
    var font: Font = .body

    var body: some View {
        Text("Loading")
            .font(font)
            .hidden()
            .frame(maxWidth: width ?? .infinity, alignment: .leading)
            .overlay(alignment: .leading) {
                Capsule()
                    .fill(.quaternary)
                    .frame(maxWidth: width ?? .infinity)
                    .padding(.vertical, 3)
            }
            .accessibilityHidden(true)
    }
}

/// Runs an async action from a button, showing progress and reporting a failure as the window's notice.
struct AsyncButton<Label: View>: View {
    @Environment(DexClient.self) private var client
    var role: ButtonRole? = nil
    let action: () async throws -> Void
    @ViewBuilder var label: Label
    @State private var running = false

    var body: some View {
        Button(role: role) {
            guard !running else { return }
            running = true
            Task {
                defer { running = false }
                do { try await action() } catch { client.notice = error.localizedDescription }
            }
        } label: {
            label.opacity(running ? 0.4 : 1)
                .overlay { if running { ProgressView().controlSize(.small) } }
        }
        .disabled(running)
    }
}

extension AsyncButton where Label == Text {
    init(_ title: String, role: ButtonRole? = nil, action: @escaping () async throws -> Void) {
        self.role = role
        self.action = action
        self.label = Text(title)
    }
}

/// An empty page's message with an optional action.
struct EmptyStateView: View {
    let title: String
    let symbol: String
    var message: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: symbol)
        } description: {
            if let message { Text(message) }
        } actions: {
            if let actionTitle, let action {
                Button(actionTitle, action: action).buttonStyle(.glassProminent)
            }
        }
    }
}

extension View {
    /// Plays the light system tap used on every control (the web's haptics).
    func tapHaptic<T: Equatable>(_ trigger: T) -> some View {
        sensoryFeedback(.selection, trigger: trigger)
    }
}
