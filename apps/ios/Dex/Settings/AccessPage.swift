import DexCore
import SwiftUI

/// Chats and external agents managing Dex: actions waiting for your confirmation, MCP tokens, and what ran.
struct AccessPage: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @State private var creating = false
    @State private var revoking: AccessToken?
    @State private var answering: String?

    var body: some View {
        if let state = client.state, let server = client.server {
            let endpoint = McpSetup.endpoint(server: server)
            let pending = state.access.pending.filter { $0.isWaiting() }
            Form {
                Section {
                    Text("Chats and external agents can manage Dex: start and message chats, create agents and projects, run VMs, and more. Deleting anything, changing settings, editing existing agents or projects, and adding MCP servers need your confirmation, or a Full token over MCP.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if !pending.isEmpty {
                    Section {
                        ForEach(pending) { action in
                            PendingRow(action: action, title: state.session(action.sessionId)?.title, answering: answering) { approve in
                                Task { await answer(action, approve: approve) }
                            }
                        }
                    } header: {
                        Label("Waiting for You", systemImage: "exclamationmark.shield.fill").foregroundStyle(.orange)
                    } footer: {
                        Text("Chats asked to do these. Nothing happens until you confirm.")
                    }
                }

                Section {
                    CopyRow(label: "Endpoint (Streamable HTTP)", value: endpoint)
                        .accessibilityIdentifier("access.endpoint")
                    Button {
                        creating = true
                    } label: {
                        Label("New Token", systemImage: "plus.circle.fill")
                    }
                    .accessibilityIdentifier("access.newToken")
                } header: {
                    Text("MCP")
                } footer: {
                    Text("Connect Claude Code, Claude Desktop, Cursor, or any MCP client. Each token has its own access level and expiry, and can be revoked any time.")
                }

                if !state.access.tokens.isEmpty {
                    Section("Tokens") {
                        ForEach(state.access.tokens) { token in
                            TokenRow(token: token)
                                .swipeActions {
                                    Button("Revoke", systemImage: "trash") { revoking = token }.tint(.red)
                                }
                                .contextMenu {
                                    Button("Revoke", systemImage: "trash", role: .destructive) { revoking = token }
                                }
                        }
                    }
                }

                Section {
                    NavigationLink {
                        ActivityLog()
                    } label: {
                        LabeledContent("Activity", value: "\(state.access.audit.count)")
                    }
                    .accessibilityIdentifier("access.activity")
                    ForEach(state.access.audit.prefix(3)) { entry in
                        AuditRow(entry: entry)
                    }
                } footer: {
                    Text("Every app operation run by a chat, an external agent, or a button in a chat's UI, newest first.")
                }
            }
            .navigationTitle("Access & API")
            .sheet(isPresented: $creating) {
                NewTokenSheet(endpoint: endpoint)
            }
            .confirmationDialog("Revoke “\(revoking?.label ?? "")”?", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }), titleVisibility: .visible, presenting: revoking) { token in
                Button("Revoke", role: .destructive) {
                    client.perform { try await client.run("revokeAccessToken", .string(token.id)) }
                }
                .accessibilityIdentifier("access.confirmRevoke")
            } message: { _ in
                Text("Agents using it lose access immediately.")
            }
            .sensoryFeedback(.success, trigger: state.access.pending.filter { $0.status == "approved" }.count)
        } else {
            FormSkeleton().navigationTitle("Access & API")
        }
    }

    private func answer(_ action: PendingAction, approve: Bool) async {
        answering = action.id
        defer { answering = nil }
        do { try await client.run("resolvePendingAction", .string(action.id), .bool(approve), timeout: 120) } catch { client.notice = error.localizedDescription }
    }
}

private struct PendingRow: View {
    @Environment(Router.self) private var router
    let action: PendingAction
    let title: String?
    let answering: String?
    let answer: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(action.summary).font(.body.weight(.medium))
            Button {
                router.openChat(action.sessionId)
            } label: {
                Text("from \(title ?? "a chat") · \(Format.ago(action.createdAt))").font(.caption)
            }
            .buttonStyle(.borderless)
            .foregroundStyle(.secondary)
            HStack {
                Button {
                    answer(true)
                } label: {
                    HStack(spacing: 6) {
                        if answering == action.id { ProgressView().controlSize(.small) } else { Image(systemName: "checkmark") }
                        Text("Confirm")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .tint(.orange)
                .accessibilityIdentifier("pending.confirm.\(action.id)")
                Button {
                    answer(false)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "xmark")
                        Text("Decline")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
                .accessibilityIdentifier("pending.decline.\(action.id)")
            }
            .disabled(answering != nil)
        }
        .padding(.vertical, 4)
        // The separator spans the row (a label in the buttons would otherwise set where it starts).
        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
    }
}

private struct TokenRow: View {
    let token: AccessToken

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "powerplug.fill").foregroundStyle(.secondary).frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(token.label).lineLimit(1)
                HStack(spacing: 0) {
                    Text("\(token.scopeLabel) · \(token.lastUsedAt.map { "used \(Format.ago($0))" } ?? "never used") · ")
                    if token.isExpired() {
                        Text("expired").foregroundStyle(.orange)
                    } else if let expires = token.expiresAt {
                        Text("expires \(Format.date(expires))")
                    } else {
                        Text("no expiry")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("token.\(token.label)")
    }
}

