import DexCore
import SwiftUI

/// Skills: instructions for particular tasks. Start a message with /name to use one, or let chats pick them up on
/// their own (Auto). Install them from skills.sh or write your own.
struct SkillsList: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    var selection: Binding<LibraryRoute?>?
    @State private var filter = ""
    @State private var removing: SkillInfo?

    var body: some View {
        let skills = (client.state?.skills ?? []).filter { filter.isEmpty || $0.id.localizedCaseInsensitiveContains(filter) || $0.description.localizedCaseInsensitiveContains(filter) }
        List(selection: selection) {
            Section {
                NavigationLink(value: LibraryRoute.skillSearch) {
                    Label("Search skills.sh", systemImage: "magnifyingglass")
                }
                .accessibilityIdentifier("skills.search")
            }
            Section("Installed") {
                if client.state == nil {
                    ForEach(0..<3, id: \.self) { _ in LibraryRowSkeleton(avatar: false) }
                } else if client.state?.skills.isEmpty == true {
                    EmptyStateView(title: "No Skills Yet", symbol: AppTab.skills.symbol, message: "Search skills.sh, or write your own.", actionTitle: "New Skill") { open(.newSkill) }
                        .libraryEmptyRow()
                } else if skills.isEmpty {
                    ContentUnavailableView.search(text: filter).libraryEmptyRow()
                }
                ForEach(skills) { skill in
                    NavigationLink(value: LibraryRoute.skill(skill.id)) { SkillRow(skill: skill) }
                        .accessibilityIdentifier("skill.row.\(skill.id)")
                        .swipeActions(edge: .leading, allowsFullSwipe: true) {
                            Button { setAuto(skill, !skill.auto) } label: {
                                skill.auto ? Label("Auto Off", systemImage: "bolt.slash") : Label("Auto On", systemImage: "bolt")
                            }
                            .tint(skill.auto ? .gray : .orange)
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { removing = skill } label: { Label("Remove", systemImage: "trash") }
                        }
                        .contextMenu {
                            Toggle(isOn: Binding(get: { skill.auto }, set: { setAuto(skill, $0) })) { Label("Auto", systemImage: "bolt") }
                            if skill.source != nil {
                                Button { client.perform { _ = try await client.updateSkill(skill.id) } } label: { Label("Update from GitHub", systemImage: "arrow.clockwise") }
                            }
                            Divider()
                            Button(role: .destructive) { removing = skill } label: { Label("Remove", systemImage: "trash") }
                        }
                }
            }
        }
        .searchable(text: $filter, prompt: "Filter installed skills")
        .navigationTitle("Skills")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { open(.newSkill) } label: { Label("New Skill", systemImage: "plus") }
                    .keyboardShortcut("n", modifiers: .command)
                    .accessibilityIdentifier("skills.new")
            }
        }
        .confirmationDialog("Remove /\(removing?.id ?? "")?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { skill in
            Button("Remove Skill", role: .destructive) {
                router.closeLibrary(.skill(skill.id))
                client.perform { try await client.removeSkill(skill.id) }
            }
        } message: { _ in
            Text("Chats stop using it.")
        }
        .accessibilityIdentifier("skills.list")
    }

    private func open(_ route: LibraryRoute) {
        if let selection { selection.wrappedValue = route } else { router.open(route, compact: true) }
    }

    private func setAuto(_ skill: SkillInfo, _ on: Bool) {
        client.perform { try await client.setSkillAuto(skill.id, on) }
    }
}

struct SkillRow: View {
    let skill: SkillInfo

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text("/\(skill.id)").font(.body.monospaced().weight(.medium)).lineLimit(1)
                if skill.auto { Tag(text: "Auto", symbol: "bolt.fill", color: .orange) }
            }
            Text(skill.description).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            HStack(spacing: 6) {
                Label(skill.source ?? "Yours", systemImage: skill.source == nil ? "person" : "shippingbox").labelStyle(.compact)
                Text("·")
                Text(skill.files > 0 ? "\(skill.files + 1) files" : "1 file")
                Text("·")
                Text(Format.bytes(max(skill.size, 1)))
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }
}

