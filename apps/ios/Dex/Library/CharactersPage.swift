import DexCore
import PhotosUI
import SwiftUI

/// Characters: companions with a name, a personality, and one long conversation of their own, pinned above the chats.
struct CharactersList: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    var selection: Binding<LibraryRoute?>?
    @State private var filter = ""
    @State private var deleting: CharacterProfile?

    var body: some View {
        let characters = CharactersSection.matching(client.state?.characters ?? [], filter)
        List(selection: selection) {
            if client.state == nil {
                ForEach(0..<3, id: \.self) { _ in LibraryRowSkeleton() }
            } else if client.state?.characters.isEmpty == true {
                EmptyStateView(title: "No Sidekicks", symbol: AppTab.characters.symbol,
                               message: "Make a creative partner, a planner, a coach, or anyone you'd like to talk to. Each has one long conversation that remembers you.",
                               actionTitle: "New Sidekick") {
                    open(.newCharacter)
                }
                .libraryEmptyRow()
            } else if characters.isEmpty {
                ContentUnavailableView.search(text: filter).libraryEmptyRow()
            }
            ForEach(characters) { character in
                NavigationLink(value: LibraryRoute.character(character.id)) {
                    CharacterRow(character: character)
                }
                .accessibilityIdentifier("character.item.\(character.id)")
                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                    Button { router.openChat(character.sessionId) } label: { Label("Talk", systemImage: "bubble.left") }
                        .tint(.dexAccent)
                }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) { deleting = character } label: { Label("Delete", systemImage: "trash") }
                }
                .contextMenu {
                    Button { router.openChat(character.sessionId) } label: { Label("Talk to \(character.name)", systemImage: "bubble.left") }
                    Button { open(.character(character.id)) } label: { Label("Edit", systemImage: "pencil") }
                    Divider()
                    Button(role: .destructive) { deleting = character } label: { Label("Delete", systemImage: "trash") }
                }
            }
        }
        .searchable(text: $filter, prompt: "Search sidekicks")
        .navigationTitle("Sidekicks")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { open(.newCharacter) } label: { Label("New Sidekick", systemImage: "plus") }
                    .accessibilityIdentifier("characters.add")
            }
        }
        .confirmationDialog("Delete “\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { character in
            Button("Delete Sidekick", role: .destructive) {
                router.closeLibrary(.character(character.id))
                client.perform { try await client.deleteCharacter(character.id) }
            }
        } message: { _ in
            Text("Your conversations with them stay, as ordinary chats.")
        }
        // The selected row (iPad): white text on the darker accent, readable in dark mode too.
        .tint(Color.selectionAccent)
        .accessibilityIdentifier("characters.list")
    }

    private func open(_ route: LibraryRoute) {
        if let selection { selection.wrappedValue = route } else { router.open(route, compact: true) }
    }
}

struct CharacterRow: View {
    @Environment(DexClient.self) private var client
    let character: CharacterProfile