struct AuditRow: View {
    let entry: AuditEntry

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .foregroundStyle(color)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.summary).foregroundStyle(entry.ok ? .primary : .secondary)
                Text("\(prefix)\(entry.actorLabel) · \(Format.ago(entry.at))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(entry.operation).font(.caption2.monospaced()).foregroundStyle(.tertiary)
                if !entry.ok, let error = entry.error {
                    Label(error, systemImage: "xmark.octagon.fill").font(.caption).foregroundStyle(.red)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var prefix: String {
        switch entry.actor {
        case "user": "You confirmed, for "
        case "ui": "From a button in "
        default: ""
        }
    }

    private var symbol: String {
        switch entry.actor {
        case "mcp": "powerplug.fill"
        case "user": "checkmark.circle.fill"
        case "ui": "cursorarrow.click"
        default: "sparkles"
        }
    }

    private var color: Color {
        switch entry.actor {
        case "mcp": .blue
        case "user": .orange
        case "ui": .purple
        default: .green
        }
    }
}

/// The whole audit log, searchable and filtered by who ran it.
private struct ActivityLog: View {
    @Environment(DexClient.self) private var client
    @State private var actor = "all"
    @State private var failedOnly = false
    @State private var search = ""

    private static let actors: [(id: String, label: String)] = [("all", "All"), ("chat", "Chats"), ("mcp", "MCP"), ("ui", "Chat UIs"), ("user", "You")]

    var body: some View {
        let entries = (client.state?.access.audit ?? []).filter { entry in
            (actor == "all" || entry.actor == actor) && (!failedOnly || !entry.ok)
                && (search.isEmpty || entry.summary.localizedCaseInsensitiveContains(search) || entry.operation.localizedCaseInsensitiveContains(search)
                    || entry.actorLabel.localizedCaseInsensitiveContains(search))
        }
        List {
            Section {
                Picker("Who", selection: $actor) {
                    ForEach(Self.actors, id: \.id) { Text($0.label).tag($0.id) }
                }
                .accessibilityIdentifier("activity.actor")
                Toggle("Failed only", isOn: $failedOnly)
            }
            Section {
                if entries.isEmpty {
                    Text("Nothing yet.").foregroundStyle(.secondary)
                }
                ForEach(entries) { AuditRow(entry: $0) }
            }
        }
        .searchable(text: $search, prompt: "Search activity")
        .navigationTitle("Activity")
    }
}

/// Name, access level, and lifetime of a new MCP token; once it's created, its secret (shown this once).
private struct NewTokenSheet: View {
    @Environment(DexClient.self) private var client
    @Environment(\.dismiss) private var dismiss
    let endpoint: String
    @State private var created: CreatedAccessToken?
    @State private var label = ""
    @State private var scope = "write"
    @State private var days: Int? = 90
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        if let created {
            CreatedTokenView(created: created, endpoint: endpoint)
        } else {
            form
        }
    }

    private var form: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name, e.g. Claude Code on my laptop", text: $label)
                        .onChange(of: label) { _, value in if value.count > 60 { label = String(value.prefix(60)) } }
                        .accessibilityIdentifier("token.label")
                } header: {
                    Text("Name")
                }
                Section {
                    Picker("Access", selection: $scope) {
                        ForEach(AccessRisks.all, id: \.id) { Text($0.label).tag($0.id) }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("token.scope")
                } header: {
                    Text("Access")
                } footer: {
                    Text(AccessRisks.all.first { $0.id == scope }?.description ?? "")
                }
                Section {
                    Picker("Expires", selection: $days) {
                        ForEach(AccessExpiry.all, id: \.label) { Text($0.label).tag($0.days) }
                    }
                    .accessibilityIdentifier("token.expiry")
                }
                if let error {
                    Section { InlineMessage(tone: .error, text: error) }
                }
            }
            .navigationTitle("New Token")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await create() }
                    } label: {
                        if busy { ProgressView() } else { Text("Create") }
                    }
                    .disabled(label.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                    .accessibilityIdentifier("token.create")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func create() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            let created: CreatedAccessToken = try await client.call("createAccessToken", .string(label.trimmingCharacters(in: .whitespaces)), .string(scope), days.map { .number(Double($0)) } ?? .null)
            withAnimation { self.created = created }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// The new token's secret, shown this once, with ready-made setup for Claude Code and other clients.
private struct CreatedTokenView: View {
    @Environment(\.dismiss) private var dismiss
    let created: CreatedAccessToken
    let endpoint: String

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("Copy this token now. It won't be shown again.", systemImage: "key.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("token.warning")
                    CopyRow(label: "\(created.token.label) · \(created.token.scopeLabel)", value: created.secret, secret: true, lines: 3)
                        .accessibilityIdentifier("token.secret")
                    ShareLink(item: created.secret, subject: Text("Dex MCP token")) {
                        Label("Share Token", systemImage: "square.and.arrow.up")
                    }
                }
                Section {
                    CopyRow(label: "Claude Code", value: McpSetup.claudeCommand(endpoint: endpoint, token: created.secret), secret: true, lines: 4)
                } footer: {
                    Text("Run this in a terminal to add Dex to Claude Code.")
                }
                Section("Other clients (JSON config)") {
                    CopyRow(label: "mcp.json", value: McpSetup.jsonConfig(endpoint: endpoint, token: created.secret), secret: true, lines: 20)
                }
            }
            .navigationTitle("Token Created")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("token.done")
                }
            }
        }
        .interactiveDismissDisabled()
    }
}
