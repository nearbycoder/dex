import DexCore
import SwiftUI

/// Notifications: this device (push through APNs when its Dex can, with what it's notified about and a test; local
/// notifications while the app runs when it can't), each sidekick's own setting, your other devices, and muted chats.
struct NotificationsPage: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @State private var preferences = NotificationPreferences.shared
    @State private var push = PushRegistration.shared
    @State private var message: (tone: InlineMessage.Tone, text: String)?
    @State private var testing = false

    /// The Settings row's "On" or "Off".
    static func summary(_ client: DexClient) -> String? {
        guard let state = client.state else { return nil }
        if state.push.native.ios { return PushRegistration.shared.wanted && Notifications.shared.authorized ? "On" : "Off" }
        return NotificationPreferences.shared.enabled ? "On" : "Off"
    }

    private var model: String { UIDevice.current.model }

    var body: some View {
        if let state = client.state {
            let mine = push.deviceId(client)
            let others = state.push.devices.filter { $0.id != mine }
            Form {
                if state.push.native.ios {
                    pushSections(state)
                } else {
                    localSections
                }

                if let message {
                    Section { InlineMessage(tone: message.tone, text: message.text) }
                }

                if !state.characters.isEmpty {
                    Section {
                        ForEach(state.characters) { character in
                            SidekickNotifyPicker(character: character)
                        }
                    } header: {
                        Text("Sidekicks")
                    } footer: {
                        Text("Which of each sidekick's messages notify you: all of them, only the ones they start themselves (check-ins and reminders), or none. Their messages show as unread either way.")
                    }
                }

                Section {
                    if others.isEmpty {
                        Text(state.push.configured ? "No other devices get notifications. Turn them on in Dex on the web, or in the Android app." : "No other devices get notifications.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(others) { device in
                        NavigationLink {
                            PushDevicePage(deviceId: device.id)
                        } label: {
                            PushDeviceRow(device: device)
                        }
                        .swipeActions {
                            Button("Remove", systemImage: "trash") {
                                client.perform { try await client.run("pushUnsubscribe", .string(device.id)) }
                            }
                            .tint(.red)
                        }
                        .accessibilityIdentifier("push.\(device.id)")
                    }
                } header: {
                    Text("Other Devices")
                } footer: {
                    if state.push.configured {
                        Text("Browsers, Home Screen apps, and your other phones and tablets signed in to this Dex. Each has its own choices. Remove one to stop notifications there.")
                    } else {
                        Text("This deployment has no Web Push keys (VAPID), so browsers can't get notifications.")
                    }
                }

                mutedSection(state)
            }
            .navigationTitle("Notifications")
            .task { await refresh() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await refresh() } }
            }
        } else {
            FormSkeleton().navigationTitle("Notifications")
        }
    }

    private func refresh() async {
        await preferences.refresh()
        await Notifications.shared.refreshAuthorization()
    }

    // MARK: This device, with push

    @ViewBuilder
    private func pushSections(_ state: DexState) -> some View {
        let device = push.device(client)
        let on = push.wanted && preferences.isAuthorized
        Section {
            Toggle(isOn: Binding(get: { on }, set: { value in Task { await turnPush(value) } })) {
                Label("Notifications", systemImage: "bell.badge")
            }
            .accessibilityIdentifier("notify.enabled")
            if preferences.isDenied {
                deniedNote
            } else if on {
                if let device {
                    LabeledContent {
                        Text(device.lastSentAt.map { "Sent \(Format.ago($0))" } ?? "Nothing sent yet").font(.subheadline)
                    } label: {
                        Label("Push is on", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("notify.registered")
                    if let error = device.error { InlineMessage(tone: .warning, text: "Last delivery failed: \(error)") }
                } else if let problem = push.problem, !push.registering {
                    InlineMessage(tone: .error, text: "Couldn't turn on push: \(problem)")
                    Button("Try Again") { Task { await push.setWanted(true, client: client) } }
                        .accessibilityIdentifier("notify.retry")
                } else {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Setting up push on this \(model)…").foregroundStyle(.secondary)
                    }
                    .accessibilityIdentifier("notify.registering")
                }
            }
        } header: {
            Text("This \(model)")
        } footer: {
            Text("Dex lets you know when a sidekick messages you, a reply finishes or fails, or something needs you, even when the app is closed. It stays quiet about the chat you're looking at.")
        }

        if on, let device {
            Section {
                ForEach(NotifyKinds.all, id: \.id) { kind in
                    Toggle(isOn: Binding(get: { device.kinds.contains(kind.id) }, set: { value in
                        client.perform { try await client.run("pushUpdate", .string(device.id), ["kinds": .array(device.kinds(setting: kind.id, on: value).map(JSONValue.string))]) }
                    })) {
                        KindLabel(title: kind.label, detail: kind.description)
                    }
                    .accessibilityIdentifier("notify.kind.\(kind.id)")
                }
                Toggle(isOn: Binding(get: { device.onlyWhenAway }, set: { value in
                    client.perform { try await client.run("pushUpdate", .string(device.id), ["onlyWhenAway": .bool(value)]) }
                })) {
                    KindLabel(title: "Only when I'm away", detail: "Nothing while Dex is open and showing that chat on any of your devices.")
                }
                .accessibilityIdentifier("notify.onlyWhenAway")
                Button {
                    Task { await test(device) }
                } label: {
                    HStack {
                        Label("Send a Test", systemImage: "paperplane")
                        if testing { Spacer(); ProgressView() }
                    }
                }
                .disabled(testing)
                .accessibilityIdentifier("notify.test")
            } header: {
                Text("Notify Me About")
            }
        }
    }

    private func turnPush(_ on: Bool) async {
        message = nil
        if on, preferences.authorization == .notDetermined { _ = await Notifications.shared.requestPermission() }
        await preferences.refresh()
        if on, !preferences.isAuthorized {
            message = (.error, "Notifications are off for Dex. Turn them on in iOS Settings → Notifications → Dex.")
            return
        }
        await push.setWanted(on, client: client)
    }

    private func test(_ device: PushDevice) async {
        testing = true
        defer { testing = false }
        do {
            let error: String? = try await client.call("pushTest", .string(device.id), timeout: 30)
            message = error.map { (.error, $0) } ?? (.ok, "Sent. It should arrive in a few seconds.")
        } catch {
            message = (.error, error.localizedDescription)
        }
    }

    // MARK: This device, without push

    /// Local notifications, chosen here and kept on the device, while the app runs.
    @ViewBuilder
    private var localSections: some View {
        Section {
            Toggle(isOn: Binding(get: { preferences.enabled }, set: { on in Task { await turnLocal(on) } })) {
                Label("Notifications", systemImage: "bell.badge")
            }
            .accessibilityIdentifier("notify.enabled")
            if preferences.isDenied { deniedNote }
        } header: {
            Text("This \(model)")
        } footer: {
            Text("Dex lets you know when a sidekick messages you, a reply finishes or fails, or something needs you, while the app is open or running in the background. This Dex can't reach the app when it's closed: that needs Apple push keys (APNs) on the server.")
        }

        if preferences.enabled {
            Section {
                ForEach(NotifyKinds.all, id: \.id) { kind in
                    Toggle(isOn: Binding(get: { preferences.kinds.contains(kind.id) }, set: { preferences.setKind(kind.id, on: $0) })) {
                        KindLabel(title: kind.label, detail: kind.description)
                    }
                    .accessibilityIdentifier("notify.kind.\(kind.id)")
                }
                Toggle(isOn: $preferences.onlyWhenAway) {
                    KindLabel(title: "Only when I'm away", detail: "No notification for the chat open on screen.")
                }
                .accessibilityIdentifier("notify.onlyWhenAway")
                Button("Send a Test", systemImage: "paperplane") {
                    preferences.sendTest()
                    message = (.ok, "Sent. It should arrive in a moment.")
                }
                .accessibilityIdentifier("notify.test")
            } header: {
                Text("Notify Me About")
            }
        }
    }

    private func turnLocal(_ on: Bool) async {
        message = nil
        let result = await preferences.setEnabled(on)
        if on, !result {
            message = (.error, "Notifications are off for Dex. Turn them on in iOS Settings → Notifications → Dex.")
        }
    }

    // MARK: Shared

    @ViewBuilder
    private var deniedNote: some View {
        Label("Notifications are off for Dex in iOS Settings.", systemImage: "exclamationmark.triangle.fill")
            .font(.footnote)
            .foregroundStyle(.orange)
        Button("Open iOS Settings") {
            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
        }
    }

    @ViewBuilder
    private func mutedSection(_ state: DexState) -> some View {
        let muted = state.sessions.filter(\.muted)
        if !muted.isEmpty {
            Section {
                ForEach(muted) { session in
                    HStack {
                        Button {
                            router.openChat(session.id)
                        } label: {
                            Label(state.character(session.characterId)?.name ?? session.title, systemImage: "bell.slash").lineLimit(1)
                        }
                        .buttonStyle(.plain)
                        Spacer()
                        Button("Unmute") {
                            client.perform { try await client.run("setSessionMuted", .string(session.id), false) }
                        }
                        .buttonStyle(.borderless)
                        .accessibilityIdentifier("muted.unmute.\(session.id)")
                    }
                }
            } header: {
                Text("Muted Chats")
            } footer: {
                Text("No notifications from these. Mute or unmute a chat from its menu.")
            }
        }
    }
}

