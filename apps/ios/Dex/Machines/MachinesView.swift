import DexCore
import SwiftUI

/// The Machines tab: every chat's VM (and the MCP and legacy shared VMs) beside the open one's Machine page on a wide
/// screen, or pushing it on iPhone.
struct MachinesView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @State private var columns: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            MachineListView()
                .navigationSplitViewColumnWidth(min: 300, ideal: 340, max: 420)
        } detail: {
            NavigationStack {
                if let key = router.machine {
                    MachineDetailView(vmKey: key).id(key)
                } else if client.state?.vmConfigured == false {
                    ConnectBoatView()
                } else {
                    EmptyStateView(title: "No machine selected", symbol: "desktopcomputer", message: "Pick a VM to watch its desktop and what runs on it.")
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
    }
}

/// Every VM with its chat, status, and what it's doing; swipe or long-press for start, stop, refresh, and delete.
struct MachineListView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @State private var refreshing = false
    @State private var refreshedOnce = false
    @State private var pendingDelete: VmInfo?
    @State private var working: [String: String] = [:]

    private var vms: [VmInfo] { (client.state?.vms ?? []).sorted(by: VmInfo.byRecentUse) }

    var body: some View {
        @Bindable var router = router
        Group {
            if let state = client.state {
                if !state.vmConfigured {
                    ConnectBoatView()
                } else {
                    List(selection: $router.machine) {
                        Section {
                            if vms.isEmpty {
                                ContentUnavailableView("No VMs yet", systemImage: "desktopcomputer",
                                                       description: Text("Each chat gets its own VM the first time Dex needs one; project chats get theirs right away, with the repos cloned."))
                                    .accessibilityIdentifier("machines.empty")
                            }
                            ForEach(vms) { vm in
                                row(vm, state: state).tag(vm.key)
                            }
                        } footer: {
                            if !vms.isEmpty {
                                Text("A VM stops when idle and keeps its disk while stopped. It's deleted with its chat.")
                            }
                        }
                        VmDefaultsSection(settings: state.settings)
                    }
                    .refreshable { await refreshAll() }
                }
            } else {
                List { ForEach(0..<3, id: \.self) { _ in MachineRowSkeleton() } }
            }
        }
        .navigationTitle("Machines")
        .navigationSubtitle(summary)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await refreshAll() }
                } label: {
                    if refreshing { ProgressView() } else { Label("Refresh All", systemImage: "arrow.clockwise") }
                }
                .disabled(refreshing || client.state?.vmConfigured != true)
                .accessibilityIdentifier("machines.refresh")
            }
        }
        .confirmationDialog(deleteTitle, isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), titleVisibility: .visible,
                            presenting: pendingDelete) { vm in
            Button("Delete VM", role: .destructive) {
                if router.machine == vm.key { router.machine = nil }
                act(vm, "delete") { try await client.vmDestroy(vm.key) }
            }
            .accessibilityIdentifier("machines.confirmDelete")
        } message: { _ in
            Text("Everything on its disk is deleted. This can't be undone.")
        }
        // Statuses can change while the page was closed (boat's own auto-stop, for one).
        .task(id: client.isConnected) {
            guard client.isConnected, !refreshedOnce, client.state != nil else { return }
            refreshedOnce = true
            await refreshAll()
        }
    }

    private var summary: String {
        guard client.state?.vmConfigured == true, !vms.isEmpty else { return "" }
        return "\(vms.filter(\.isRunning).count) running · \(vms.count) total"
    }

    private var deleteTitle: String {
        guard let pendingDelete, let state = client.state else { return "" }
        return "Delete the VM of “\(state.vmLabel(pendingDelete.key).title)”?"
    }

    private func row(_ vm: VmInfo, state: DexState) -> some View {
        let label = state.vmLabel(vm.key)
        return MachineRow(vm: vm, label: label, minutes: state.settings.vmMinutes, working: working[vm.key])
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if vm.id != nil {
                    Button { pendingDelete = vm } label: { Label("Delete", systemImage: "trash") }
                        .tint(.red)
                }
                if vm.canStop {
                    Button { act(vm, "stop") { try await client.vmStop(vm.key) } } label: { Label("Stop", systemImage: "stop.fill") }
                        .tint(.orange)
                } else if vm.canStart {
                    Button { act(vm, "start") { try await client.vmStart(vm.key) } } label: { Label(vm.startLabel, systemImage: "play.fill") }
                        .tint(.green)
                }
            }
            .swipeActions(edge: .leading) {
                Button { act(vm, "refresh") { try await client.vmRefresh(vm.key) } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    .tint(.blue)
            }
            .contextMenu {
                if vm.canStart {
                    Button { act(vm, "start") { try await client.vmStart(vm.key) } } label: { Label(vm.startLabel, systemImage: "play") }
                }
                if vm.canStop {
                    Button { act(vm, "stop") { try await client.vmStop(vm.key) } } label: { Label("Stop", systemImage: "stop") }
                }
                Button { act(vm, "refresh") { try await client.vmRefresh(vm.key) } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                if let session = label.session {
                    Button { router.openChat(session.id) } label: { Label("Open Chat", systemImage: "bubble.left.and.text.bubble.right") }
                }
                if vm.id != nil {
                    Divider()
                    Button(role: .destructive) { pendingDelete = vm } label: { Label("Delete VM", systemImage: "trash") }
                }
            } preview: {
                MachineRow(vm: vm, label: label, minutes: state.settings.vmMinutes, working: nil)
                    .padding()
                    .frame(width: 340)
            }
    }

    private func refreshAll() async {
        refreshing = true
        defer { refreshing = false }
        let tasks = (client.state?.vms ?? []).map { vm in
            Task { _ = try? await client.vmRefresh(vm.key) }
        }
        for task in tasks { await task.value }
    }

    private func act(_ vm: VmInfo, _ name: String, _ action: @escaping () async throws -> Void) {
        let key = vm.key
        working[key] = name
        Task {
            defer { working[key] = nil }
            do { try await action() } catch { client.notice = error.localizedDescription }
        }
    }
}

