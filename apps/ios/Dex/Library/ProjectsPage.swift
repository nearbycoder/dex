import DexCore
import SwiftUI

/// Projects: repos and a setup script. Each chat on a project gets its own VM with everything cloned into ~/work.
struct ProjectsList: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    var selection: Binding<LibraryRoute?>?
    @State private var filter = ""
    @State private var deleting: ProjectProfile?

    var body: some View {
        let projects = (client.state?.projects ?? []).filter { filter.isEmpty || $0.name.localizedCaseInsensitiveContains(filter) || $0.description.localizedCaseInsensitiveContains(filter) }
        List(selection: selection) {
            if let github = client.state?.github, !github.connected || github.expired == true {
                Section {
                    Button { router.openSettings(.github) } label: {
                        Label(github.connected ? "GitHub stopped accepting your connection. Reconnect to clone private repos." : "Connect GitHub to clone private repos and push",
                              systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline)
                            .foregroundStyle(.orange)
                    }
                    .accessibilityIdentifier("projects.github")
                }
            }
            if client.state == nil {
                ForEach(0..<3, id: \.self) { _ in LibraryRowSkeleton() }
            } else if client.state?.projects.isEmpty == true {
                EmptyStateView(title: "No Projects", symbol: AppTab.projects.symbol, message: "Add your repos and a setup script, then start chats that are ready to work.", actionTitle: "New Project") {
                    open(.newProject)
                }
                .libraryEmptyRow()
            } else if projects.isEmpty {
                ContentUnavailableView.search(text: filter).libraryEmptyRow()
            }
            ForEach(projects) { project in
                NavigationLink(value: LibraryRoute.project(project.id)) {
                    ProjectRow(project: project, chats: client.state?.sessions.filter { $0.projectId == project.id }.count ?? 0)
                }
                .accessibilityIdentifier("project.row.\(project.id)")
                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                    Button { router.newChat(projectId: project.id) } label: { Label("Start Chat", systemImage: "plus.bubble") }
                        .tint(.accentColor)
                }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) { deleting = project } label: { Label("Delete", systemImage: "trash") }
                }
                .contextMenu {
                    Button { router.newChat(projectId: project.id) } label: { Label("Start Chat", systemImage: "plus.bubble") }
                    Button { open(.project(project.id)) } label: { Label("Edit", systemImage: "pencil") }
                    Divider()
                    Button(role: .destructive) { deleting = project } label: { Label("Delete", systemImage: "trash") }
                }
            }
        }
        .searchable(text: $filter, prompt: "Search projects")
        .navigationTitle("Projects")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { open(.newProject) } label: { Label("New Project", systemImage: "plus") }
                    .accessibilityIdentifier("projects.new")
            }
        }
        .confirmationDialog("Delete “\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { project in
            Button("Delete Project", role: .destructive) {
                router.closeLibrary(.project(project.id))
                client.perform { try await client.deleteProject(project.id) }
            }
        } message: { _ in
            Text("Its chats and their VMs stay.")
        }
        .accessibilityIdentifier("projects.list")
    }

    private func open(_ route: LibraryRoute) {
        if let selection { selection.wrappedValue = route } else { router.open(route, compact: true) }
    }
}

struct ProjectRow: View {
    let project: ProjectProfile
    let chats: Int

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AgentAvatar(icon: project.icon, color: project.color, image: project.image, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(project.name).font(.body.weight(.medium)).lineLimit(1)
                Text(project.description.isEmpty ? "Project" : project.description)
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(project.repos.prefix(2).enumerated()), id: \.offset) { _, repo in
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.triangle.branch").foregroundStyle(.tertiary)
                            Text(Repos.label(repo.url)).lineLimit(1)
                            if !repo.branch.isEmpty { Text(repo.branch).foregroundStyle(.tertiary).lineLimit(1) }
                        }
                    }
                    if project.repos.count > 2 { Text("+\(project.repos.count - 2) more").foregroundStyle(.tertiary) }
                    Text("\(project.repos.isEmpty ? "No repos · " : "")\(project.setupScript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "No setup script" : "Setup script") · \(chats == 1 ? "1 chat" : "\(chats) chats")")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 1)
            }
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }
}

