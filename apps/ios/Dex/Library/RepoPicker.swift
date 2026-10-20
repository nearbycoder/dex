import DexCore
import SwiftUI

/// Adding or editing a project repo: search every repo the GitHub connection reaches (and public ones), or paste a
/// git URL; then pick the branch and the folder under ~/work.
struct RepoPicker: View {
    @Environment(\.dismiss) private var dismiss
    /// The repo being edited (opens straight at its branch and folder), or nil to add one.
    let editing: ProjectRepo?
    /// Repos already in the project (`owner/name`, lowercase), shown as added.
    let existing: Set<String>
    let onSave: (ProjectRepo) -> Void
    @State private var path: [Step] = []

    enum Step: Hashable {
        case configure(repo: GitHubRepo?, url: String)
        case url
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let editing {
                    RepoConfigure(repo: nil, url: editing.url, initial: editing, editing: true, onSave: save)
                } else {
                    RepoSearch(existing: existing) { repo in path.append(.configure(repo: repo, url: repo.fullName)) } onURL: { path.append(.url) }
                }
            }
            .navigationDestination(for: Step.self) { step in
                switch step {
                case .configure(let repo, let url): RepoConfigure(repo: repo, url: url, initial: nil, editing: false, onSave: save)
                case .url: RepoURLEntry { url in path.append(.configure(repo: nil, url: url)) }
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { dismiss() }.accessibilityIdentifier("repo.cancel")
                }
            }
        }
        .presentationDetents([.large])
    }

    private func save(_ repo: ProjectRepo) {
        onSave(repo)
        dismiss()
    }
}

/// Step one: find the repo (yours first, then public ones), filtered by owner.
private struct RepoSearch: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    let existing: Set<String>
    let onPick: (GitHubRepo) -> Void
    let onURL: () -> Void
    @State private var query = ""
    @State private var owner: String?
    @State private var access: GitHubAccess?
    @State private var repos: [GitHubRepo]?
    @State private var error: String?

    var body: some View {
        let github = client.state?.github
        let mine = repos?.filter(\.accessible) ?? []
        let others = repos?.filter { !$0.accessible } ?? []
        List {
            if let github, github.connected && github.expired == true {
                notice("GitHub stopped accepting your connection, so only public repos show.", action: github.via == "oauth" ? "Reconnect" : "Replace the Token")
            } else if let github, !github.connected {
                notice("Connect GitHub to see your private and org repos.", action: "Connect GitHub")
            }
            if let error {
                Text(error).foregroundStyle(.red).font(.callout).frame(maxWidth: .infinity).libraryEmptyRow()
            } else if repos == nil {
                Section { ForEach(0..<5, id: \.self) { _ in LibraryRowSkeleton() } }
            } else if repos?.isEmpty == true {
                if query.isEmpty {
                    ContentUnavailableView("No Repos Here Yet", systemImage: "shippingbox", description: Text("Search GitHub, or use a git URL.")).libraryEmptyRow()
                } else {
                    ContentUnavailableView.search(text: query).libraryEmptyRow()
                }
            }
            if !mine.isEmpty {
                Section(query.isEmpty && owner == nil ? "Recently Pushed" : "Your Repos") {
                    ForEach(mine) { repo in row(repo) }
                }
            }
            if !others.isEmpty {
                Section("Public on GitHub") {
                    ForEach(others) { repo in row(repo) }
                }
            }
            Section {
                Button(action: onURL) { Label("Use a Git URL", systemImage: "link") }
                    .accessibilityIdentifier("repo.useURL")
                if let manage = access?.manageUrl.flatMap(URL.init(string:)) {
                    Button { openURL(manage) } label: {
                        Label(access?.via == "oauth" ? "Missing an Org? Grant Access" : "Edit Token Access", systemImage: "arrow.up.forward.square")
                    }
                }
            } footer: {
                Text("GitLab, Bitbucket, or any https git URL works too.")
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) { ownerFilter }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: owner.map { "Search \($0)'s repos" } ?? "Search your repos and GitHub")
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .navigationTitle("Add Repository")
        .navigationBarTitleDisplayMode(.inline)
        .task { access = try? await client.githubRepoAccess() }
        .task(id: "\(query)|\(owner ?? "")") { await search() }
        .accessibilityIdentifier("repo.search")
    }

    /// Owners to narrow the list to: the connected account and the orgs Dex can see.
    @ViewBuilder private var ownerFilter: some View {
        if let access, access.connected, let login = access.login {
            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer {
                    HStack(spacing: 8) {
                        chip(nil, title: "All", avatar: nil)
                        chip(login, title: login, avatar: "")
                        ForEach(access.orgs, id: \.login) { org in chip(org.login, title: org.login, avatar: org.avatarUrl) }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                }
            }
            .scrollClipDisabled()
        }
    }

    private func chip(_ value: String?, title: String, avatar: String?) -> some View {
        let selected = owner == value
        return Button {
            owner = value
        } label: {
            HStack(spacing: 6) {
                if let avatar { OwnerAvatar(owner: title, url: avatar, size: 20) }
                Text(title)
            }
            .font(.subheadline.weight(selected ? .semibold : .regular))
            .padding(.horizontal, 4)
        }
        .buttonStyle(.glass)
        .tint(selected ? .accentColor : nil)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("repo.owner.\(value ?? "all")")
        .sensoryFeedback(.selection, trigger: selected)
    }

    private func notice(_ text: String, action: String) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Label(text, systemImage: "exclamationmark.triangle.fill").font(.subheadline).foregroundStyle(.orange)
                Button(action) {
                    dismiss()
                    router.openSettings(.github)
                }
                .buttonStyle(.glass)
                .accessibilityIdentifier("repo.github")
            }
            .padding(.vertical, 4)
        }
    }

    private func row(_ repo: GitHubRepo) -> some View {
        let added = existing.contains(repo.fullName.lowercased())
        return Button { onPick(repo) } label: { RepoResultRow(repo: repo, added: added) }
            .tint(.primary)
            .disabled(added)
            .accessibilityIdentifier("repo.result.\(repo.fullName)")
    }

    private func search() async {
        if !query.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
        guard !Task.isCancelled else { return }
        do {
            let found = try await client.searchGitHubRepos(query.trimmingCharacters(in: .whitespaces), owner: owner)
            guard !Task.isCancelled else { return }
            repos = found
            error = nil
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error.localizedDescription
            repos = []
        }
    }
}

