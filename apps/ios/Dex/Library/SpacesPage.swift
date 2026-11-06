import DexCore
import SwiftUI

/// Spaces: a coordinator chat that starts threads (ordinary chats) for each piece of the work and hears back from them.
struct SpacesList: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    var selection: Binding<LibraryRoute?>?
    @State private var filter = ""
    @State private var deleting: SpaceProfile?

    var body: some View {
        let spaces = SpacesSection.matching(client.state?.spaces ?? [], filter)
        List(selection: selection) {
            if client.state == nil {
                ForEach(0..<3, id: \.self) { _ in LibraryRowSkeleton() }
            } else if client.state?.spaces.isEmpty == true {
                EmptyStateView(title: "No Spaces", symbol: AppTab.spaces.symbol,
                               message: "A space is a chat with Dex that starts threads for each piece of the work, runs them in parallel, and reports back.",
                               actionTitle: "New Space") {
                    open(.newSpace)
                }
                .libraryEmptyRow()
            } else if spaces.isEmpty {
                ContentUnavailableView.search(text: filter).libraryEmptyRow()
            }
            ForEach(spaces) { space in
                NavigationLink(value: LibraryRoute.space(space.id)) {
                    SpaceLibraryRow(space: space)
                }
                .accessibilityIdentifier("space.item.\(space.id)")
                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                    Button { router.openChat(space.sessionId) } label: { Label("Open", systemImage: "bubble.left") }
                        .tint(.dexAccent)
                }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) { deleting = space } label: { Label("Delete", systemImage: "trash") }
                }
                .contextMenu {
                    Button { router.openChat(space.sessionId) } label: { Label("Open Space", systemImage: "bubble.left") }
                    Button { open(.space(space.id)) } label: { Label("Edit", systemImage: "pencil") }
                    Divider()
                    Button(role: .destructive) { deleting = space } label: { Label("Delete", systemImage: "trash") }
                }
            }
        }
        .searchable(text: $filter, prompt: "Search spaces")
        .navigationTitle("Spaces")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { open(.newSpace) } label: { Label("New Space", systemImage: "plus") }
                    .accessibilityIdentifier("spaces.add")
            }
        }
        .deleteSpaceDialog(deleting, isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }))
        .tint(Color.selectionAccent)
        .accessibilityIdentifier("spaces.list")
    }

    private func open(_ route: LibraryRoute) {
        if let selection { selection.wrappedValue = route } else { router.open(route, compact: true) }
    }
}

struct SpaceLibraryRow: View {
    @Environment(DexClient.self) private var client
    let space: SpaceProfile

    var body: some View {
        let threads = client.state?.threads(of: space) ?? []
        let working = client.state?.session(space.sessionId)?.busy == true || threads.contains(where: \.busy)
        HStack(alignment: .top, spacing: 12) {
            SpaceIcon(size: 40, working: working)
            VStack(alignment: .leading, spacing: 3) {
                Text(space.name).font(.body.weight(.medium)).lineLimit(1)
                Text(space.goal.isEmpty ? "A space" : space.goal).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                Text(([client.state?.project(space.projectId)?.name, threads.isEmpty ? "no threads yet" : threads.count == 1 ? "1 thread" : "\(threads.count) threads"]
                    .compactMap { $0 }).joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 1)
            }
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }
}

/// A space's page (or a new space's): its name, goal, and project. In Library it's a page of the stack; from the chats
/// it's a sheet (`inSheet`). Creating one goes straight to its chat, to tell it what to work on.
struct SpaceEditor: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    let spaceId: String?
    var inSheet = false
    @State private var draft: SpaceDraft?
    @State private var original: SpaceDraft?
    @State private var saving = false
    @State private var saved = 0
    @State private var error: String?
    @State private var tried = false
    @State private var confirmDelete = false

    private var existing: SpaceProfile? { client.state?.space(spaceId) }
    private var isNew: Bool { spaceId == nil }
    private var dirty: Bool { draft != original }

    var body: some View {
        Group {
            if client.state == nil {
                EditorSkeleton()
            } else if !isNew && existing == nil {
                ContentUnavailableView("Space Not Found", systemImage: AppTab.spaces.symbol, description: Text("This space no longer exists."))
            } else if let current = draft {
                form(Binding(get: { draft ?? current }, set: { draft = $0 }))
            } else {
                EditorSkeleton()
            }
        }
        .navigationTitle(draft.map { $0.name.isEmpty ? (isNew ? "New Space" : "Untitled") : $0.name } ?? "Space")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .navigationBarBackButtonHidden(isNew && !inSheet)
        .onAppear(perform: load)
        .onChange(of: client.state != nil) { load() }
        .onChange(of: existing?.updatedAt) {
            // Changed elsewhere (or just saved): show it, unless there are edits here.
            if !dirty, let existing { draft = SpaceDraft(existing); original = draft }
        }
        .sensoryFeedback(.success, trigger: saved)
        .interactiveDismissDisabled(dirty)
    }