/// A project's editor (or a new project's).
struct ProjectEditor: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let projectId: String?
    @State private var draft: ProjectDraft?
    @State private var original: ProjectDraft?
    @State private var saving = false
    @State private var saved = 0
    @State private var error: String?
    @State private var tried = false
    @State private var repoSheet: RepoSheetItem?
    @State private var confirmDelete = false

    struct RepoSheetItem: Identifiable {
        /// The repo being edited, or nil to add one.
        let index: Int?
        var id: Int { index ?? -1 }
    }

    private var existing: ProjectProfile? { client.state?.project(projectId) }
    private var isNew: Bool { projectId == nil }
    private var dirty: Bool { draft != original }

    var body: some View {
        Group {
            if client.state == nil {
                EditorSkeleton()
            } else if !isNew && existing == nil {
                ContentUnavailableView("Project Not Found", systemImage: AppTab.projects.symbol, description: Text("This project no longer exists."))
            } else if let current = draft {
                // Not a force-unwrapped Binding($draft): a text field ending editing can read it after the draft
                // is replaced.
                form(Binding(get: { draft ?? current }, set: { draft = $0 }))
            } else {
                EditorSkeleton()
            }
        }
        .navigationTitle(draft.map { $0.name.isEmpty ? (isNew ? "New Project" : "Untitled") : $0.name } ?? "Project")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .navigationBarBackButtonHidden(isNew)
        .onAppear(perform: load)
        .onChange(of: client.state != nil) { load() }
        .onChange(of: existing?.updatedAt) {
            // Changed elsewhere (or just saved): show it, unless there are edits here.
            if !dirty, let existing { draft = ProjectDraft(existing); original = draft }
        }
        .sensoryFeedback(.success, trigger: saved)
    }

    private func load() {
        guard draft == nil, client.state != nil else { return }
        let loaded = existing.map(ProjectDraft.init) ?? (isNew ? ProjectDraft() : nil)
        draft = loaded
        original = loaded
    }

    @ViewBuilder
    private func form(_ draft: Binding<ProjectDraft>) -> some View {
        let value = draft.wrappedValue
        let nameMissing = (tried || original?.name.isEmpty == false) && !value.isValid
        let settings = client.state?.settings ?? DexSettings()
        Form {
            Section {
                ProfileHeader(icon: value.icon, color: value.color, image: value.image, title: value.name.isEmpty ? (isNew ? "New Project" : "Untitled") : value.name,
                              subtitle: value.description.isEmpty ? "What this project is" : value.description)
            }

            Section {
                TextField("Name", text: draft.name, prompt: Text("Dex"))
                    .font(.body.weight(.medium))
                    .accessibilityIdentifier("project.name")
                TextField("Description", text: draft.description, prompt: Text("Agent harness on Cloudflare"))
                    .accessibilityIdentifier("project.description")
            } footer: {
                if nameMissing { FieldProblem(text: "Give the project a name.") }
            }

            Section {
                ForEach(Array(value.repos.enumerated()), id: \.offset) { index, repo in
                    Button { repoSheet = RepoSheetItem(index: index) } label: { RepoCardRow(repo: repo) }
                        .tint(.primary)
                        .accessibilityIdentifier("project.repo.\(index)")
                        .swipeActions {
                            Button(role: .destructive) { draft.wrappedValue.repos.remove(at: index) } label: { Label("Remove", systemImage: "trash") }
                        }
                        .contextMenu {
                            Button { repoSheet = RepoSheetItem(index: index) } label: { Label("Edit", systemImage: "pencil") }
                            Button(role: .destructive) { draft.wrappedValue.repos.remove(at: index) } label: { Label("Remove", systemImage: "trash") }
                        }
                }
                .onMove { draft.wrappedValue.repos.move(fromOffsets: $0, toOffset: $1) }
                Button { repoSheet = RepoSheetItem(index: nil) } label: { Label("Add Repository", systemImage: "plus") }
                    .accessibilityIdentifier("project.addRepo")
            } header: {
                Text("Repositories")
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Cloned into ~/work/<folder> on each chat's VM: your GitHub repos (private and org ones included), any public repo, or a git URL.")
                    GitHubNote()
                }
            }

            Section {
                LongTextField(title: "Setup script", text: draft.setupScript, prompt: "cd my-app\nnpm ci\ncp .env.example .env", monospaced: true, lines: 4...14)
                    .accessibilityIdentifier("project.setup")
            } header: {
                Text("Setup Script")
            } footer: {
                Text("Bash, run once in ~/work after cloning each new VM, with set -e. It can run for up to 30 minutes; its log is ~/work/.dex/setup.log. Changes apply to new VMs.")
            }

            Section {
                LongTextField(title: "Notes", text: draft.instructions, prompt: "TypeScript monorepo. Run `npm test` before committing.\nPRs go against main.", lines: 3...12)
                    .accessibilityIdentifier("project.notes")
            } header: {
                Text("Notes for Dex")
            } footer: {
                Text("Architecture, conventions, how to run and test. Added to the system prompt of this project's chats.")
            }

            Section {
                TextField("Starter prompt", text: draft.starter, prompt: Text("In my-app, "), axis: .vertical)
                    .accessibilityIdentifier("project.starter")
                Picker("VM Size", selection: draft.vmSize) {
                    Text("Default (\(VmSizes.all.first { $0.id == settings.vmSize }?.label.components(separatedBy: " · ").first ?? settings.vmSize))").tag(String?.none)
                    ForEach(VmSizes.all, id: \.id) { size in Text(size.label).tag(Optional(size.id)) }
                }
                .accessibilityIdentifier("project.vmSize")
            } footer: {
                Text("The starter is prefilled when you pick the project. The default VM size comes from Settings.")
            }

            Section {
                ProjectPicturePicker(draft: draft)
            } header: {
                Text("Picture")
            } footer: {
                Text("A favicon or logo from the project's first GitHub repo, or its owner's avatar, shown instead of the icon.")
            }

            Section("Icon") {
                IconGrid(selection: draft.icon, color: value.color)
                    .opacity(value.image == nil ? 1 : 0.5)
            }
            Section("Color") {
                ColorRow(selection: draft.color)
            }

            if let error {
                Section { FieldProblem(text: error) }
            }

            if let projectId, existing != nil {
                Section {
                    Button { router.newChat(projectId: projectId) } label: { Label("Start Chat", systemImage: "plus.bubble") }
                        .accessibilityIdentifier("project.startChat")
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete Project", systemImage: "trash") }
                        .accessibilityIdentifier("project.delete")
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .sheet(item: $repoSheet) { item in
            RepoPicker(
                editing: item.index.flatMap { value.repos.indices.contains($0) ? value.repos[$0] : nil },
                existing: Set(value.repos.map { Repos.label($0.url).lowercased() })
            ) { repo in
                if let index = item.index, draft.wrappedValue.repos.indices.contains(index) { draft.wrappedValue.repos[index] = repo } else { draft.wrappedValue.repos.append(repo) }
            }
        }
        .confirmationDialog("Delete “\(value.name)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete Project", role: .destructive) {
                guard let projectId else { return }
                router.closeLibrary(.project(projectId))
                client.perform { try await client.deleteProject(projectId) }
            }
        } message: {
            Text("Its chats and their VMs stay.")
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if isNew {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { router.closeLibrary(.newProject) }
                    .accessibilityIdentifier("project.cancel")
            }
        }
        ToolbarItem(placement: .confirmationAction) {
            Button {
                Task { await save() }
            } label: {
                if saving { ProgressView() } else { Text(isNew ? "Create" : "Save") }
            }
            .disabled(saving || draft == nil || (!isNew && !dirty))
            .keyboardShortcut("s", modifiers: .command)
            .accessibilityIdentifier("project.save")
        }
    }

    private func save() async {
        guard let draft else { return }
        tried = true
        guard draft.isValid else { return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            let project = try await client.saveProject(draft)
            let fresh = ProjectDraft(project)
            self.draft = fresh
            original = fresh
            saved += 1
            if isNew { router.replaceLibrary(.newProject, with: .project(project.id)) }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// One repo in the project editor: who and what, its branch and folder.
struct RepoCardRow: View {
    let repo: ProjectRepo

    var body: some View {
        let label = Repos.label(repo.url)
        let github = Repos.isGitHub(repo.url)
        let parts = label.split(separator: "/", maxSplits: 1).map(String.init)
        HStack(spacing: 12) {
            if github {
                OwnerAvatar(owner: parts[0], size: 36)
            } else {
                Image(systemName: "link")
                    .frame(width: 36, height: 36)
                    .foregroundStyle(.secondary)
                    .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 9, style: .continuous))
            }
            VStack(alignment: .leading, spacing: 2) {
                if github, parts.count == 2 {
                    (Text(parts[0] + "/").foregroundStyle(.secondary) + Text(parts[1]).fontWeight(.medium).foregroundStyle(.primary))
                        .lineLimit(1)
                } else {
                    Text(label).font(.callout.monospaced()).foregroundStyle(.primary).lineLimit(1)
                }
                HStack(spacing: 8) {
                    Label(repo.branch.isEmpty ? "default branch" : repo.branch, systemImage: "arrow.triangle.branch")
                    Text("~/work/\(repo.dir.isEmpty ? Repos.dirName(repo.url) : repo.dir)").font(.caption.monospaced())
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .labelStyle(.compact)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .contentShape(.rect)
    }
}

/// Under the repo list: why private repos might be missing, and the fix (Settings → GitHub).
struct GitHubNote: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router

    var body: some View {
        if let github = client.state?.github {
            if github.connected && github.expired == true {
                Button { router.openSettings(.github) } label: {
                    Text("GitHub stopped accepting your connection, so private repos won't clone. ") + Text(github.via == "oauth" ? "Reconnect" : "Replace the token").bold()
                }
                .foregroundStyle(.orange)
                .accessibilityIdentifier("github.reconnect")
            } else if !github.connected {
                Button { router.openSettings(.github) } label: {
                    Text("Public repos only until you ") + Text("connect GitHub").bold() + Text(".")
                }
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("github.connect")
            }
        }
    }
}

/// The project's picture: favicons, app icons, and logos found in its first GitHub repo, or the owner's avatar. Looked
/// up by itself when the project has a repo and no picture yet; otherwise on request.
struct ProjectPicturePicker: View {
    @Environment(DexClient.self) private var client
    @Binding var draft: ProjectDraft
    @State private var found: (repo: String, candidates: [ProjectImageCandidate])?
    @State private var loading = false
    @State private var error: String?

    private var repo: String? { draft.repos.lazy.compactMap { Repos.githubRepo($0.url) }.first }

    var body: some View {
        if let repo {
            let candidates = found?.repo == repo ? found!.candidates : []
            VStack(alignment: .leading, spacing: 10) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        tile(selected: draft.image == nil, label: "No picture") {
                            Image(systemName: "nosign").font(.title3).foregroundStyle(.secondary)
                        } action: { draft.image = nil }
                            .accessibilityIdentifier("picture.none")
                        if let current = draft.image, !candidates.contains(where: { $0.dataUrl == current }) {
                            tile(selected: true, label: "Current picture") { picture(current) } action: {}
                        }
                        ForEach(candidates) { candidate in
                            tile(selected: draft.image == candidate.dataUrl, label: candidate.isAvatar ? "\(repo.split(separator: "/")[0])'s GitHub avatar" : candidate.path) {
                                picture(candidate.dataUrl)
                            } action: { draft.image = candidate.dataUrl }
                                .accessibilityIdentifier("picture.\(candidate.path)")
                        }
                        if loading {
                            ProgressView().padding(.horizontal, 8)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .scrollClipDisabled()
                if let error {
                    FieldProblem(text: error)
                } else if loading {
                    Text("Looking in \(repo)…").font(.caption).foregroundStyle(.secondary)
                } else if found?.repo == repo {
                    Text(candidates.isEmpty ? "No favicon or logo found in \(repo)." : "From \(repo). Touch and hold a picture for its file.")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Button { Task { await look(repo) } } label: { Label("Find in \(repo)", systemImage: "magnifyingglass") }
                        .accessibilityIdentifier("picture.find")
                }
            }
            .task(id: repo) {
                if draft.image == nil, found?.repo != repo { await look(repo) }
            }
            .sensoryFeedback(.selection, trigger: draft.image)
        } else {
            Text("Add a GitHub repo to use its favicon or logo.").foregroundStyle(.secondary)
        }
    }

    private func picture(_ dataUrl: String) -> some View {
        Group {
            if let image = AgentAvatar.decode(dataUrl) {
                Image(uiImage: image).resizable().interpolation(.medium).scaledToFit()
            } else if dataUrl.hasPrefix("data:image/svg+xml") {
                SVGPicture(dataUrl: dataUrl)
            } else {
                Image(systemName: "photo").foregroundStyle(.secondary)
            }
        }
    }

    private func tile<Content: View>(selected: Bool, label: String, @ViewBuilder content: () -> Content, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            content()
                .padding(10)
                .frame(width: 56, height: 56)
                .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(selected ? Color.accentColor : .clear, lineWidth: 2.5))
        }
        .buttonStyle(.plain)
        .help(label)
        .contextMenu { Text(label) }
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func look(_ repo: String) async {
        loading = true
        error = nil
        defer { loading = false }
        do {
            let candidates = try await client.projectImageCandidates(repo)
            if self.repo == repo || found == nil { found = (repo, candidates) }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