/// A few languages' GitHub colors, for the dot beside a repo's language.
private let languageColors: [String: Color] = [
    "TypeScript": Color(red: 0.19, green: 0.47, blue: 0.78), "JavaScript": Color(red: 0.95, green: 0.88, blue: 0.35), "Python": Color(red: 0.21, green: 0.45, blue: 0.65),
    "Rust": Color(red: 0.87, green: 0.65, blue: 0.52), "Go": Color(red: 0, green: 0.68, blue: 0.85), "Swift": Color(red: 0.94, green: 0.32, blue: 0.22),
    "Kotlin": Color(red: 0.66, green: 0.48, blue: 1), "Java": Color(red: 0.69, green: 0.45, blue: 0.1), "Ruby": Color(red: 0.44, green: 0.08, blue: 0.09),
    "C++": Color(red: 0.95, green: 0.29, blue: 0.49), "C": Color(white: 0.33), "HTML": Color(red: 0.89, green: 0.3, blue: 0.15), "CSS": Color(red: 0.34, green: 0.24, blue: 0.49),
    "Shell": Color(red: 0.54, green: 0.88, blue: 0.32), "Vue": Color(red: 0.25, green: 0.72, blue: 0.51), "Dart": Color(red: 0, green: 0.71, blue: 0.67)
]

private struct RepoResultRow: View {
    let repo: GitHubRepo
    let added: Bool

    var body: some View {
        HStack(spacing: 12) {
            OwnerAvatar(owner: repo.owner, url: repo.ownerAvatar, size: 38)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 5) {
                    (Text(repo.owner + "/").foregroundStyle(.secondary) + Text(repo.name).fontWeight(.medium).foregroundStyle(.primary)).lineLimit(1)
                    if repo.isPrivate { Tag(text: "Private", symbol: "lock.fill", color: .orange) }
                    if repo.fork { Image(systemName: "tuningfork").font(.caption2).foregroundStyle(.secondary).accessibilityLabel("Fork") }
                    if repo.archived { Tag(text: "Archived") }
                }
                if !repo.description.isEmpty {
                    Text(repo.description).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                HStack(spacing: 10) {
                    if let language = repo.language {
                        HStack(spacing: 4) {
                            Circle().fill(languageColors[language] ?? .gray).frame(width: 7, height: 7)
                            Text(language)
                        }
                    }
                    if repo.stars > 0 { Label(repo.stars.formatted(), systemImage: "star").labelStyle(.compact) }
                    if let pushed = repo.pushedAtMs { Text("pushed \(Format.ago(pushed))") }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if added {
                Image(systemName: "checkmark").foregroundStyle(.green).accessibilityLabel("Added")
            } else {
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
        .opacity(added ? 0.55 : 1)
        .contentShape(.rect)
    }
}

/// Paste any https git URL (or `owner/repo`).
private struct RepoURLEntry: View {
    let onNext: (String) -> Void
    @State private var url = ""
    @FocusState private var focused: Bool

    var body: some View {
        let normalized = Repos.normalize(url)
        Form {
            Section {
                TextField("Git URL", text: $url, prompt: Text("https://gitlab.com/team/app.git"))
                    .font(.body.monospaced())
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .submitLabel(.next)
                    .onSubmit { if normalized != nil { onNext(url.trimmingCharacters(in: .whitespaces)) } }
                    .accessibilityIdentifier("repo.url")
            } footer: {
                if !url.isEmpty && normalized == nil {
                    FieldProblem(text: "Use owner/repo or an https:// git URL.")
                } else {
                    Text("Private repos on other hosts need their credentials on the VM.")
                }
            }
        }
        .navigationTitle("Git URL")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Next") { onNext(url.trimmingCharacters(in: .whitespaces)) }
                    .disabled(normalized == nil)
                    .accessibilityIdentifier("repo.url.next")
            }
        }
        .onAppear { focused = true }
    }
}

/// Step two: which branch, and which folder under ~/work.
private struct RepoConfigure: View {
    @Environment(DexClient.self) private var client
    @Environment(\.openURL) private var openURL
    let repo: GitHubRepo?
    let url: String
    let initial: ProjectRepo?
    let editing: Bool
    let onSave: (ProjectRepo) -> Void
    @State private var branches: [String]?
    @State private var branch = ""
    @State private var dir = ""
    @State private var filter = ""

