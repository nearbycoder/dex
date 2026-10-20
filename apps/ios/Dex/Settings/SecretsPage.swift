import DexCore
import SwiftUI

/// API keys and tokens every chat's VM gets as environment variables: add, replace, change a note, delete.
struct SecretsPage: View {
    @Environment(DexClient.self) private var client
    @State private var editing: SecretEditor.Target?
    @State private var deleting: SavedSecret?
    @State private var savedMessage: String?

    var body: some View {
        if let state = client.state {
            List {
                Section {
                    Label {
                        Text("Every chat's VM gets these as environment variables (e.g. `$MY_API_KEY`), so you enter them once. Values are stored encrypted, never shown again, hidden from chats, and masked in VM output.")
                    } icon: {
                        Image(systemName: "lock.shield").foregroundStyle(.tint)
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
                if let savedMessage {
                    Section { InlineMessage(tone: .ok, text: savedMessage) }
                }
                Section {
                    if state.secrets.isEmpty {
                        ContentUnavailableView {
                            Label("No Secrets", systemImage: "key")
                        } description: {
                            Text("Add an API key a CLI or service on your VMs needs.")
                        } actions: {
                            Button("Add Secret") { editing = .new }.buttonStyle(.glassProminent)
                        }
                    }
                    ForEach(state.secrets) { secret in
                        Button {
                            editing = .existing(secret)
                        } label: {
                            SecretRow(secret: secret)
                        }
                        .buttonStyle(.plain)
                        .swipeActions {
                            Button("Delete", systemImage: "trash") { deleting = secret }.tint(.red)
                            Button("Edit", systemImage: "pencil") { editing = .existing(secret) }
                        }
                        .contextMenu {
                            Button("Replace Value or Note", systemImage: "pencil") { editing = .existing(secret) }
                            Button("Copy Name", systemImage: "doc.on.doc") { UIPasteboard.general.string = "$\(secret.name)" }
                            Button("Delete", systemImage: "trash", role: .destructive) { deleting = secret }
                        }
                        .accessibilityIdentifier("secret.\(secret.name)")
                    }
                } header: {
                    if !state.secrets.isEmpty { Text("Saved · \(state.secrets.count)") }
                }
            }
            .navigationTitle("Secrets")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Add Secret", systemImage: "plus") { editing = .new }
                        .keyboardShortcut("n", modifiers: [.command, .shift])
                        .accessibilityIdentifier("secrets.add")
                }
            }
            .sheet(item: $editing) { target in
                SecretEditor(target: target) { name in
                    if case .new = target { savedMessage = "Saved \(name). VMs get it from their next command." }
                }
            }
            .confirmationDialog("Delete \(deleting?.name ?? "")?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { secret in
                Button("Delete", role: .destructive) {
                    client.perform { try await client.run("removeSecret", .string(secret.name)) }
                }
                .accessibilityIdentifier("secrets.confirmDelete")
            } message: { _ in
                Text("VMs stop getting it from their next command.")
            }
        } else {
            FormSkeleton(sections: 1, rows: 3).navigationTitle("Secrets")
        }
    }
}

private struct SecretRow: View {
    let secret: SavedSecret

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "key.fill")
                .foregroundStyle(.secondary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(secret.name).font(.body.monospaced()).lineLimit(1)
                Text(secret.note.isEmpty ? "Updated \(Format.ago(secret.updatedAt))" : "\(secret.note) · updated \(Format.ago(secret.updatedAt))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .contentShape(.rect)
    }
}

/// Adds a secret, or changes one: a new value (leave it empty to keep the saved one) and its note.
struct SecretEditor: View {
    enum Target: Identifiable, Hashable {
        case new
        case existing(SavedSecret)
        var id: String { if case .existing(let secret) = self { secret.name } else { "+new" } }
    }

    @Environment(DexClient.self) private var client
    @Environment(\.dismiss) private var dismiss
    let target: Target
    let onSaved: (String) -> Void
    @State private var name = ""
    @State private var value = ""
    @State private var note = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?

    enum Field { case name, value, note }

    private var existing: SavedSecret? { if case .existing(let secret) = target { secret } else { nil } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let existing {
                        LabeledContent("Name") { Text(existing.name).font(.body.monospaced()) }
                    } else {
                        TextField("Name", text: $name, prompt: Text("MY_API_KEY"))
                            .onChange(of: name) { _, typed in
                                let clean = SecretName.sanitize(typed)
                                if clean != typed { name = clean }
                            }
                            .font(.body.monospaced())
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .focused($focus, equals: .name)
                            .submitLabel(.next)
                            .onSubmit { focus = .value }
                            .accessibilityIdentifier("secret.name")
                    }
                } footer: {
                    if existing == nil {
                        if !name.isEmpty, let problem = SecretName.problem(name) {
                            Text(problem).foregroundStyle(.red)
                        } else {
                            Text("Capital letters, digits, and underscores: the environment variable it becomes on VMs.")
                        }
                    }
                }
                Section {
                    SecureField(existing == nil ? "Value" : "New value", text: $value)
                        .textContentType(.password)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .focused($focus, equals: .value)
                        .submitLabel(.next)
                        .onSubmit { focus = .note }
                        .accessibilityIdentifier("secret.value")
                } footer: {
                    Text(existing == nil ? "One line. It's never shown again." : "Leave it empty to keep the saved value.")
                }
                Section {
                    TextField("What it's for (optional)", text: $note, axis: .vertical)
                        .focused($focus, equals: .note)
                        .accessibilityIdentifier("secret.note")
                } header: {
                    Text("Note")
                }
                if let error {
                    Section { InlineMessage(tone: .error, text: error) }
                }
            }
            .navigationTitle(existing == nil ? "New Secret" : "Edit Secret")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if busy { ProgressView() } else { Text("Save") }
                    }
                    .disabled(!canSave || busy)
                    .accessibilityIdentifier("secret.save")
                }
            }
            .onAppear {
                if let existing { name = existing.name; note = existing.note; focus = .value } else { focus = .name }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(!value.isEmpty)
    }

    private var canSave: Bool {
        if let existing { return !value.isEmpty || note != existing.note }
        return SecretName.isValid(name) && !value.isEmpty
    }

    private func save() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            let saved: String = try await client.call("saveSecret", .string(name), value.isEmpty ? .null : .string(value), .string(note))
            onSaved(saved)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