/// A kind of notification: its name and what it's about.
private struct KindLabel: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
            Text(detail).font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// Which of a sidekick's messages notify you, as a menu beside their face and name.
struct SidekickNotifyPicker: View {
    @Environment(DexClient.self) private var client
    let character: CharacterProfile

    var body: some View {
        Picker(selection: Binding(get: { character.notifyLevel }, set: { level in
            client.perform { try await client.setCharacterNotify(character, level) }
        })) {
            ForEach(SidekickNotify.allCases) { level in
                Text(level.label).tag(level)
            }
        } label: {
            HStack(spacing: 10) {
                CharacterAvatar(character, size: 28)
                Text(character.name).lineLimit(1)
            }
        }
        .pickerStyle(.menu)
        .accessibilityIdentifier("notify.sidekick.\(character.id)")
    }
}

private struct PushDeviceRow: View {
    let device: PushDevice

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: Self.symbol(device))
                .foregroundStyle(.secondary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(device.label)
                // A failed delivery gets its own line, so neither is cut short on a narrow phone.
                Text("\(Self.kind(device)) · \(device.kinds.count)/\(NotifyKinds.all.count) kinds · \(device.lastSentAt.map { "sent \(Format.ago($0))" } ?? "nothing sent yet")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if device.error != nil {
                    Text("Last delivery failed").font(.caption).foregroundStyle(.orange)
                }
            }
        }
    }

    static func symbol(_ device: PushDevice) -> String {
        switch device.platform {
        case "ios": device.label.localizedCaseInsensitiveContains("iPad") ? "ipad" : "iphone"
        case "android": "smartphone"
        default: device.label.hasPrefix("iPhone") ? "iphone" : device.label.hasPrefix("iPad") ? "ipad" : device.label.hasPrefix("Android") ? "smartphone" : "laptopcomputer"
        }
    }

    static func kind(_ device: PushDevice) -> String {
        switch device.platform {
        case "ios": "iOS app"
        case "android": "Android app"
        default: "Web"
        }
    }
}