    private var fullName: String? { repo?.fullName ?? (Repos.isGitHub(url) ? Repos.label(url) : nil) }

    var body: some View {
        let defaultBranch = branches?.first ?? repo?.defaultBranch
        let shown = (branches ?? []).filter { filter.isEmpty ? $0 != defaultBranch : $0.localizedCaseInsensitiveContains(filter) }.prefix(100)
        let target = fullName ?? url
        Form {
            Section {
                HStack(alignment: .top, spacing: 12) {
                    if let fullName {
                        OwnerAvatar(owner: String(fullName.split(separator: "/")[0]), url: repo?.ownerAvatar ?? "", size: 44)
                    } else {
                        Image(systemName: "link").font(.title3).frame(width: 44, height: 44).background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 11))
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(target).font(fullName == nil ? .callout.monospaced() : .headline).lineLimit(2)
                        if let description = repo?.description, !description.isEmpty {
                            Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }
                        if let fullName, let link = URL(string: "https://github.com/\(fullName)") {
                            Button { openURL(link) } label: { Label("View on GitHub", systemImage: "arrow.up.forward.square").labelStyle(.compact).font(.caption) }
                                .buttonStyle(.borderless)
                        }
                    }
                }
            }

            Section {
                if fullName != nil {
                    if let branches {
                        if branches.count > 8 {
                            TextField("Filter \(branches.count) branches", text: $filter)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .accessibilityIdentifier("repo.branch.filter")
                        }
                        if filter.isEmpty {
                            branchRow("Default branch", detail: defaultBranch, value: "")
                        }
                        ForEach(Array(shown), id: \.self) { name in branchRow(name, detail: nil, value: name, mono: true) }
                        if branches.isEmpty { Text("Couldn't list branches; the default is used.").font(.footnote).foregroundStyle(.secondary) }
                    } else {
                        HStack(spacing: 8) { ProgressView(); Text("Loading branches…").foregroundStyle(.secondary) }
                    }
                } else {
                    TextField("Branch", text: $branch, prompt: Text("Default branch"))
                        .font(.body.monospaced())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("repo.branch")
                }
            } header: {
                Text("Branch")
            }

            Section {
                HStack(spacing: 0) {
                    Text("~/work/").font(.body.monospaced()).foregroundStyle(.secondary)
                    TextField("Folder", text: $dir, prompt: Text(Repos.dirName(fullName.map { "https://github.com/\($0)" } ?? url)))
                        .font(.body.monospaced())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("repo.folder")
                }
            } header: {
                Text("Folder")
            } footer: {
                Text("Where it's cloned on each chat's VM.")
            }
        }
        .navigationTitle(editing ? "Edit Repository" : "Add Repository")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(editing ? "Save" : "Add") {
                    onSave(ProjectRepo(url: fullName ?? url, branch: branch, dir: dir.trimmingCharacters(in: .whitespaces)))
                }
                .keyboardShortcut("s", modifiers: .command)
                .accessibilityIdentifier("repo.save")
            }
        }
        .sensoryFeedback(.selection, trigger: branch)
        .onAppear {
            branch = initial?.branch ?? ""
            dir = initial?.dir ?? ""
        }
        .task {
            guard let fullName else { return }
            branches = (try? await client.listGitHubBranches(fullName)) ?? []
        }
    }

    private func branchRow(_ label: String, detail: String?, value: String, mono: Bool = false) -> some View {
        Button {
            branch = value
        } label: {
            HStack {
                Text(label).font(mono ? .body.monospaced() : .body).foregroundStyle(.primary).lineLimit(1)
                Spacer()
                if let detail { Text(detail).font(.callout.monospaced()).foregroundStyle(.secondary) }
                if branch == value { Image(systemName: "checkmark").fontWeight(.semibold).foregroundStyle(.tint) }
            }
            .contentShape(.rect)
        }
        .accessibilityAddTraits(branch == value ? .isSelected : [])
        .accessibilityIdentifier("repo.branch.\(value.isEmpty ? "default" : value)")
    }
}