    private func load() {
        guard draft == nil, client.state != nil else { return }
        let loaded = existing.map(SpaceDraft.init) ?? (isNew ? SpaceDraft() : nil)
        draft = loaded
        original = loaded
    }

    @ViewBuilder
    private func form(_ draft: Binding<SpaceDraft>) -> some View {
        let value = draft.wrappedValue
        let nameMissing = (tried || original?.name.isEmpty == false) && !value.isValid
        let projects = client.state?.projects ?? []
        Form {
            Section {
                HStack(spacing: 16) {
                    SpaceIcon(size: 60)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(value.name.isEmpty ? (isNew ? "New Space" : "Untitled") : value.name).font(.title2.bold()).lineLimit(2)
                        Text(value.goal.isEmpty ? "Dex starts threads for each piece of the work and reports back." : value.goal)
                            .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    if let existing {
                        Button { open(existing.sessionId) } label: {
                            Label("Open", systemImage: "bubble.left.fill").labelStyle(.iconOnly).font(.title3).frame(width: 30, height: 30)
                        }
                        .prominentButton()
                        .buttonBorderShape(.circle)
                        .accessibilityLabel("Open \(existing.name)")
                        .accessibilityIdentifier("space.open")
                    }
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .contain)
            }

            Section {
                TextField("Name", text: Binding(get: { draft.wrappedValue.name }, set: { draft.wrappedValue.name = String($0.replacingOccurrences(of: "\n", with: " ").prefix(Spaces.maxName)) }),
                          prompt: Text("Launch the new site"))
                    .font(.body.weight(.medium))
                    .accessibilityIdentifier("space.name")
            } footer: {
                if nameMissing { FieldProblem(text: "Give the space a name.") }
            }

            Section {
                LongTextField(title: "Goal", text: Binding(get: { draft.wrappedValue.goal }, set: { draft.wrappedValue.goal = String($0.prefix(Spaces.maxGoal)) }),
                              prompt: "Get the redesigned site live by Friday: fast, no broken links, announced.", lines: 3...10)
                    .accessibilityIdentifier("space.goal")
            } header: {
                Text("Goal")
            } footer: {
                Text("What the work is for; Dex keeps the threads pointed at it.")
            }

            Section {
                Picker(selection: draft.projectId) {
                    Text("None").tag(String?.none)
                    ForEach(projects) { project in
                        Text(project.name).tag(Optional(project.id))
                    }
                } label: {
                    Label("Project", systemImage: AppTab.projects.symbol)
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("space.project")
            } header: {
                Text("Project")
            } footer: {
                Text("Threads work in this project, each on its own VM.")
            }

            if let error {
                Section { FieldProblem(text: error) }
            }

            if let existing {
                let threads = client.state?.threads(of: existing) ?? []
                Section {
                    Button { open(existing.sessionId) } label: { Label("Open the Space's Chat", systemImage: "bubble.left.and.text.bubble.right") }
                        .accessibilityIdentifier("space.openChat")
                    Button {
                        if inSheet { dismiss() }
                        router.openChat(existing.sessionId)
                        router.spacePanel = SpacePanelRequest(spaceId: existing.id, tab: .threads)
                    } label: {
                        LabeledContent { Text("\(threads.count)").monospacedDigit() } label: { Label("Threads", systemImage: "list.bullet.rectangle") }
                    }
                    .tint(.primary)
                }
                Section {
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete Space", systemImage: "trash") }
                        .accessibilityIdentifier("space.delete")
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .deleteSpaceDialog(existing, isPresented: $confirmDelete) { if inSheet { dismiss() } }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if isNew || inSheet {
            ToolbarItem(placement: .cancellationAction) {
                Button(isNew || dirty ? "Cancel" : "Done") { close(.newSpace) }
                    .accessibilityIdentifier("space.cancel")
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
            .accessibilityIdentifier("space.save")
        }
    }

    /// Leaves the page: the sheet closes, or Library drops the route.
    private func close(_ route: LibraryRoute) {
        if inSheet { dismiss() } else { router.closeLibrary(route) }
    }

    /// Opens the space's chat, in Chats.
    private func open(_ sessionId: String) {
        if inSheet { dismiss() }
        router.openChat(sessionId)
    }

    private func save() async {
        guard let draft else { return }
        tried = true
        guard draft.isValid else { return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            let space = try await client.saveSpace(draft)
            let fresh = SpaceDraft(space)
            self.draft = fresh
            original = fresh
            saved += 1
            if isNew {
                // A new space: straight to its chat, to say what to work on.
                if !inSheet { router.replaceLibrary(.newSpace, with: .space(space.id)) }
                open(space.sessionId)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
