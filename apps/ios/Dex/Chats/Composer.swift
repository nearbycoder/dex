import DexCore
import SwiftUI

/// The bottom of a chat: a note when the model's subscription isn't connected, the queue, and the composer.
struct ChatComposerArea: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let feed: ChatFeed
    let session: SessionMeta?

    var body: some View {
        VStack(spacing: 8) {
            if let session, let state = client.state, state.connectedProviders[client.catalog.provider(of: session.model)] != true {
                Button {
                    router.openSettings(.models)
                } label: {
                    Label("Connect \(ModelCatalog.providerName(client.catalog.provider(of: session.model))) to get answers, or pick another model", systemImage: "key")
                        .font(.caption)
                }
                .buttonStyle(.borderless)
                .tint(.orange)
            }
            QueuePanel(feed: feed)
            Composer(
                placeholder: feed.transcript.running ? "Queue a follow-up…" : "Message Dex, or / for skills…",
                running: feed.transcript.running,
                disabled: !client.isConnected,
                onSend: { text in try await feed.send(text) },
                onStop: { try await feed.abort() }
            ) {
                if let session {
                    ModelPickerButton(model: session.model, thinking: session.thinking) { model, thinking in
                        client.perform { try await feed.configure(model: model, thinking: thinking) }
                    }
                    McpPickerButton(selected: session.mcpServers) { servers in
                        client.perform { try await feed.configure(mcpServers: servers) }
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .frame(maxWidth: 784)
        .frame(maxWidth: .infinity)
    }
}

/// The message box: grows with its text, sends with Return on a hardware keyboard (Shift-Return for a new line),
/// and turns into Stop while the chat works.
struct Composer<Accessory: View>: View {
    @Environment(DexClient.self) private var client
    var placeholder: String
    var running = false
    var disabled = false
    var initialText = ""
    let onSend: (String) async throws -> Void
    var onStop: (() async throws -> Void)? = nil
    @ViewBuilder var accessory: Accessory
    @State private var text = ""
    @FocusState private var focused: Bool
    @State private var sent = 0

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                SkillSuggestions(text: $text)
                HStack(alignment: .bottom, spacing: 10) {
                    TextField(placeholder, text: $text, axis: .vertical)
                        .lineLimit(1...8)
                        .focused($focused)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .onKeyPress(.return, phases: .down) { press in
                            if press.modifiers.contains(.shift) { return .ignored }
                            send()
                            return .handled
                        }
                        .accessibilityIdentifier("composer.field")
                    if running, text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let onStop {
                        Button {
                            client.perform { try await onStop() }
                        } label: {
                            Image(systemName: "stop.fill").font(.body.weight(.bold)).frame(width: 22, height: 22)
                        }
                        .buttonStyle(.glassProminent)
                        .buttonBorderShape(.circle)
                        .tint(.red)
                        .keyboardShortcut(".", modifiers: .command)
                        .accessibilityLabel("Stop")
                        .accessibilityIdentifier("composer.stop")
                        .padding(6)
                    } else {
                        Button(action: send) {
                            Image(systemName: running ? "text.badge.plus" : "arrow.up").font(.body.weight(.bold)).frame(width: 22, height: 22)
                        }
                        .buttonStyle(.glassProminent)
                        .buttonBorderShape(.circle)
                        .disabled(disabled || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .keyboardShortcut(.return, modifiers: .command)
                        .accessibilityLabel(running ? "Queue" : "Send")
                        .accessibilityIdentifier("composer.send")
                        .padding(6)
                        .sensoryFeedback(.impact(weight: .light), trigger: sent)
                    }
                }
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 26, style: .continuous))
                HStack(spacing: 6) {
                    accessory
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 4)
            }
        }
        .onAppear { if text.isEmpty { text = initialText } }
        .onChange(of: initialText) { _, new in text = new }
    }

    private func send() {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, !disabled else { return }
        text = ""
        sent += 1
        Task {
            do { try await onSend(message) } catch {
                text = message
                client.notice = error.localizedDescription
            }
        }
    }
}

/// Messages waiting for the chat to finish its run: collapsible, with edit, reorder, delete, and Steer.
struct QueuePanel: View {
    @Environment(DexClient.self) private var client
    let feed: ChatFeed
    @State private var open = false
    @State private var editing: QueuedMessage?
    @State private var draft = ""

    var body: some View {
        let queue = feed.transcript.queue
        if !queue.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    withAnimation(.snappy) { open.toggle() }
                } label: {
                    HStack {
                        Image(systemName: "chevron.right").rotationEffect(.degrees(open ? 90 : 0)).font(.caption.weight(.bold))
                        Text(feed.transcript.queueHeld ? "\(queue.count) waiting · held until you send" : "\(queue.count) queued")
                            .font(.footnote.weight(.medium))
                        Spacer()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("queue.toggle")
                if open {
                    ForEach(Array(queue.enumerated()), id: \.element.id) { index, item in
                        HStack(spacing: 8) {
                            Text(item.text).font(.subheadline).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                            Menu {
                                Button { client.perform { try await feed.steerQueued(item.id) } } label: { Label(feed.transcript.running ? "Steer Now" : "Send Now", systemImage: "arrow.turn.down.right") }
                                Button {
                                    draft = item.text
                                    editing = item
                                } label: { Label("Edit", systemImage: "pencil") }
                                if index > 0 { Button { client.perform { try await feed.moveQueued(item.id, to: index - 1) } } label: { Label("Move Up", systemImage: "arrow.up") } }
                                if index < queue.count - 1 { Button { client.perform { try await feed.moveQueued(item.id, to: index + 1) } } label: { Label("Move Down", systemImage: "arrow.down") } }
                                Button(role: .destructive) { client.perform { try await feed.removeQueued(item.id) } } label: { Label("Delete", systemImage: "trash") }
                            } label: {
                                Image(systemName: "ellipsis.circle").font(.body)
                            }
                            .accessibilityIdentifier("queue.item.menu.\(index)")
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .accessibilityIdentifier("queue.item.\(index)")
                    }
                }
            }
            .glassEffect(.regular, in: .rect(cornerRadius: 20, style: .continuous))
            .alert("Edit queued message", isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } })) {
                TextField("Message", text: $draft)
                Button("Save") {
                    if let item = editing { client.perform { try await feed.editQueued(item.id, text: draft) } }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }
}
