import DexCore
import SwiftUI

/// The message box: grows with its text; on a hardware keyboard Return sends (Shift-Return for a new line) and ⌘↩
/// too. `/` at the start opens the skill menu. While the chat works, Send queues a follow-up and Stop ends the run.
struct Composer<Accessory: View>: View {
    @Environment(DexClient.self) private var client
    @Bindable var model: ComposerModel
    var placeholder: String
    var running = false
    var disabled = false
    let onSend: (String, [ChatAttachment]) async throws -> Void
    var onStop: (() async throws -> Void)? = nil
    /// Shown above the text, inside the box (the new chat's agent and project).
    var header: AnyView? = nil
    @ViewBuilder var accessory: Accessory
    @FocusState private var focused: Bool
    @State private var sent = 0
    @State private var skills = SkillMenuModel()

    var body: some View {
        let empty = model.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        // Waits for uploads, and for files that couldn't be attached to be removed, so nothing goes missing unnoticed.
        let canSend = !disabled && (!empty || !model.readyAttachments.isEmpty) && !model.uploading && model.failedAttachments.isEmpty
        GlassEffectContainer(spacing: 10) {
            VStack(alignment: .leading, spacing: 8) {
                if skills.isOpen, !disabled {
                    SkillMenuView(menu: skills) { name in
                        model.text = "/\(name) "
                        focused = true
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                VStack(alignment: .leading, spacing: 0) {
                    if let header { header.padding(.horizontal, 12).padding(.top, 12) }
                    AttachmentChips(model: model)
                    TextField(placeholder, text: $model.text, axis: .vertical)
                        .lineLimit(1...8)
                        .focused($focused)
                        .padding(.horizontal, 16)
                        .padding(.top, 14)
                        .padding(.bottom, 6)
                        .onKeyPress(keys: [.return, .upArrow, .downArrow, .tab, .escape], phases: .down) { press in handle(press) }
                        .accessibilityIdentifier("composer.field")
                    HStack(spacing: 6) {
                        AttachButton(model: model, disabled: disabled)
                        ScrollView(.horizontal) {
                            HStack(spacing: 6) { accessory }
                        }
                        .scrollIndicators(.hidden)
                        .scrollClipDisabled()
                        Spacer(minLength: 0)
                        if running, let onStop {
                            Button {
                                client.perform { try await onStop() }
                            } label: {
                                Image(systemName: "stop.fill").font(.footnote.weight(.bold)).frame(width: 20, height: 20)
                            }
                            .buttonStyle(.glass)
                            .buttonBorderShape(.circle)
                            .accessibilityLabel("Stop")
                            .accessibilityIdentifier("composer.stop")
                        }
                        Button(action: send) {
                            Image(systemName: "arrow.up").font(.body.weight(.bold)).frame(width: 20, height: 20)
                        }
                        .buttonStyle(.glassProminent)
                        .buttonBorderShape(.circle)
                        .disabled(!canSend)
                        .keyboardShortcut(.return, modifiers: .command)
                        .accessibilityLabel(running ? "Queue follow-up" : "Send")
                        .accessibilityIdentifier("composer.send")
                        .sensoryFeedback(.impact(weight: .light), trigger: sent)
                    }
                    .padding(.horizontal, 10)
                    .padding(.bottom, 10)
                }
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 26, style: .continuous))
            }
        }
        .animation(.smooth(duration: 0.25), value: skills.isOpen)
        .onChange(of: model.text, initial: true) { _, text in skills.update(text: text, skills: client.state?.skills ?? [], client: client) }
        .onChange(of: client.state?.skills) { _, list in skills.update(text: model.text, skills: list ?? [], client: client) }
        .onChange(of: model.focusRequest) { focused = true }
    }

    private func handle(_ press: KeyPress) -> KeyPress.Result {
        if skills.isOpen {
            switch press.key {
            case .escape: skills.close(); return .handled
            case .upArrow: skills.move(-1); return .handled
            case .downArrow: skills.move(1); return .handled
            case .tab, .return where !press.modifiers.contains(.shift):
                guard !skills.items.isEmpty else { break }
                Task { if let name = await skills.pickActive(client: client) { model.text = "/\(name) " } }
                return .handled
            default: break
            }
        }
        guard press.key == .return, !press.modifiers.contains(.shift) else { return .ignored }
        send()
        return .handled
    }

