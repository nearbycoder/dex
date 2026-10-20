import DexCore
import SwiftUI

/// Notifications on this device (local ones, chosen here and kept on the device), the browsers and Home Screen apps
/// registered for Web Push, and muted chats.
struct NotificationsPage: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @State private var preferences = NotificationPreferences.shared
    @State private var message: (tone: InlineMessage.Tone, text: String)?

    var body: some View {
        if let state = client.state {
            let muted = state.sessions.filter(\.muted)
            Form {
                Section {
                    Toggle(isOn: Binding(get: { preferences.enabled }, set: { on in Task { await turn(on) } })) {
                        Label("Notifications", systemImage: "bell.badge")
                    }
                    .accessibilityIdentifier("notify.enabled")
                    if preferences.isDenied {
                        Label("Notifications are off for Dex in iOS Settings.", systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                        Button("Open iOS Settings") {
                            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
                        }
                    }
                } header: {
                    Text("This Device")
                } footer: {
                    Text("Dex lets you know when a reply finishes, a reply fails, or something needs you, while the app is open or running in the background. When the app is closed, nothing arrives yet: that needs the server to send Apple push notifications, which it doesn't do yet.")
                }

                if preferences.enabled {
                    Section {
                        ForEach(NotifyKinds.all, id: \.id) { kind in
                            Toggle(isOn: Binding(get: { preferences.kinds.contains(kind.id) }, set: { preferences.setKind(kind.id, on: $0) })) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(kind.label)
                                    Text(kind.description).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .accessibilityIdentifier("notify.kind.\(kind.id)")
                        }
                        Toggle(isOn: $preferences.onlyWhenAway) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Skip what I'm looking at")
                                Text("No notification for the chat open on screen.").font(.caption).foregroundStyle(.secondary)
                            }
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

                if let message {
                    Section { InlineMessage(tone: message.tone, text: message.text) }
                }

                Section {
                    if !state.push.configured {
                        Text("This deployment has no push keys (VAPID) set up, so browsers can't get notifications.")
                            .foregroundStyle(.secondary)
                    } else if state.push.devices.isEmpty {
                        Text("No browsers or Home Screen apps get notifications. Turn them on in Dex on the web.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(state.push.devices) { device in
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
                    Text("Web Push Devices")
                } footer: {
                    if state.push.configured { Text("Browsers and Home Screen apps signed in to Dex on the web. Each has its own choices. Remove one to stop notifications there.") }
                }

                if !muted.isEmpty {
                    Section {
                        ForEach(muted) { session in
                            HStack {
                                Button {
                                    router.openChat(session.id)
                                } label: {
                                    Label(session.title, systemImage: "bell.slash").lineLimit(1)
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
            .navigationTitle("Notifications")
            .task { await preferences.refresh() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await preferences.refresh() } }
            }
        } else {
            FormSkeleton().navigationTitle("Notifications")
        }
    }

    private func turn(_ on: Bool) async {
        message = nil
        let result = await preferences.setEnabled(on)
        if on, !result {
            message = (.error, "Notifications are off for Dex. Turn them on in iOS Settings → Notifications → Dex.")
        }
    }
}

private struct PushDeviceRow: View {
    let device: PushDevice

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: device.label.hasPrefix("iPhone") ? "iphone" : device.label.hasPrefix("iPad") ? "ipad" : device.label.hasPrefix("Android") ? "smartphone" : "laptopcomputer")
                .foregroundStyle(.secondary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(device.label)
                HStack(spacing: 0) {
                    Text("\(device.kinds.count)/\(NotifyKinds.all.count) kinds · \(device.lastSentAt.map { "sent \(Format.ago($0))" } ?? "nothing sent yet")")
                    if device.error != nil { Text(" · last delivery failed").foregroundStyle(.orange) }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
        }
    }
}

/// One Web Push device: what it's notified about, a test, and removing it.
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
                            VStack(alignment: .leading, spacing: 2) {
                                Text(kind.label)
                                Text(kind.description).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityIdentifier("push.kind.\(kind.id)")
                    }
                    Toggle(isOn: Binding(get: { device.onlyWhenAway }, set: { update(device, ["onlyWhenAway": .bool($0)]) })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Skip what I'm looking at")
                            Text("No notification for a chat that's open and visible on any of your devices.").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("push.onlyWhenAway")
                } header: {
                    Text("Notify About")
                } footer: {
                    Text("Added \(Format.date(device.createdAt))\(device.lastSentAt.map { " · last sent \(Format.ago($0))" } ?? "")")
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
