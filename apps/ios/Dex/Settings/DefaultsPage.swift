import DexCore
import SwiftUI

/// Defaults for new chats (model, thinking, custom instructions), the agent's memory, and scheduled prompts (the web's
/// Settings page has them together).
struct DefaultsPage: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @State private var picking = false
    @State private var instructions = ""
    @State private var loaded = false
    @State private var saved = false
    @State private var schedules: [ScheduledPrompt]?
    @State private var scheduleError: String?
    @FocusState private var editing: Bool

    var body: some View {
        if let state = client.state {
            Form {
                Section {
                    Button {
                        picking = true
                    } label: {
                        HStack(spacing: 12) {
                            MakerLogo(maker: client.catalog.model(state.settings.defaultModel)?.maker ?? "", size: 24)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(client.catalog.name(of: state.settings.defaultModel)).foregroundStyle(.primary)
                                Text("\(ModelCatalog.providerName(client.catalog.provider(of: state.settings.defaultModel))) · thinking \(ThinkingLevels.label(state.settings.defaultThinking).lowercased())")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.up.chevron.down").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("defaults.model")
                } header: {
                    Text("Model")
                } footer: {
                    Text("Defaults for chats you start. Each chat can change its model and thinking level.")
                }

                Section {
                    TextEditor(text: $instructions)
                        .frame(minHeight: 140)
                        .focused($editing)
                        .overlay(alignment: .topLeading) {
                            if instructions.isEmpty {
                                Text("e.g. I'm a TypeScript developer in Chicago. Be concise. Prefer tables for comparisons.")
                                    .foregroundStyle(.tertiary)
                                    .padding(.top, 8)
                                    .padding(.leading, 5)
                                    .allowsHitTesting(false)
                            }
                        }
                        .accessibilityIdentifier("defaults.instructions")
                    if instructions != state.settings.instructions || saved {
                        HStack {
                            AsyncButton(action: { try await save() }) {
                                Text("Save Instructions")
                            }
                            .buttonStyle(.glassProminent)
                            .disabled(instructions == state.settings.instructions)
                            .keyboardShortcut("s", modifiers: .command)
                            .accessibilityIdentifier("defaults.save")
                            if saved && instructions == state.settings.instructions {
                                Label("Saved", systemImage: "checkmark").foregroundStyle(.green).font(.subheadline)
                            }
                        }
                    }
                } header: {
                    Text("Custom Instructions")
                } footer: {
                    Text("Added to the system prompt of every chat.")
                }

                Section {
                    Button {
                        router.openFile(Workspace.memory)
                    } label: {
                        Label("Open MEMORY.md", systemImage: "brain")
                    }
                    .accessibilityIdentifier("defaults.memory")
                } header: {
                    Text("Memory")
                } footer: {
                    Text("Dex's long-term memory, a file in its workspace added to every chat. Edit it like any file.")
                }

                Section {
                    if let schedules {
                        if schedules.isEmpty {
                            Text("Nothing scheduled.").foregroundStyle(.secondary)
                        }
                        ForEach(schedules) { schedule in
                            ScheduleRow(schedule: schedule)
                                .swipeActions {
                                    Button("Cancel", systemImage: "trash", role: .destructive) { cancel(schedule) }
                                }
                                .contextMenu {
                                    Button("Cancel Scheduled Prompt", systemImage: "trash", role: .destructive) { cancel(schedule) }
                                }
                        }
                    } else if let scheduleError {
                        Text(scheduleError).foregroundStyle(.red).font(.footnote)
                    } else {
                        LineBone(width: 220)
                        LineBone(width: 160)
                    }
                } header: {
                    Text("Scheduled Prompts")
                } footer: {
                    Text("Things Dex will do later. Ask Dex in any chat to schedule something.")
                }
            }
            .navigationTitle("Defaults & Instructions")
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                if editing {
                    ToolbarItem(placement: .keyboard) {
                        HStack { Spacer(); Button("Done") { editing = false } }
                    }
                }
            }
            .sheet(isPresented: $picking) {
                ModelPickerSheet(model: state.settings.defaultModel, thinking: state.settings.defaultThinking) { model, thinking in
                    var patch: [String: JSONValue] = [:]
                    if let model { patch["defaultModel"] = .string(model) }
                    if let thinking { patch["defaultThinking"] = .string(thinking) }
                    client.perform { try await client.run("updateSettings", .object(patch)) }
                }
                .presentationDetents([.medium, .large])
            }
            .onAppear {
                guard !loaded else { return }
                loaded = true
                instructions = state.settings.instructions
            }
            .onChange(of: state.settings.instructions) { old, new in
                // Changed elsewhere while you weren't editing here.
                if instructions == old { instructions = new }
            }
            .onChange(of: instructions) { saved = false }
            .task(id: client.isConnected) { await loadSchedules() }
            .refreshable { await loadSchedules() }
        } else {
            FormSkeleton().navigationTitle("Defaults & Instructions")
        }
    }

    private func save() async throws {
        try await client.run("updateSettings", ["instructions": .string(instructions)])
        saved = true
    }

    private func loadSchedules() async {
        guard client.isConnected else { return }
        do {
            schedules = try await client.call("listScheduledPrompts", as: [ScheduledPrompt].self)
            scheduleError = nil
        } catch {
            if schedules == nil { scheduleError = error.localizedDescription }
        }
    }

    private func cancel(_ schedule: ScheduledPrompt) {
        withAnimation { schedules?.removeAll { $0.id == schedule.id } }
        client.perform {
            try await client.run("cancelScheduledPrompt", .string(schedule.id))
            await loadSchedules()
        }
    }
}

private struct ScheduleRow: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let schedule: ScheduledPrompt

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: schedule.cron == nil ? "clock" : "repeat")
                .foregroundStyle(.secondary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(schedule.prompt)
                HStack(spacing: 4) {
                    if let cron = schedule.cron { Text("\(cron) · next") }
                    if let date = schedule.date { Text(date, format: .dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute()) }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                if let id = schedule.sessionId, let session = client.state?.session(id) {
                    Button("In “\(session.title)”") { router.openChat(id) }
                        .font(.caption)
                        .buttonStyle(.borderless)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("schedule.\(schedule.id)")
    }
}