    private func send() {
        let message = model.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let drafts = model.attachments
        let ready = model.readyAttachments
        guard !disabled, !message.isEmpty || !ready.isEmpty, !model.uploading, model.failedAttachments.isEmpty else { return }
        model.text = ""
        model.attachments = []
        sent += 1
        Task {
            do { try await onSend(message, ready) } catch {
                // Back in the box, files included, to try again.
                if model.text.isEmpty { model.text = message }
                if model.attachments.isEmpty { model.attachments = drafts }
                client.notice = error.localizedDescription
            }
        }
    }
}

/// The slash lookup: your skills first, then skills.sh matches that install in place. Picking one puts
/// `/<name> ` in the message box.
@MainActor
@Observable
final class SkillMenuModel {
    enum Item: Identifiable, Equatable {
        case installed(SkillInfo)
        case directory(DirectorySkill)
        var id: String {
            switch self {
            case .installed(let skill): "installed:\(skill.id)"
            case .directory(let skill): "directory:\(skill.id)"
            }
        }
    }

    private(set) var query: String?
    private(set) var installed: [SkillInfo] = []
    private(set) var directory: [DirectorySkill] = []
    private(set) var loading = false
    private(set) var searched: String?
    private(set) var installing: String?
    var error: String?
    var active = 0
    /// Escape closed it, until the `/` query ends.
    private var closed = false
    private var results: [DirectorySkill] = []
    private var skills: [SkillInfo] = []
    private var search: Task<Void, Never>?

    var isOpen: Bool { query != nil && !closed }
    var items: [Item] { installed.map(Item.installed) + directory.map(Item.directory) }

    func update(text: String, skills: [SkillInfo], client: DexClient) {
        let next = DirectorySkill.slashQuery(text)?.lowercased()
        self.skills = skills
        if next == nil { closed = false }
        if next != query {
            query = next
            active = 0
            error = nil
            searchDirectory(next ?? "", client: client)
        }
        installed = DirectorySkill.installed(skills, matching: query ?? "")
        directory = (query?.count ?? 0) >= 2 ? DirectorySkill.notInstalled(results, have: skills) : []
    }

    func close() { closed = true }

    func move(_ by: Int) {
        guard !items.isEmpty else { return }
        active = (active + by + items.count) % items.count
    }

    /// skills.sh results for 2+ characters, debounced; a stale answer never replaces a newer one.
    private func searchDirectory(_ q: String, client: DexClient) {
        search?.cancel()
        guard q.count >= 2 else {
            results = []; directory = []; loading = false; searched = q
            return
        }
        loading = true
        search = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            do {
                let found: [DirectorySkill] = try await client.call("searchSkills", .string(q))
                guard !Task.isCancelled, query == q else { return }
                results = found
                directory = DirectorySkill.notInstalled(found, have: skills)
                error = nil
            } catch {
                guard !Task.isCancelled, query == q else { return }
                results = []
                directory = []
                self.error = error.localizedDescription
            }
            searched = q
            loading = false
        }
    }

    func pickActive(client: DexClient) async -> String? {
        let all = items
        guard !all.isEmpty else { return nil }
        return await pick(all[min(active, all.count - 1)], client: client)
    }

    /// The skill's name to put in the box; a skills.sh one is installed first.
    func pick(_ item: Item, client: DexClient) async -> String? {
        guard installing == nil else { return nil }
        switch item {
        case .installed(let skill):
            return skill.id
        case .directory(let skill):
            installing = skill.id
            error = nil
            defer { installing = nil }
            do {
                let installed: SkillInfo = try await client.call("installSkill", .string(skill.source), .string(skill.skillId), timeout: 120)
                return installed.id
            } catch {
                self.error = error.localizedDescription
                return nil
            }
        }
    }
}

