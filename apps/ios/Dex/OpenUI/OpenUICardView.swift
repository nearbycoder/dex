import DexCore
import SwiftUI

/// A chat's generated UI (a `render_ui` call), rendered natively, live while its program streams in. Its Query()
/// and Mutation() calls run app operations, its form and filter state is saved per card, and presses send messages
/// to the chat or open places in Dex (the web's OpenUIBlock).
struct OpenUICardView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let feed: ChatFeed
    let call: ContentBlock.ToolCall
    let streaming: Bool
    @State private var card: OpenUICard?

    private var code: String { call.arguments["code"]?.string ?? "" }

    var body: some View {
        let session = OpenUISessionCards.for(feed)
        Group {
            if let card {
                OpenUICardBody(card: card, streaming: streaming)
            } else {
                OpenUICardSkeleton()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // A container element, so the reply's identifier doesn't replace its controls' own.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("openui.card")
        .task(id: session.loaded) {
            guard card == nil else { return }
            if !session.loaded { await session.load(client) }
            let made = session.card(call.id) { makeHost(session: session) }
            made.update(code: code, streaming: streaming)
            card = made
        }
        .onChange(of: code) { _, code in card?.update(code: code, streaming: streaming) }
        .onChange(of: streaming) { _, streaming in card?.update(code: code, streaming: streaming) }
        .onAppear { card?.visible = true }
        .onDisappear { card?.visible = false }
        .onChange(of: card == nil) { _, _ in card?.visible = true }
    }

    private func makeHost(session: OpenUISessionCards) -> OpenUICardHost {
        let sessionId = feed.sessionId
        let cardId = call.id
        return OpenUICardHost(
            run: { [client] name, args, query, confirmed in
                try await client.runUiOperation(sessionId: sessionId, name: name, args: args, query: query, confirmed: confirmed)
            },
            send: { [feed] text in try await feed.send(text) },
            storeSecret: { [feed] field, value in try await feed.storeSecret(field: field, value: value) },
            saveState: { [client] state in
                session.states[cardId] = state
                Task { try? await client.saveUiState(sessionId: sessionId, card: cardId, state: state) }
            },
            open: { [router] destination in
                switch destination {
                case .url(let url): if !router.handle(url) { InAppBrowser.open(url) }
                case .chat(let id): router.openChat(id)
                case .file(let path): router.openFile(path)
                case .machine(let key): router.openMachine(key)
                }
            },
            copy: { text in
                UIPasteboard.general.string = text
                return true
            }
        )
    }
}

/// The card: the program's components on a soft grouped surface, then what went wrong (failed live data, problems
/// with a "Fix it" button) and short notices. Admin operations ask before they run.
private struct OpenUICardBody: View {
    @Bindable var card: OpenUICard
    let streaming: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let tree = card.document.tree {
                OpenUINodeView(node: tree)
                    .opacity(card.document.loading ? 0.75 : 1)
                    .overlay(alignment: .topTrailing) {
                        if card.document.loading {
                            ProgressView().controlSize(.small).padding(12).accessibilityLabel("Loading data")
                        }
                    }
                    .animation(.smooth, value: card.document.loading)
            } else if streaming {
                OpenUICardSkeleton()
            } else if let error = card.document.engineError {
                Label(error, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.orange)
            }
            footer
        }
        .environment(card)
        .environment(\.openUIStreaming, streaming)
        .alert("This button will", isPresented: Binding(get: { card.confirmation != nil }, set: { if !$0 { card.confirm(false) } }), presenting: card.confirmation) { _ in
            Button("Confirm") { card.confirm(true) }
                .accessibilityIdentifier("openui.confirm")
            Button("Cancel", role: .cancel) { card.confirm(false) }
        } message: { confirmation in
            Text(confirmation.summary)
        }
        .sensoryFeedback(.warning, trigger: card.confirmation?.id) { _, new in new != nil }
    }

    @ViewBuilder
    private var footer: some View {
        ForEach(card.toolErrors, id: \.self) { message in
            Label(message, systemImage: "exclamationmark.circle")
                .font(.caption)
                .foregroundStyle(.red)
                .padding(.horizontal, 4)
                .accessibilityIdentifier("openui.toolError")
        }
        if let error = card.error {
            Label(error, systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(.red).padding(.horizontal, 4)
        }
        if !streaming, !card.problems.isEmpty || card.notice != nil {
            HStack(spacing: 10) {
                if !card.problems.isEmpty {
                    Label("\(card.problems.count) \(card.problems.count == 1 ? "problem" : "problems") in this UI", systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .help(card.problems.joined(separator: "\n"))
                    Button {
                        Task { try? await card.fix() }
                    } label: {
                        Label("Fix it", systemImage: "wrench.adjustable")
                            .font(.caption.weight(.medium))
                    }
                    .buttonStyle(.glass)
                    .controlSize(.small)
                    .accessibilityIdentifier("openui.fix")
                }
                if let notice = card.notice {
                    Label(notice, systemImage: "checkmark").font(.caption).foregroundStyle(.green).transition(.opacity)
                }
            }
            .padding(.horizontal, 4)
        }
    }
}

/// While the saved states load, or before the program has a root.
struct OpenUICardSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            LineBone(width: 160, font: .headline)
            LineBone(font: .subheadline)
            RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.quaternary).frame(height: 80)
        }
        .padding(16)
        .background(.background.secondary, in: .rect(cornerRadius: 22, style: .continuous))
        .redacted(reason: .placeholder)
        .accessibilityLabel("Loading")
    }
}

/// One chat's cards and their saved states, kept while the chat is (so reopening it shows each card as you left
/// it: filters, forms, open tabs).
@MainActor
@Observable
final class OpenUISessionCards {
    private(set) var loaded = false
    @ObservationIgnored var states: [String: JSONValue] = [:]
    @ObservationIgnored private var cards: [String: OpenUICard] = [:]
    @ObservationIgnored private var loading: Task<Void, Never>?

    private static var bySession: [ObjectIdentifier: (feed: WeakFeed, cards: OpenUISessionCards)] = [:]
    struct WeakFeed { weak var feed: ChatFeed? }

    static func `for`(_ feed: ChatFeed) -> OpenUISessionCards {
        bySession = bySession.filter { $0.value.feed.feed != nil }
        let key = ObjectIdentifier(feed)
        if let found = bySession[key], found.feed.feed === feed { return found.cards }
        let made = OpenUISessionCards()
        bySession[key] = (WeakFeed(feed: feed), made)
        return made
    }

    /// Loads the chat's saved card states (a card waits for them, so it opens as you left it).
    func load(_ client: DexClient) async {
        if let loading { return await loading.value }
        guard let feedId = Self.bySession.first(where: { $0.value.cards === self })?.value.feed.feed?.sessionId else { return }
        let task = Task { @MainActor in
            states = (try? await client.uiStates(sessionId: feedId)) ?? [:]
            loaded = true
        }
        loading = task
        await task.value
    }

    func card(_ id: String, host: () -> OpenUICardHost) -> OpenUICard {
        if let card = cards[id] { return card }
        let card = OpenUICard(id: id, savedState: states[id], host: host())
        cards[id] = card
        return card
    }
}

private struct OpenUIStreamingKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// The card's program is still streaming in: controls are disabled.
    var openUIStreaming: Bool {
        get { self[OpenUIStreamingKey.self] }
        set { self[OpenUIStreamingKey.self] = newValue }
    }
}
