import DexCore
import Observation
import SwiftUI

/// One window's usage at a glance (`usageGlance()`), shared by the Chats toolbar's gauge and Settings' Usage row so they
/// fetch once. Views that show it keep it fresh with `.usageGlanceUpdates()`.
@MainActor
@Observable
final class UsageGlanceStore {
    /// Nil until the first answer, and on an agent that predates `usageGlance` (the plain usage icon shows then).
    private(set) var glance: UsageGlance?
    @ObservationIgnored private var loading: Task<Void, Never>?
    @ObservationIgnored private var loadedAt = Date.distantPast

    /// Asks the agent again, unless it answered in the last 30 seconds (it caches that long anyway) or `force`.
    func refresh(_ client: DexClient, force: Bool = false) async {
        if let loading { return await loading.value }
        guard client.isConnected, force || Date.now.timeIntervalSince(loadedAt) > 30 else { return }
        let task = Task {
            // An older agent has no usageGlance ("Method usageGlance does not exist"): nothing to show, quietly.
            if let glance = try? await client.usageGlance() { self.glance = glance }
            loadedAt = .now
        }
        loading = task
        await task.value
        loading = nil
    }
}

extension UsageMeter.Tone {
    /// Neutral, amber nearing the limit, red at it (the Usage page's meters).
    var color: Color {
        switch self {
        case .normal: .secondary
        case .warning: .orange
        case .critical: .red
        }
    }
}

/// Keeps the window's usage glance fresh while this view is on screen: on appear, on returning to the foreground,
/// every two minutes, and when a chat finishes (its tokens count now).
private struct UsageGlanceUpdates: ViewModifier {
    @Environment(DexClient.self) private var client
    @Environment(UsageGlanceStore.self) private var usage
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        let working = client.state?.sessions.filter(\.busy).count ?? 0
        content
            .task(id: client.isConnected) {
                while !Task.isCancelled {
                    await usage.refresh(client)
                    try? await Task.sleep(for: .seconds(120))
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await usage.refresh(client) } }
            }
            .onChange(of: working) { old, new in
                if new < old { Task { await usage.refresh(client, force: true) } }
            }
    }
}

extension View {
    func usageGlanceUpdates() -> some View { modifier(UsageGlanceUpdates()) }
}

/// The Chats toolbar's way into Usage: a ring filled to the busiest allowance (OpenCode Go's 5 hours at 42%, say), or the
/// usage symbol when no plan has one. One tap opens the Usage page, the way other apps keep a usage meter at hand.
struct UsageGaugeButton: View {
    @Environment(UsageGlanceStore.self) private var usage
    let action: () -> Void

    var body: some View {
        let glance = usage.glance
        Button(action: action) {
            if let meter = glance?.top {
                UsageRing(meter: meter)
            } else {
                Image(systemName: "chart.bar.xaxis")
            }
        }
        .accessibilityLabel(glance.map { "Usage, \($0.spokenSummary)" } ?? "Usage")
        .accessibilityIdentifier("chats.usage")
        .usageGlanceUpdates()
    }
}

/// A small ring filled to a meter's share used.
private struct UsageRing: View {
    let meter: UsageMeter

    var body: some View {
        let lineWidth: CGFloat = 3
        ZStack {
            Circle().stroke(.quaternary, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: max(meter.fraction, meter.fraction > 0 ? 0.02 : 0))
                .stroke(meter.tone.color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .padding(lineWidth / 2)
        .frame(width: 20, height: 20)
        .animation(.smooth(duration: 0.5), value: meter.fraction)
    }
}