struct SkillMenuView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    let menu: SkillMenuModel
    let onPick: (String) -> Void

    var body: some View {
        let q = menu.query ?? ""
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    if !menu.installed.isEmpty { heading("Your Skills") }
                    ForEach(Array(menu.installed.enumerated()), id: \.element.id) { index, skill in
                        row(index: index, item: .installed(skill)) {
                            Image(systemName: "sparkles").foregroundStyle(.tint).frame(width: 22)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("/\(skill.id)").font(.subheadline.monospaced().weight(.medium))
                                if !skill.description.isEmpty { Text(skill.description).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                            }
                        }
                        .accessibilityIdentifier("skill.suggestion.\(skill.id)")
                    }
                    if q.count >= 2 {
                        HStack(spacing: 6) {
                            heading("skills.sh")
                            if menu.loading { ProgressView().controlSize(.mini) }
                        }
                    }
                    ForEach(Array(menu.directory.enumerated()), id: \.element.id) { offset, skill in
                        row(index: menu.installed.count + offset, item: .directory(skill)) {
                            Image(systemName: "arrow.down.circle").foregroundStyle(.secondary).frame(width: 22)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(skill.name).font(.subheadline.weight(.medium))
                                Text("\(skill.source) · \(DirectorySkill.formatInstalls(skill.installs)) installs").font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer(minLength: 4)
                            HStack(spacing: 4) {
                                if menu.installing == skill.id { ProgressView().controlSize(.mini) } else { Image(systemName: "plus") }
                                Text("Install")
                            }
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(.quaternary, in: .capsule)
                        }
                        .accessibilityIdentifier("skill.directory.\(skill.skillId)")
                    }
                    if q.count >= 2, !menu.loading, menu.searched == q, menu.directory.isEmpty, menu.installed.isEmpty, menu.error == nil {
                        note("No skills match “\(q)”.")
                    }
                    if q.count < 2, menu.installed.isEmpty { note("Type to search skills.sh.") }
                    if let error = menu.error { note(error).foregroundStyle(.red) }
                }
                .padding(6)
            }
            .frame(maxHeight: 280)
            .fixedSize(horizontal: false, vertical: true)
            Divider()
            Button {
                router.open(.page(.skills), compact: sizeClass == .compact)
            } label: {
                Label("Manage Skills", systemImage: "gearshape").font(.caption).frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.borderless)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
        .glassEffect(.regular, in: .rect(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Skills")
        .accessibilityIdentifier("skill.menu")
    }

    private func heading(_ text: String) -> some View {
        Text(text).font(.caption2.weight(.semibold)).textCase(.uppercase).foregroundStyle(.secondary)
            .padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 2)
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 10).padding(.vertical, 8)
    }

    private func row<Content: View>(index: Int, item: SkillMenuModel.Item, @ViewBuilder content: () -> Content) -> some View {
        Button {
            Task { if let name = await menu.pick(item, client: client) { onPick(name) } }
        } label: {
            HStack(spacing: 10) { content() }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(index == menu.active ? AnyShapeStyle(.quaternary) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 12, style: .continuous))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .onHover { if $0 { menu.active = index } }
    }
}

/// Messages waiting for the chat: collapsed to a count and the next one, open to edit, reorder, delete, or steer
/// them in now. After you stop the chat they're held until you send one.
struct QueuePanel: View {
    let feed: ChatFeed
    @State private var open = false

    var body: some View {
        let queue = feed.transcript.queue
        let held = feed.transcript.queueHeld
        if let next = queue.first {
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    withAnimation(.snappy) { open.toggle() }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: held ? "pause.circle.fill" : "hourglass")
                            .foregroundStyle(held ? .orange : .secondary)
                        Text("\(queue.count) queued").font(.footnote.weight(.semibold))
                        Text(held ? "Held since you stopped: send one, or a new message, to continue" : open ? "Sent in this order as the chat finishes" : next.text)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.up").font(.caption.weight(.bold)).foregroundStyle(.secondary).rotationEffect(.degrees(open ? 0 : 180))
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(queue.count) queued\(held ? ", held" : "")")
                .accessibilityIdentifier("queue.toggle")
                if open {
                    Divider()
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(Array(queue.enumerated()), id: \.element.id) { index, item in
                                if index > 0 { Divider().padding(.leading, 14) }
                                QueueItemRow(feed: feed, item: item, index: index, count: queue.count, running: feed.transcript.running)
                            }
                        }
                    }
                    .frame(maxHeight: 300)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
            .glassEffect(.regular, in: .rect(cornerRadius: 22, style: .continuous))
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("queue.panel")
        }
    }
}