    var body: some View {
        let session = client.state?.session(character.sessionId)
        HStack(alignment: .top, spacing: 12) {
            CharacterAvatar(character, size: 40, typing: session?.busy == true)
            VStack(alignment: .leading, spacing: 3) {
                Text(character.name).font(.body.weight(.medium)).lineLimit(1)
                Text(character.tagline.isEmpty ? "A sidekick" : character.tagline)
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                HStack(spacing: 5) {
                    MakerLogo(maker: client.catalog.model(character.model)?.maker ?? "", size: 12)
                    Text(client.catalog.name(of: character.model))
                    if let session {
                        Text("·")
                        Text(session.updatedAt > session.createdAt + 1_000 ? "talked \(Format.ago(session.updatedAt))" : "new")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .padding(.top, 1)
            }
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }
}

/// A character's page (or a new character's): templates (new only), who they are, how they look, their model, their
/// memory, and their conversations. In Library it's a page of the stack; from the chats it's a sheet (`inSheet`).
/// Creating one goes straight to their conversation.
struct CharacterEditor: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dismiss) private var dismiss
    let characterId: String?
    var inSheet = false
    @State private var draft: CharacterDraft?
    @State private var original: CharacterDraft?
    @State private var template: String?
    @State private var saving = false
    @State private var saved = 0
    @State private var error: String?
    @State private var tried = false
    @State private var pickingModel = false
    @State private var confirmDelete = false
    @State private var confirmRestart = false
    @State private var photo: PhotosPickerItem?
    @State private var readingPhoto = false

    private var existing: CharacterProfile? { client.state?.character(characterId) }
    private var isNew: Bool { characterId == nil }
    private var dirty: Bool { draft != original }

    var body: some View {
        Group {
            if client.state == nil {
                EditorSkeleton()
            } else if !isNew && existing == nil {
                ContentUnavailableView("Sidekick Not Found", systemImage: AppTab.characters.symbol, description: Text("This sidekick no longer exists."))
            } else if let current = draft {
                // Not a force-unwrapped Binding($draft): a text field ending editing can read it after the draft
                // is replaced.
                form(Binding(get: { draft ?? current }, set: { draft = $0 }))
            } else {
                EditorSkeleton()
            }
        }
        .navigationTitle(draft.map { $0.name.isEmpty ? (isNew ? "New Sidekick" : "Untitled") : $0.name } ?? "Sidekick")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .navigationBarBackButtonHidden(isNew && !inSheet)
        .onAppear(perform: load)
        .onChange(of: client.state != nil) { load() }
        .onChange(of: existing?.updatedAt) {
            // Changed elsewhere (or just saved): show it, unless there are edits here.
            if !dirty, let existing { draft = CharacterDraft(existing); original = draft }
        }
        .onChange(of: photo) { _, item in
            guard let item else { return }
            photo = nil
            Task { await usePhoto(item) }
        }
        .sensoryFeedback(.success, trigger: saved)
        .interactiveDismissDisabled(dirty)
    }

    private func load() {
        guard draft == nil, let state = client.state else { return }
        let loaded = existing.map(CharacterDraft.init) ?? (isNew ? CharacterDraft(model: state.settings.defaultModel, thinking: state.settings.defaultThinking) : nil)
        draft = loaded
        original = loaded
    }

    @ViewBuilder
    private func form(_ draft: Binding<CharacterDraft>) -> some View {
        let value = draft.wrappedValue
        let nameMissing = (tried || original?.name.isEmpty == false) && !value.isValid
        Form {
            Section {
                HStack(spacing: 16) {
                    CharacterAvatar(glyph: value.glyph, color: value.color, image: value.image, size: 64)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(value.name.isEmpty ? (isNew ? "New Sidekick" : "Untitled") : value.name).font(.title2.bold()).lineLimit(2)
                        Text(value.tagline.isEmpty ? "Who are they to you?" : value.tagline).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    if let existing {
                        Button { open(existing.sessionId) } label: {
                            Label("Talk", systemImage: "bubble.left.fill").labelStyle(.iconOnly).font(.title3).frame(width: 30, height: 30)
                        }
                        .prominentButton()
                        .buttonBorderShape(.circle)
                        .accessibilityLabel("Talk to \(existing.name)")
                        .accessibilityIdentifier("character.talk")
                    }
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .contain)
            }

            if isNew {
                Section {
                    TemplateGrid(selection: template) { picked in
                        template = picked?.id ?? "blank"
                        if let picked { draft.wrappedValue = draft.wrappedValue.applying(picked) } else {
                            draft.wrappedValue = CharacterDraft(model: value.model, thinking: value.thinking, mcpServers: value.mcpServers)
                        }
                    }
                } header: {
                    Text("Start From")
                } footer: {
                    Text("Fills in everything below; change any of it.")
                }
            }

            Section {
                TextField("Name", text: draft.name, prompt: Text("Muse"))
                    .font(.body.weight(.medium))
                    .accessibilityIdentifier("character.name")
                TextField("Tagline", text: draft.tagline, prompt: Text("Your creative sparring partner"))
                    .accessibilityIdentifier("character.tagline")
            } footer: {
                if nameMissing { FieldProblem(text: "Give the sidekick a name.") } else { Text("The tagline is the line under their name in the chat list.") }
            }

            Section {
                LookGrid(selection: value.preset?.id) { draft.wrappedValue.use($0) }
                // A photo: one that isn't a ready-made look.
                let photoShown = value.image != nil && value.look == nil
                PhotosPicker(selection: $photo, matching: .images) {
                    HStack {
                        Label(photoShown ? "Change Photo" : "Use a Photo", systemImage: "photo.on.rectangle")
                        if readingPhoto { Spacer(); ProgressView() }
                    }
                }
                .disabled(readingPhoto)
                .accessibilityIdentifier("character.photo")
                if photoShown {
                    Button(role: .destructive) { draft.wrappedValue.removePicture() } label: { Label("Remove Photo", systemImage: "xmark.circle") }
                        .accessibilityIdentifier("character.photo.remove")
                }
            } header: {
                Text("Look")
            } footer: {
                if let id = existing?.id, let server = client.server {
                    Text("Pick a ready-made sidekick or a photo. To mix your own look, [customize on the web](\(server.appending(path: "sidekicks/\(id)").absoluteString)).")
                } else {
                    Text("Pick a ready-made sidekick or a photo. To mix your own look, customize them on the web.")
                }
            }

            Section {
                LongTextField(title: "Character profile", text: draft.persona, prompt: "Playful and curious, an artist friend who gets excited about half-formed ideas…", lines: 4...14)
                    .accessibilityIdentifier("character.persona")
            } header: {
                Text("Character Profile")
            } footer: {
                Text("Who they are: personality, voice, backstory, how they talk to you. They become this instead of Dex.")
            }

            Section {
                LongTextField(title: "Prompt", text: draft.instructions, prompt: "Help me brainstorm and make small prototypes. Remember the projects we've worked on…", lines: 4...14)
                    .accessibilityIdentifier("character.instructions")
            } header: {
                Text("Prompt")
            } footer: {
                Text("What they do for you, and any rules. Edits apply to the conversation right away.")
            }

            Section {
                TextField("Greeting", text: draft.greeting, prompt: Text("Hey you. What are we making today?"), axis: .vertical)
                    .lineLimit(2...6)
                    .accessibilityIdentifier("character.greeting")
            } header: {
                Text("Greeting")
            } footer: {
                Text("Their first words, at the top of the conversation.")
            }

            Section {
                Button {
                    pickingModel = true
                } label: {
                    HStack(spacing: 10) {
                        MakerLogo(maker: client.catalog.model(value.model)?.maker ?? "", size: 20)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(client.catalog.name(of: value.model)).foregroundStyle(.primary)
                            Text("\(ThinkingLevels.label(value.thinking)) thinking").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(.tertiary)
                    }
                    .contentShape(.rect)
                }
                .tint(.primary)
                .accessibilityIdentifier("character.model")
            } header: {
                Text("Model and Thinking")
            } footer: {
                Text("Changing them moves the conversation to the new model.")
            }

            if let servers = client.state?.mcp, !servers.isEmpty {
                Section {
                    ForEach(servers) { server in
                        Toggle(isOn: Binding(get: { draft.wrappedValue.mcpServers.contains(server.id) }, set: { on in
                            draft.wrappedValue.mcpServers = on ? draft.wrappedValue.mcpServers + [server.id] : draft.wrappedValue.mcpServers.filter { $0 != server.id }
                        })) {
                            HStack(spacing: 8) {
                                McpStatusDot(status: server.status)
                                Text(server.name)
                                Text(server.statusLabel).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityIdentifier("character.mcp.\(server.id)")
                    }
                } header: {
                    Text("MCP Servers")
                } footer: {
                    Text("Tools from these servers are always on in their conversation.")
                }
            }

            if let error {
                Section { FieldProblem(text: error) }
            }

            if let existing {
                // Saved as you pick it, apart from the rest of the page.
                Section {
                    Picker(selection: Binding(get: { existing.notifyLevel }, set: { level in
                        client.perform { try await client.setCharacterNotify(existing, level) }
                    })) {
                        ForEach(SidekickNotify.allCases) { level in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(level.label)
                                Text(level.description).font(.caption).foregroundStyle(.secondary)
                            }
                            .tag(level)
                            .accessibilityIdentifier("character.notify.\(level.rawValue)")
                        }
                    } label: {
                        EmptyView()
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                    .accessibilityIdentifier("character.notify")
                } header: {
                    Text("Notify Me")
                } footer: {
                    Text("Notifications from \(existing.name) reach your devices that get Sidekicks notifications (Settings → Notifications).")
                }

                CharacterMemorySection(id: existing.id, name: existing.name)
                    .id(existing.id)

                Section {
                    ForEach(client.state?.conversations(of: existing.id) ?? []) { session in
                        Button { open(session.id) } label: {
                            HStack {
                                Text(session.id == existing.sessionId ? "Current" : "Started \(Format.date(session.createdAt))").foregroundStyle(.primary)
                                Spacer()
                                Text(session.updatedAt > session.createdAt + 1_000 ? Format.ago(session.updatedAt) : "nothing yet")
                                    .font(.subheadline).foregroundStyle(.secondary)
                                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                            }
                            .contentShape(.rect)
                        }
                        .tint(.primary)
                        .accessibilityIdentifier("character.conversation.\(session.id)")
                    }
                    Button { confirmRestart = true } label: { Label("Start Over…", systemImage: "arrow.counterclockwise") }
                        .accessibilityIdentifier("character.startOver")
                } header: {
                    Text("Conversations")
                } footer: {
                    Text("Start over for a new conversation: \(existing.name) keeps their memory, and earlier ones stay here.")
                }

                Section {
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete Sidekick", systemImage: "trash") }
                        .accessibilityIdentifier("character.delete")
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .sheet(isPresented: $pickingModel) {
            ModelPickerSheet(model: value.model, thinking: value.thinking) { model, thinking in
                if let model {
                    draft.wrappedValue.model = model
                    if let picked = client.catalog.model(model) { draft.wrappedValue.thinking = picked.clampThinking(draft.wrappedValue.thinking) }
                }
                if let thinking { draft.wrappedValue.thinking = thinking }
            }
            .presentationDetents([.large])
        }
        .confirmationDialog("Delete “\(value.name)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete Sidekick", role: .destructive) {
                guard let characterId else { return }
                close(.character(characterId))
                client.perform { try await client.deleteCharacter(characterId) }
            }
            .accessibilityIdentifier("character.delete.confirm")
        } message: {
            Text("Your conversations with them stay, as ordinary chats.")
        }
        .modifier(OptionalStartOver(character: existing, isPresented: $confirmRestart) { if inSheet { dismiss() } })
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if isNew || inSheet {
            ToolbarItem(placement: .cancellationAction) {
                Button(isNew || dirty ? "Cancel" : "Done") { close(.newCharacter) }
                    .accessibilityIdentifier("character.cancel")
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
            .accessibilityIdentifier("character.save")
        }
    }

    /// Leaves the page: the sheet closes, or Library drops the route.
    private func close(_ route: LibraryRoute) {
        if inSheet { dismiss() } else { router.closeLibrary(route) }
    }

    /// Opens one of their conversations, in Chats.
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
            let character = try await client.saveCharacter(draft)
            let fresh = CharacterDraft(character)
            self.draft = fresh
            original = fresh
            saved += 1
            if isNew {
                // A new character: straight to saying hi.
                if !inSheet { router.replaceLibrary(.newCharacter, with: .character(character.id)) }
                open(character.sessionId)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func usePhoto(_ item: PhotosPickerItem) async {
        readingPhoto = true
        defer { readingPhoto = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { throw CharacterPicture.Problem.unreadable }
            let url = try await Task.detached { try CharacterPicture.dataURL(from: data) }.value
            draft?.usePhoto(url)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Start over from the page, when there's a character to start over with.
private struct OptionalStartOver: ViewModifier {
    let character: CharacterProfile?
    @Binding var isPresented: Bool
    let opened: () -> Void

    func body(content: Content) -> some View {
        if let character { content.startOverDialog(character, isPresented: $isPresented, then: opened) } else { content }
    }
}

/// The templates a new character can start from, and Blank.
private struct TemplateGrid: View {
    let selection: String?
    let pick: (CharacterTemplate?) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 136), spacing: 10)], spacing: 10) {
            ForEach(CharacterTemplate.all) { template in
                tile(id: template.id, title: template.name, subtitle: template.tagline) {
                    CharacterAvatar(glyph: String(template.name.prefix(1)), color: template.color, image: template.look?.image, size: 32)
                } action: { pick(template) }
            }
            tile(id: "blank", title: "Blank", subtitle: "Start from scratch") {
                Image(systemName: "plus")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 32, height: 32)
                    .overlay(Circle().strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [3, 3])).foregroundStyle(.tertiary))
            } action: { pick(nil) }
        }
        .padding(.vertical, 6)
        .sensoryFeedback(.selection, trigger: selection)
    }

    private func tile<Icon: View>(id: String, title: String, subtitle: String, @ViewBuilder icon: () -> Icon, action: @escaping () -> Void) -> some View {
        let selected = selection == id
        return Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                icon()
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2, reservesSpace: true).multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(selected ? Color.dexAccent.opacity(0.14) : Color(.tertiarySystemFill), in: .rect(cornerRadius: 14, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(selected ? Color.dexAccent : .clear, lineWidth: 2) }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("character.template.\(id)")
    }
}

/// The ready-made looks (assets/sidekicks), each a little character on its color.
private struct LookGrid: View {
    let selection: String?
    let pick: (SidekickLook) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 56, maximum: 72), spacing: 10)], spacing: 10) {
            ForEach(SidekickLook.all) { look in
                let selected = selection == look.id
                Button { pick(look) } label: {
                    CharacterAvatar(glyph: String(look.name.prefix(1)), color: look.color, image: look.image, size: 52)
                        .padding(3)
                        .overlay { Circle().strokeBorder(selected ? Color.dexAccent : .clear, lineWidth: 2.5) }
                        .contentShape(.circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(look.name)
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("character.look.\(look.id)")
            }
        }
        .padding(.vertical, 6)
        .sensoryFeedback(.selection, trigger: selection)
    }
}