/// An installed skill: its instructions rendered, its files, Auto, and updating, editing, or removing it.
struct SkillDetailView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.openURL) private var openURL
    let skillId: String
    @State private var detail: SkillDetail?
    @State private var missing = false
    @State private var error: String?
    @State private var editing = false
    @State private var updating = false
    @State private var confirmRemove = false

    private var listed: SkillInfo? { client.state?.skills.first { $0.id == skillId } }

    var body: some View {
        Group {
            if missing {
                ContentUnavailableView("Skill Not Found", systemImage: AppTab.skills.symbol, description: Text("This skill no longer exists."))
            } else if let detail {
                content(detail)
            } else if let error {
                ContentUnavailableView("Couldn't Load It", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                skeleton
            }
        }
        .navigationTitle("/\(skillId)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if detail != nil {
                ToolbarItem(placement: .primaryAction) {
                    Button("Edit") { editing = true }
                        .keyboardShortcut("e", modifiers: .command)
                        .accessibilityIdentifier("skill.edit")
                }
            }
        }
        // Refetched when it changes anywhere (updated from GitHub, edited by a chat).
        .task(id: "\(client.isConnected)|\(listed?.updatedAt ?? 0)") { await load() }
        .sheet(isPresented: $editing) {
            if let detail {
                NavigationStack {
                    SkillEditor(existing: detail) { saved in
                        self.detail = saved
                        editing = false
                        if saved.id != skillId { router.replaceLibrary(.skill(skillId), with: .skill(saved.id)) }
                    } onCancel: { editing = false }
                }
            }
        }
        .confirmationDialog("Remove /\(skillId)?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove Skill", role: .destructive) {
                router.closeLibrary(.skill(skillId))
                client.perform { try await client.removeSkill(skillId) }
            }
        } message: {
            Text("Chats stop using it.")
        }
    }

    private func load() async {
        guard client.isConnected else { return }
        do {
            let found = try await client.getSkill(skillId)
            detail = found
            missing = found == nil
            error = nil
        } catch {
            if detail == nil { self.error = error.localizedDescription }
        }
    }

    private var skeleton: some View {
        List {
            Section {
                LineBone(width: 260, font: .subheadline)
                LineBone(width: 180, font: .subheadline)
            }
            Section {
                ForEach(0..<6, id: \.self) { index in LineBone(width: [280, 220, 300, 160, 240, 200][index]) }
            }
        }
        .accessibilityIdentifier("library.loading")
    }

    private func content(_ detail: SkillDetail) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("/\(detail.id)").font(.title2.monospaced().bold())
                    Text(detail.description).foregroundStyle(.secondary)
                    if let url = detail.sourceURL, let source = detail.source {
                        Button { openURL(url) } label: { Label(source, systemImage: "arrow.up.forward.square").labelStyle(.compact).font(.subheadline) }
                            .buttonStyle(.borderless)
                    } else {
                        Text("Written by you. Start a message with /\(detail.id) to use it.").font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
                .accessibilityIdentifier("skill.header")
            }

            Section {
                Toggle(isOn: Binding(get: { listed?.auto ?? detail.auto }, set: { on in
                    self.detail?.auto = on
                    client.perform { try await client.setSkillAuto(detail.id, on) }
                })) {
                    Label("Auto", systemImage: "bolt")
                }
                .accessibilityIdentifier("skill.auto")
            } footer: {
                Text("On: chats load it by themselves when a request matches. Off: only when you start a message with /\(detail.id).")
            }

            Section("Instructions") {
                MarkdownView(text: detail.instructions)
                    .padding(.vertical, 6)
                    .accessibilityIdentifier("skill.instructions")
            }

            if !detail.fileList.isEmpty {
                Section {
                    ForEach(detail.fileList, id: \.path) { file in
                        HStack {
                            Label(file.path, systemImage: "doc.text").font(.callout.monospaced()).lineLimit(1)
                            Spacer()
                            Text(Format.bytes(file.size)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    Text("Files")
                } footer: {
                    Text("They come with the skill; chats read them when its instructions say to. Updating from GitHub refreshes them.")
                }
            }

            Section {
                if detail.source != nil {
                    Button {
                        Task { await update() }
                    } label: {
                        HStack {
                            Label("Update from GitHub", systemImage: "arrow.clockwise")
                            if updating { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(updating)
                    .accessibilityIdentifier("skill.update")
                }
                Button(role: .destructive) { confirmRemove = true } label: { Label("Remove Skill", systemImage: "trash") }
                    .accessibilityIdentifier("skill.remove")
            } footer: {
                if detail.source != nil { Text("Updating replaces it with the latest from GitHub, edits included.") }
            }
        }
    }

    private func update() async {
        updating = true
        defer { updating = false }
        do { detail = try await client.updateSkill(skillId) } catch { client.notice = error.localizedDescription }
    }
}

/// Writing a skill: its name (what you type after /), when to use it, and its instructions.
struct SkillEditor: View {
    @Environment(DexClient.self) private var client
    /// The skill being edited, or nil for a new one.
    let existing: SkillDetail?
    let onSave: (SkillDetail) -> Void
    let onCancel: () -> Void
    @State private var name = ""
    @State private var description = ""
    @State private var instructions = ""
    @State private var auto = true
    @State private var loaded = false
    @State private var saving = false
    @State private var tried = false
    @State private var error: String?

    private var slug: String { Skills.slug(name) }
    private var valid: Bool { !slug.isEmpty && !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var dirty: Bool {
        guard let existing else { return !(name.isEmpty && description.isEmpty && instructions.isEmpty) }
        return slug != existing.id || description != existing.description || instructions != existing.instructions || auto != existing.auto
    }

    var body: some View {
        Form {
            Section {
                TextField("Name", text: $name, prompt: Text("release-notes"))
                    .font(.body.monospaced())
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("skill.name")
            } header: {
                Text("Name")
            } footer: {
                if tried && slug.isEmpty {
                    FieldProblem(text: "Give it a name: lowercase letters, digits, and dashes.")
                } else {
                    Text(slug.isEmpty ? "What you type after / to use it." : "Use it with /\(slug).")
                }
            }

            Section {
                LongTextField(title: "When to use it", text: $description, prompt: "Writes release notes from merged pull requests. Use when asked for a changelog or release notes.", lines: 2...6)
                    .accessibilityIdentifier("skill.description")
            } header: {
                Text("When to Use It")
            } footer: {
                if tried && description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    FieldProblem(text: "Say what it's for and when it applies.")
                } else {
                    Text("Chats decide whether a request needs this skill from this, so say what it's for and when it applies.")
                }
            }

            Section {
                LongTextField(title: "Instructions", text: $instructions, prompt: "# Release notes\n\n1. List the PRs merged since the last tag…", monospaced: true, lines: 8...24)
                    .accessibilityIdentifier("skill.body")
            } header: {
                Text("Instructions")
            } footer: {
                if tried && instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    FieldProblem(text: "Write its instructions.")
                } else {
                    Text("Markdown, given to the chat when the skill is used.")
                }
            }

            Section {
                Toggle("Auto", isOn: $auto).accessibilityIdentifier("skill.editor.auto")
            } footer: {
                Text("Chats load it on their own when a request matches.")
            }

            if let error {
                Section { FieldProblem(text: error) }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(existing == nil ? "New Skill" : "Edit Skill")
        .navigationBarTitleDisplayMode(.inline)
        .interactiveDismissDisabled(dirty)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", action: onCancel).accessibilityIdentifier("skill.cancel")
            }
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { await save() }
                } label: {
                    if saving { ProgressView() } else { Text(existing == nil ? "Create" : "Save") }
                }
                .disabled(saving || (existing != nil && !dirty))
                .keyboardShortcut("s", modifiers: .command)
                .accessibilityIdentifier("skill.save")
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            if let existing {
                name = existing.id
                description = existing.description
                instructions = existing.instructions
                auto = existing.auto
            }
        }
    }

    private func save() async {
        tried = true
        guard valid else { return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            onSave(try await client.saveSkill(SkillInput(id: existing?.id, name: slug, description: description, instructions: instructions, auto: auto)))
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// The `.newSkill` route: the editor, which becomes the new skill's page once created.
struct NewSkillPage: View {
    @Environment(Router.self) private var router

    var body: some View {
        SkillEditor(existing: nil) { skill in
            router.replaceLibrary(.newSkill, with: .skill(skill.id))
        } onCancel: {
            router.closeLibrary(.newSkill)
        }
        .navigationBarBackButtonHidden()
    }
}

/// Search skills.sh: open a result to read what it would add, then install it (Auto on or off).
struct SkillSearchView: View {
    @Environment(DexClient.self) private var client
    @State private var query = ""
    @State private var results: [DirectorySkill] = []
    @State private var searched = ""
    @State private var loading = false
    @State private var error: String?

    static let suggestions = ["pdf", "frontend design", "code review", "testing", "docs", "seo"]

    var body: some View {
        let installed = Skills.installedKeys(client.state?.skills ?? [])
        let q = query.trimmingCharacters(in: .whitespaces)
        List {
            if q.count < 2 {
                Section {
                    ForEach(Self.suggestions, id: \.self) { suggestion in
                        Button { query = suggestion } label: { Label(suggestion, systemImage: "magnifyingglass").foregroundStyle(.primary) }
                            .accessibilityIdentifier("skills.suggestion.\(suggestion)")
                    }
                } header: {
                    Text("Try")
                } footer: {
                    Text("Skills come from other people's repos: read one before installing it.")
                }
            } else if let error {
                ContentUnavailableView("Search Failed", systemImage: "exclamationmark.triangle", description: Text(error)).libraryEmptyRow()
            } else if results.isEmpty && !loading && searched == q {
                ContentUnavailableView.search(text: q).libraryEmptyRow()
            } else if results.isEmpty && loading {
                ForEach(0..<4, id: \.self) { _ in LibraryRowSkeleton(avatar: false) }
            } else {
                Section {
                    ForEach(results) { skill in
                        SkillResultRow(skill: skill, installed: installed.contains(skill.id))
                    }
                } footer: {
                    Text("Sorted by installs on skills.sh.")
                }
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search skills.sh")
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .navigationTitle("skills.sh")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if loading { ToolbarItem(placement: .primaryAction) { ProgressView() } }
        }
        .task(id: q) { await search(q) }
        .accessibilityIdentifier("skills.searchPage")
    }

    private func search(_ q: String) async {
        guard q.count >= 2 else { results = []; error = nil; return }
        loading = true
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        defer { loading = false }
        do {
            let found = try await client.searchSkills(q)
            guard !Task.isCancelled else { return }
            results = found
            error = nil
        } catch {
            guard !Task.isCancelled else { return }
            results = []
            self.error = error.localizedDescription
        }
        searched = q
    }
}

/// One skills.sh result: install it straight away, or open it to read what it would add first.
private struct SkillResultRow: View {
    @Environment(DexClient.self) private var client
    @Environment(\.openURL) private var openURL
    let skill: DirectorySkill
    let installed: Bool
    @State private var open = false
    @State private var preview: SkillPreview?
    @State private var auto = true
    @State private var installing = false
    @State private var error: String?
    @State private var done = 0

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 10) {
                if let error {
                    FieldProblem(text: error)
                } else if let preview {
                    Text(preview.description.isEmpty ? "No description." : preview.description).font(.subheadline)
                    HStack(spacing: 10) {
                        Text("\(preview.files.isEmpty ? "SKILL.md" : "SKILL.md + \(preview.files.count) \(preview.files.count == 1 ? "file" : "files")") · \(Format.bytes(preview.size))")
                        if let url = URL(string: preview.url) {
                            Button { openURL(url) } label: { Label("GitHub", systemImage: "arrow.up.forward.square").labelStyle(.compact) }.buttonStyle(.borderless)
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    DisclosureGroup("Instructions") {
                        MarkdownView(text: preview.instructions, font: .callout)
                            .padding(10)
                            .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 12, style: .continuous))
                    }
                    .font(.subheadline)
                    .accessibilityIdentifier("skill.preview.instructions")
                    if !installed {
                        Toggle("Let chats use it on their own (Auto)", isOn: $auto)
                            .font(.subheadline)
                            .accessibilityIdentifier("skill.install.auto")
                        Button { Task { await install() } } label: {
                            Label(installing ? "Installing…" : "Install /\(skill.skillId)", systemImage: "arrow.down.circle").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glassProminent)
                        .disabled(installing)
                        .accessibilityIdentifier("skill.install.confirm")
                    }
                } else {
                    HStack(spacing: 8) { ProgressView(); Text("Reading it from GitHub…").font(.caption).foregroundStyle(.secondary) }
                }
            }
            .padding(.vertical, 4)
        } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(skill.name).font(.body.weight(.medium)).lineLimit(1)
                    Text(skill.source).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
                }
                .accessibilityIdentifier("skill.result.\(skill.skillId)")
                Spacer(minLength: 4)
                Label(Skills.formatInstalls(skill.installs), systemImage: "arrow.down.circle")
                    .labelStyle(.compact)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("\(skill.installs) installs")
                if installed {
                    Label("Installed", systemImage: "checkmark").labelStyle(.iconOnly).foregroundStyle(.green).accessibilityIdentifier("skill.installed.\(skill.skillId)")
                } else {
                    Button { Task { await install() } } label: {
                        if installing { ProgressView().controlSize(.small) } else { Text("Install") }
                    }
                    .buttonStyle(.glass)
                    .controlSize(.small)
                    .disabled(installing)
                    .accessibilityIdentifier("skill.install.\(skill.skillId)")
                }
            }
        }
        .onChange(of: open) { _, open in
            if open, preview == nil { Task { await loadPreview() } }
        }
        .sensoryFeedback(.success, trigger: done)
    }

    private func loadPreview() async {
        error = nil
        do { preview = try await client.previewSkill(source: skill.source, skillId: skill.skillId) } catch { self.error = error.localizedDescription }
    }

    private func install() async {
        installing = true
        error = nil
        defer { installing = false }
        do {
            _ = try await client.installSkill(source: skill.source, skillId: skill.skillId, auto: auto)
            done += 1
        } catch {
            self.error = error.localizedDescription
            open = true
        }
    }
}