private struct QueueItemRow: View {
    let feed: ChatFeed
    let item: QueuedMessage
    let index: Int
    let count: Int
    let running: Bool
    @State private var editing = false
    @State private var draft = ""
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if editing {
                TextField("Message", text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($focused)
                    .padding(10)
                    .background(Color(.systemBackground).opacity(0.6), in: .rect(cornerRadius: 12, style: .continuous))
                    .onKeyPress(.return, phases: .down) { press in
                        if press.modifiers.contains(.shift) { return .ignored }
                        save()
                        return .handled
                    }
                    .onKeyPress(.escape) { editing = false; return .handled }
                    .accessibilityIdentifier("queue.editor")
                HStack {
                    Spacer()
                    Button("Cancel") { editing = false }.buttonStyle(.glass)
                    Button("Save", action: save)
                        .buttonStyle(.glassProminent)
                        .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("queue.save")
                }
                .controlSize(.small)
            } else {
                HStack(alignment: .top, spacing: 10) {
                    Text("\(index + 1)")
                        .font(.caption2.weight(.semibold).monospacedDigit())
                        .frame(width: 20, height: 20)
                        .background(.quaternary, in: .circle)
                    VStack(alignment: .leading, spacing: 2) {
                        if !item.text.isEmpty { Text(item.text).font(.subheadline).lineLimit(3) }
                        if !item.attachments.isEmpty {
                            Text("Attached: \(attachmentSummary(item.attachments.map(\.name)))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                HStack(spacing: 2) {
                    icon("arrow.up", "Move up", id: "queue.up.\(index)") { try await feed.moveQueued(item.id, to: index - 1) }.disabled(index == 0)
                    icon("arrow.down", "Move down", id: "queue.down.\(index)") { try await feed.moveQueued(item.id, to: index + 1) }.disabled(index == count - 1)
                    Button { draft = item.text; editing = true; focused = true } label: { Image(systemName: "pencil").frame(width: 30, height: 28) }
                        .accessibilityLabel("Edit")
                        .accessibilityIdentifier("queue.edit.\(index)")
                    icon("trash", "Delete", id: "queue.delete.\(index)", role: .destructive) { try await feed.removeQueued(item.id) }
                    Spacer()
                    Button {
                        act { try await feed.steerQueued(item.id) }
                    } label: {
                        Label(running ? "Steer" : "Send Now", systemImage: "bolt.fill").font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.glass)
                    .tint(.orange)
                    .controlSize(.small)
                    .accessibilityHint(running ? "Sends it into the current run after its current step" : "Sends it now")
                    .accessibilityIdentifier("queue.steer.\(index)")
                }
                .buttonStyle(.borderless)
                .padding(.leading, 26)
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red).padding(.leading, 26) }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("queue.item.\(index)")
    }

    private func icon(_ symbol: String, _ label: String, id: String, role: ButtonRole? = nil, _ work: @escaping () async throws -> Void) -> some View {
        Button(role: role) { act(work) } label: { Image(systemName: symbol).frame(width: 30, height: 28) }
            .accessibilityLabel(label)
            .accessibilityIdentifier(id)
    }

    /// Each action may find the message already sent (the run ended meanwhile): say so instead of failing quietly.
    private func act(_ work: @escaping () async throws -> Void) {
        error = nil
        Task { do { try await work() } catch { self.error = error.localizedDescription } }
    }

    private func save() {
        let text = draft
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        focused = false
        act {
            try await feed.editQueued(item.id, text: text)
            editing = false
        }
    }
}