/// Their own notes about you: they read these every turn and keep them up to date; you can edit them too.
private struct CharacterMemorySection: View {
    @Environment(DexClient.self) private var client
    let id: String
    let name: String
    @State private var text: String?
    @State private var loaded = ""
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        Section {
            if let current = text {
                LongTextField(title: "Memory", text: Binding(get: { text ?? current }, set: { text = $0 }), prompt: "Empty so far. \(name) writes here as they get to know you.",
                              monospaced: true, lines: 4...16)
                    .accessibilityIdentifier("character.memory")
                Button {
                    Task { await save() }
                } label: {
                    HStack {
                        Text(current == loaded ? "Memory Saved" : "Save Memory")
                        if saving { Spacer(); ProgressView() }
                    }
                }
                .disabled(saving || current == loaded)
                .accessibilityIdentifier("character.memory.save")
                if let problem { FieldProblem(text: problem) }
            } else {
                LineBone(width: 220)
                LineBone(width: 160)
            }
        } header: {
            Text("Memory")
        } footer: {
            Text("\(name) reads this every turn and keeps it up to date as they get to know you. It lives at \(Characters.memoryPath(id)).")
        }
        .task(id: id) {
            // An agent without characters' memory yet shows it empty.
            let memory = (try? await client.characterMemory(id)) ?? ""
            text = memory
            loaded = memory
        }
    }

    private func save() async {
        guard let text else { return }
        saving = true
        problem = nil
        defer { saving = false }
        do {
            try await client.saveCharacterMemory(id, text)
            loaded = text
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// A photo as a character's picture: a center-cropped square JPEG, as small as it must be to stay under the 48 KB the
/// server keeps (the web's avatarDataUrl).
nonisolated enum CharacterPicture {
    enum Problem: LocalizedError {
        case unreadable, tooDetailed
        var errorDescription: String? {
            switch self {
            case .unreadable: "Couldn't read that photo."
            case .tooDetailed: "That picture is too detailed to keep small. Try another."
            }
        }
    }

    static func dataURL(from data: Data) throws -> String {
        guard let image = UIImage(data: data), image.size.width > 0, image.size.height > 0 else { throw Problem.unreadable }
        for (side, quality) in [(256.0, 0.85), (192.0, 0.8), (160.0, 0.7), (128.0, 0.6)] {
            let size = CGSize(width: side, height: side)
            // Fills the square, centered: the longer side is cut.
            let scale = max(side / image.size.width, side / image.size.height)
            let drawn = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            let square = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                image.draw(in: CGRect(x: (side - drawn.width) / 2, y: (side - drawn.height) / 2, width: drawn.width, height: drawn.height))
            }
            guard let jpeg = square.jpegData(compressionQuality: quality) else { continue }
            let url = "data:image/jpeg;base64," + jpeg.base64EncodedString()
            if url.count < Characters.maxImageURLLength { return url }
        }
        throw Problem.tooDetailed
    }
}