/// A VM in the list: its chat's agent or project, title, status, size, when it stops or was used, and setup.
struct MachineRow: View {
    let vm: VmInfo
    let label: VmLabel
    let minutes: Int
    /// The action in flight (start, stop, …), if any.
    let working: String?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            MachineAvatar(vm: vm, label: label)
            VStack(alignment: .leading, spacing: 3) {
                Text(label.title).font(.body.weight(.medium)).lineLimit(1)
                Text(label.detail).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                TimelineView(.periodic(from: .now, by: 15)) { context in
                    HStack(spacing: 6) {
                        StatusDot(kind: StatusDot.vm(vm), size: 7)
                        Text(vm.statusLabel).foregroundStyle(.primary).layoutPriority(1)
                        if let size = vm.size { Text(size).foregroundStyle(.tertiary) }
                        if let text = vm.activityText(minutes: minutes, now: context.date.timeIntervalSince1970 * 1000) {
                            Text(text).foregroundStyle(.secondary)
                        }
                    }
                    .lineLimit(1)
                    .font(.caption)
                }
                if vm.isSettingUp {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.mini)
                        Text(vm.setupText ?? "Setting up").lineLimit(1)
                    }
                    .font(.caption)
                    .foregroundStyle(.blue)
                } else if vm.setup.status == "error" {
                    HStack(spacing: 6) {
                        Image(systemName: "wrench.and.screwdriver")
                        Text(vm.setupText ?? "Setup failed").lineLimit(1)
                    }
                    .font(.caption)
                    .foregroundStyle(.orange)
                }
                if let error = vm.error {
                    Text(error).font(.caption).foregroundStyle(.red).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            if working != nil {
                ProgressView().controlSize(.small)
            }
        }
        .padding(.vertical, 4)
        .contentShape(.rect)
        .hoverEffect(.highlight)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("machine.row.\(vm.key)")
    }
}

/// The chat's project or agent icon, else a display glyph (the MCP and shared VMs, plain chats).
struct MachineAvatar: View {
    let vm: VmInfo
    let label: VmLabel
    var size: CGFloat = 38

    var body: some View {
        if let project = label.project {
            AgentAvatar(icon: project.icon, color: project.color, image: project.image, size: size)
        } else if let agent = label.agent {
            AgentAvatar(icon: agent.icon, color: agent.color, size: size)
        } else {
            Image(systemName: vm.key == VmKeys.mcp ? "point.3.connected.trianglepath.dotted" : "display")
                .font(.system(size: size * 0.42, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: size, height: size)
                .background(.quaternary.opacity(0.6), in: .rect(cornerRadius: size * 0.28, style: .continuous))
                .accessibilityHidden(true)
        }
    }
}

/// The size and idle timeout new VMs get (also in Settings › Cloud VMs).
struct VmDefaultsSection: View {
    @Environment(DexClient.self) private var client
    let settings: DexSettings

    var body: some View {
        Section {
            Picker("Size", selection: Binding(get: { settings.vmSize }, set: { size in
                client.perform { try await client.run("updateSettings", ["vmSize": .string(size)]) }
            })) {
                ForEach(VmSizes.all, id: \.id) { size in Text(size.label).tag(size.id) }
            }
            .accessibilityIdentifier("machines.defaultSize")
            Picker("Stop When Idle For", selection: Binding(get: { settings.vmMinutes }, set: { minutes in
                client.perform { try await client.run("updateSettings", ["vmMinutes": .number(Double(minutes))]) }
            })) {
                ForEach([5, 10, 15, 30, 60], id: \.self) { minutes in Text("\(minutes) min").tag(minutes) }
            }
            .accessibilityIdentifier("machines.idleMinutes")
        } header: {
            Text("VM Defaults")
        } footer: {
            Text("For new VMs. Projects can pick their own size.")
        }
    }
}

struct MachineRowSkeleton: View {
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 10, style: .continuous).fill(.quaternary).frame(width: 38, height: 38)
            VStack(alignment: .leading, spacing: 4) {
                LineBone(width: 180)
                LineBone(width: 110, font: .footnote)
                LineBone(width: 150, font: .caption)
            }
        }
        .padding(.vertical, 4)
    }
}