/// One other device: what it's notified about, a test, and removing it.
private struct PushDevicePage: View {
    @Environment(DexClient.self) private var client
    @Environment(\.dismiss) private var dismiss
    let deviceId: String
    @State private var testing = false
    @State private var message: (tone: InlineMessage.Tone, text: String)?
    @State private var confirmRemove = false

    var body: some View {
        if let device = client.state?.push.devices.first(where: { $0.id == deviceId }) {
            Form {
                Section {
                    ForEach(NotifyKinds.all, id: \.id) { kind in
                        Toggle(isOn: Binding(get: { device.kinds.contains(kind.id) }, set: { on in
                            update(device, .object(["kinds": .array(device.kinds(setting: kind.id, on: on).map(JSONValue.string))]))
                        })) {
                            KindLabel(title: kind.label, detail: kind.description)
                        }
                        .accessibilityIdentifier("push.kind.\(kind.id)")
                    }
                    Toggle(isOn: Binding(get: { device.onlyWhenAway }, set: { update(device, ["onlyWhenAway": .bool($0)]) })) {
                        KindLabel(title: "Only when I'm away", detail: "No notification for a chat that's open and visible on any of your devices.")
                    }
                    .accessibilityIdentifier("push.onlyWhenAway")
                } header: {
                    Text("Notify About")
                } footer: {
                    Text("\(PushDeviceRow.kind(device)) · added \(Format.date(device.createdAt))\(device.lastSentAt.map { " · last sent \(Format.ago($0))" } ?? "")")
                }
                Section {
                    Button {
                        Task { await test(device) }
                    } label: {
                        HStack {
                            Label("Send a Test", systemImage: "paperplane")
                            if testing { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(testing)
                    .accessibilityIdentifier("push.test")
                    if let message { InlineMessage(tone: message.tone, text: message.text) }
                    if let error = device.error, message == nil {
                        InlineMessage(tone: .warning, text: "Last delivery failed: \(error)")
                    }
                }
                Section {
                    Button("Remove Device", role: .destructive) { confirmRemove = true }
                        .accessibilityIdentifier("push.remove")
                }
            }
            .navigationTitle(device.label)
            .navigationBarTitleDisplayMode(.inline)
            .confirmationDialog("Stop notifications on \(device.label)?", isPresented: $confirmRemove, titleVisibility: .visible) {
                Button("Remove", role: .destructive) {
                    client.perform {
                        try await client.run("pushUnsubscribe", .string(device.id))
                        dismiss()
                    }
                }
            }
        } else {
            ContentUnavailableView("Device Removed", systemImage: "bell.slash")
        }
    }

    private func update(_ device: PushDevice, _ patch: JSONValue) {
        client.perform { try await client.run("pushUpdate", .string(device.id), patch) }
    }

    private func test(_ device: PushDevice) async {
        testing = true
        defer { testing = false }
        do {
            let error: String? = try await client.call("pushTest", .string(device.id), timeout: 30)
            message = error.map { (.error, $0) } ?? (.ok, "Sent. It should arrive in a few seconds.")
        } catch {
            message = (.error, error.localizedDescription)
        }
    }
}
