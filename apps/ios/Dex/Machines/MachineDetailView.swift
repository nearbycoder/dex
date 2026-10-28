import DexCore
import SwiftUI

/// One VM (the Machine page): its live desktop, activity log, your own commands, ports, and looks inside. On a wide
/// screen the log runs beside the desktop; on a short, wide one (a phone or an iPad in landscape) the panels sit beside
/// the desktop; otherwise the desktop sits on top with the panels below it. The desktop always keeps its full width.
struct MachineDetailView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    let vmKey: String

    enum Panel: String, CaseIterable, Identifiable {
        case activity, inspect, ports
        var id: String { rawValue }
        var title: String {
            switch self {
            case .activity: "Activity"
            case .inspect: "Inspect"
            case .ports: "Ports"
            }
        }
    }

    @State private var feed: MachineFeed?
    @State private var control = false
    @AppStorage("dex.desktopMode") private var modeRaw = DesktopMode.selkies.rawValue
    @State private var reconnect = 0
    @State private var panel: Panel = .activity
    @State private var confirmDelete = false
    @State private var fullScreen = false
    @State private var port = ""
    @State private var exposed: PortsView.ExposedPort?
    @State private var busy: String?
    @State private var size: CGSize = .zero
    /// The software keyboard is up (a command or a port being typed): the desktop gives up its room to the field.
    @State private var keyboard = false
    @FocusState private var commandFocused: Bool

    private var mode: DesktopMode { DesktopMode(saved: modeRaw) }
    private var width: CGFloat { size.width }
    /// Room for the log beside the desktop.
    private var wide: Bool { width >= 900 }
    /// Wider than tall (a phone or an iPad in landscape): the panels go beside the desktop, which would otherwise be
    /// squeezed between the header and the panels.
    /// Needs room for both: a narrower pane (a big phone in landscape, beside the list) stacks them instead.
    private var sideBySide: Bool { !wide && width >= 520 && (verticalSizeClass == .compact || (size.height > 0 && width > size.height * 1.1)) }
    /// The panels' width beside the desktop: the desktop keeps the larger share.
    private var sideWidth: CGFloat { min(440, max(260, width * 0.42)) }

    var body: some View {
        Group {
            if let state = client.state {
                if !state.vmConfigured {
                    ConnectBoatView()
                } else if let vm = state.machine(vmKey) {
                    content(vm, label: state.vmLabel(vmKey), minutes: state.settings.vmMinutes)
                } else {
                    EmptyStateView(title: "This VM no longer exists", symbol: "display.trianglebadge.exclamationmark", message: "Its chat may have been deleted.",
                                   actionTitle: "See All Machines") { router.machine = nil }
                }
            } else {
                MachineSkeleton()
            }
        }
        .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboard = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboard = false }
        .onAppear {
            if feed == nil { feed = MachineFeed(vmKey: vmKey, client: client) }
            feed?.start()
            // Statuses change while nobody watches (boat's own auto-stop, for one).
            if client.state?.vm(vmKey) != nil { client.perform { [client, vmKey] in try await client.vmRefresh(vmKey) } }
        }
        .onDisappear { feed?.stop() }
    }

    // MARK: Layout

    @ViewBuilder
    private func content(_ vm: VmInfo, label: VmLabel, minutes: Int) -> some View {
        Group {
            if wide {
                HStack(alignment: .top, spacing: 16) {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            header(vm, label: label)
                            desktopCard(vm)
                            // Side by side when the column has room for both, else one above the other.
                            let column = width - min(440, max(340, width * 0.34)) - 56
                            let tools = column >= 680 ? AnyLayout(HStackLayout(alignment: .top, spacing: 16)) : AnyLayout(VStackLayout(spacing: 16))
                            tools {
                                card("Inspect", symbol: "magnifyingglass") { inspect(vm) }
                                card("Open a Port", symbol: "network") { ports(vm) }
                                    .frame(maxWidth: column >= 680 ? 360 : .infinity)
                            }
                        }
                        .padding([.leading, .vertical], 20)
                    }
                    .refreshable { await refresh(vm) }
                    card("Activity", symbol: "terminal", padded: false) { activity(vm) }
                        .frame(width: min(440, max(340, width * 0.34)))
                        .padding([.trailing, .vertical], 20)
                }
            } else if sideBySide {
                HStack(alignment: .top, spacing: 0) {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 10) {
                            header(vm, label: label)
                            desktopCard(vm)
                        }
                        .padding(.leading, 16)
                        .padding(.vertical, 8)
                    }
                    .refreshable { await refresh(vm) }
                    panels(vm)
                        .frame(width: sideWidth)
                }
            } else {
                VStack(spacing: 0) {
                    VStack(alignment: .leading, spacing: 10) {
                        header(vm, label: label)
                        desktopCard(vm)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    // The desktop takes its full width first, so the panels below never squeeze it (except to make
                    // room for the keyboard while you type).
                    .layoutPriority(keyboard ? 0 : 1)
                    panels(vm)
                }
            }
        }
        .navigationTitle(label.title)
        .navigationSubtitle(statusLine(vm, minutes: minutes))
        .navigationBarTitleDisplayMode(.inline)
        // A landscape phone has little height to spare: the desktop gets the tab bar's room too.
        .toolbarVisibility(sizeClass == .compact && verticalSizeClass == .compact ? .hidden : .automatic, for: .tabBar)
        .toolbar { toolbar(vm, label: label) }
        .background(alignment: .topLeading) { shortcuts(vm) }
        .confirmationDialog("Delete the VM of “\(label.title)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete VM", role: .destructive) {
                act("delete") { try await client.vmDestroy(vm.key) }
            }
            .accessibilityIdentifier("machine.confirmDelete")
        } message: {
            Text("Everything on its disk is deleted. This can't be undone.")
        }
        .fullScreenCover(isPresented: $fullScreen) {
            FullScreenDesktop(vm: client.state?.vm(vm.key) ?? vm, mode: mode, control: $control)
                .environment(client)
        }
        .task(id: control && vm.isRunning) {
            // Using the desktop counts as activity, so the VM doesn't idle-stop under you.
            guard control, vm.isRunning else { return }
            while !Task.isCancelled {
                try? await client.vmTouch(vm.key)
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .onChange(of: vm.isRunning) { _, running in if !running { control = false } }
        .sensoryFeedback(.selection, trigger: control)
    }

    private func card<Content: View>(_ title: String, symbol: String, padded: Bool = true, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            if padded {
                content().padding([.horizontal, .bottom], 16)
            } else {
                Divider()
                content()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: .rect(cornerRadius: 22, style: .continuous))
    }

    // MARK: Header

    /// The chat it belongs to, the agent at work (with Stop), and setup progress or failure.
    @ViewBuilder
    private func header(_ vm: VmInfo, label: VmLabel) -> some View {
        let compact = sizeClass == .compact
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    HStack(spacing: 6) {
                        StatusDot(kind: StatusDot.vm(vm))
                        Text(vm.statusLabel)
                        if let size = vm.size { Text("· \(size)").foregroundStyle(.secondary) }
                    }
                    .font(.footnote)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("machine.status")
                    if let project = label.project {
                        Button {
                            router.open(.project(project.id), compact: compact)
                        } label: {
                            HStack(spacing: 5) {
                                AgentAvatar(icon: project.icon, color: project.color, image: project.image, size: 18)
                                Text(project.name)
                            }
                        }
                        .buttonStyle(.bordered)
                    } else if let agent = label.agent {
                        HStack(spacing: 5) {
                            AgentAvatar(icon: agent.icon, color: agent.color, size: 18)
                            Text(agent.name)
                        }
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    }
                    if let session = label.session {
                        Button {
                            router.openChat(session.id)
                        } label: { Label("Open Chat", systemImage: "bubble.left.and.text.bubble.right") }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("machine.openChat")
                        if session.busy {
                            AsyncButton(action: { try await client.run("abort", .string(session.id)) }) {
                                Label("Stop Dex", systemImage: "stop.fill")
                            }
                            .buttonStyle(.bordered)
                            .tint(.red)
                            .accessibilityIdentifier("machine.stopAgent")
                        }
                    }
                }
                .controlSize(.small)
                .font(.footnote)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()

            if let subtitle = label.subtitle {
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            if vm.isSettingUp {
                HStack(spacing: 10) {
                    ProgressView().controlSize(.small)
                    Text("\(vm.setupText ?? "Setting up")…").font(.footnote)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.blue.opacity(0.1), in: .rect(cornerRadius: 14))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("machine.setup")
            } else if vm.setup.status == "error" {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "wrench.and.screwdriver").foregroundStyle(.orange)
                    Text("\(vm.setupText ?? "Setup failed"): \(vm.setup.error ?? "")")
                        .font(.footnote)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        act("setup") { try await client.vmRerunSetup(vm.key) }
                    } label: {
                        if busy == "setup" { ProgressView().controlSize(.small) } else { Text("Re-run Setup") }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .tint(.orange)
                    .accessibilityIdentifier("machine.rerunSetup")
                }
                .padding(12)
                .background(.orange.opacity(0.1), in: .rect(cornerRadius: 14))
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("machine.setupError")
            }
            if let error = vm.error {
                Label(error, systemImage: "exclamationmark.octagon")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.red.opacity(0.08), in: .rect(cornerRadius: 12))
                    .accessibilityIdentifier("machine.error")
            }
        }
    }

    /// The subtitle. On a phone the header right below already shows the status and size, so it says only when the VM
    /// stops.
    private func statusLine(_ vm: VmInfo, minutes: Int) -> String {
        if sizeClass == .compact { return vm.isRunning ? vm.idleText(minutes: minutes) : "" }
        var parts = [vm.statusLabel]
        if let size = vm.size { parts.append(size) }
        if vm.isRunning { parts.append(vm.idleText(minutes: minutes)) }
        return parts.joined(separator: " · ")
    }

    // MARK: Desktop

    private func desktopCard(_ vm: VmInfo) -> some View {
        VStack(spacing: 0) {
            ZStack {
                if fullScreen {
                    Color.black
                    Label("Showing full screen", systemImage: "arrow.up.left.and.arrow.down.right").font(.footnote).foregroundStyle(.white.opacity(0.7))
                } else {
                    DesktopSurface(vm: vm, mode: mode, interactive: control, reconnect: reconnect)
                }
                if vm.isRunning, !control, !fullScreen {
                    // View-only, so you don't disturb the agent; a tap takes over.
                    Color.clear
                        .contentShape(.rect)
                        .onTapGesture { control = true }
                        .overlay(alignment: .bottom) {
                            Label("Watching · Tap to take control", systemImage: "eye")
                                .font(.caption.weight(.medium))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .glassEffect(.regular, in: .capsule)
                                .padding(.bottom, 10)
                        }
                        .accessibilityElement()
                        .accessibilityLabel("Take control of the desktop")
                        .accessibilityAddTraits(.isButton)
                        .accessibilityIdentifier("machine.desktop.watching")
                }
            }
            .aspectRatio(16 / 9, contentMode: .fit)
            .clipShape(.rect(cornerRadius: 18, style: .continuous))
            if vm.isRunning { desktopControls(vm).padding(.top, 8) }
        }
        .frame(maxWidth: .infinity)
    }

    private func desktopControls(_ vm: VmInfo) -> some View {
        GlassEffectContainer(spacing: 8) {
            HStack(spacing: 8) {
                Button {
                    control.toggle()
                } label: {
                    Label(control ? "You Have Control" : "Take Control", systemImage: control ? "hand.raised.fill" : "eye")
                        .labelStyle(.titleAndIcon)
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.glass)
                .tint(control ? .blue : nil)
                .accessibilityIdentifier("machine.control")
                Spacer()
                Menu {
                    Picker("Streaming Mode", selection: $modeRaw) {
                        ForEach(DesktopMode.allCases) { mode in
                            Text(mode.playsInWebKit ? mode.title : "\(mode.title) (Chrome only)").tag(mode.rawValue)
                        }
                    }
                } label: {
                    Label(mode.title, systemImage: "play.display").font(.caption.weight(.semibold))
                }
                .buttonStyle(.glass)
                .accessibilityIdentifier("machine.mode")
                Button {
                    reconnect += 1
                } label: {
                    Image(systemName: "arrow.triangle.2.circlepath").font(.caption.weight(.semibold))
                }
                .buttonStyle(.glass)
                .accessibilityLabel("Reconnect")
                .accessibilityIdentifier("machine.reconnect")
                Button {
                    fullScreen = true
                } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right").font(.caption.weight(.semibold))
                }
                .buttonStyle(.glass)
                .accessibilityLabel("Full Screen")
                .accessibilityIdentifier("machine.fullScreen")
            }
            .controlSize(.small)
        }
    }

    // MARK: Panels

    /// The panel picker and the chosen panel (all but the wide layout, which shows every panel at once).
    @ViewBuilder
    private func panels(_ vm: VmInfo) -> some View {
        VStack(spacing: 0) {
            Picker("Panel", selection: $panel) {
                ForEach(Panel.allCases) { panel in Text(panel.title).tag(panel) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .accessibilityIdentifier("machine.panel")
            switch panel {
            case .activity:
                activity(vm)
            case .inspect:
                ScrollView { inspect(vm).padding(.horizontal, 16).padding(.bottom, 16) }
                    .refreshable { await refresh(vm) }
            case .ports:
                ScrollView { ports(vm).padding(.horizontal, 16).padding(.bottom, 16) }
                    .refreshable { await refresh(vm) }
            }
        }
    }

    @ViewBuilder
    private func activity(_ vm: VmInfo) -> some View {
        if let feed {
            ActivityLogView(feed: feed, vm: vm, command: $commandFocused)
        } else {
            ActivitySkeleton()
        }
    }

    private func inspect(_ vm: VmInfo) -> some View {
        InspectView(vm: vm) { number in
            port = String(number)
            if !wide { panel = .ports }
            act("port") { exposed = PortsView.ExposedPort(port: number, url: try await client.vmExposePort(vm.key, port: number)) }
        }
    }

    private func ports(_ vm: VmInfo) -> some View {
        PortsView(vm: vm, port: $port, exposed: $exposed)
    }

    // MARK: Actions

    @ToolbarContentBuilder
    private func toolbar(_ vm: VmInfo, label: VmLabel) -> some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            if vm.canStart {
                Button {
                    act("start") { try await client.vmStart(vm.key) }
                } label: {
                    if busy == "start" { ProgressView() } else { Label(vm.startLabel, systemImage: "play.fill").labelStyle(.titleAndIcon) }
                }
                .prominentButton()
                .disabled(busy != nil)
                .accessibilityIdentifier("machine.start")
            } else if vm.canStop {
                Button {
                    act("stop") { try await client.vmStop(vm.key) }
                } label: {
                    if busy == "stop" { ProgressView() } else { Label("Stop", systemImage: "stop.fill") }
                }
                .disabled(busy != nil)
                .accessibilityIdentifier("machine.stop")
            }
            Menu {
                Button {
                    act("refresh") { try await client.vmRefresh(vm.key) }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .accessibilityIdentifier("machine.refresh")
                if let session = label.session {
                    Button { router.openChat(session.id) } label: { Label("Open Chat", systemImage: "bubble.left.and.text.bubble.right") }
                }
                Section("Desktop") {
                    Picker(selection: $modeRaw) {
                        ForEach(DesktopMode.allCases) { mode in
                            Text(mode.playsInWebKit ? mode.title : "\(mode.title) (Chrome only)").tag(mode.rawValue)
                        }
                    } label: {
                        Label("Streaming Mode", systemImage: "play.display")
                    }
                    .pickerStyle(.menu)
                    Button { reconnect += 1 } label: { Label("Reconnect", systemImage: "arrow.triangle.2.circlepath") }
                        .disabled(!vm.isRunning)
                    Button { fullScreen = true } label: { Label("Full Screen", systemImage: "arrow.up.left.and.arrow.down.right") }
                        .disabled(!vm.isRunning)
                }
                if vm.id != nil {
                    Button {
                        act("setup") { try await client.vmRerunSetup(vm.key) }
                    } label: { Label("Re-run Setup", systemImage: "wrench.and.screwdriver") }
                        .accessibilityIdentifier("machine.menu.rerunSetup")
                    Divider()
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete VM", systemImage: "trash") }
                        .accessibilityIdentifier("machine.delete")
                }
            } label: {
                Label("More", systemImage: "ellipsis")
            }
            .accessibilityIdentifier("machine.menu")
        }
    }

    /// iPad keyboard shortcuts that aren't on a visible control: ⌘K runs a command, ⇧⌘C takes or gives back control, ⌘R
    /// refreshes.
    private func shortcuts(_ vm: VmInfo) -> some View {
        Group {
            Button("Refresh") { act("refresh") { try await client.vmRefresh(vm.key) } }
                .keyboardShortcut("r", modifiers: .command)
            Button("Run a Command") {
                panel = .activity
                commandFocused = true
            }
            .keyboardShortcut("k", modifiers: .command)
            Button(control ? "Give Back Control" : "Take Control") { if vm.isRunning { control.toggle() } }
                .keyboardShortcut("c", modifiers: [.command, .shift])
        }
        .frame(width: 0, height: 0)
        .opacity(0)
        .accessibilityHidden(true)
    }

    /// Pull to refresh: the VM's status, now.
    private func refresh(_ vm: VmInfo) async {
        do { try await client.vmRefresh(vm.key) } catch { client.notice = error.localizedDescription }
    }

    private func act(_ name: String, _ action: @escaping () async throws -> Void) {
        busy = name
        Task {
            defer { busy = nil }
            do { try await action() } catch { client.notice = error.localizedDescription }
        }
    }
}

/// The desktop alone, filling the screen (rotate for a bigger picture), with control and Done floating over it.
struct FullScreenDesktop: View {
    @Environment(\.dismiss) private var dismiss
    let vm: VmInfo
    let mode: DesktopMode
    @Binding var control: Bool

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            DesktopSurface(vm: vm, mode: mode, interactive: control)
                .aspectRatio(16 / 9, contentMode: .fit)
        }
        .overlay(alignment: .top) {
            GlassEffectContainer(spacing: 10) {
                HStack(spacing: 10) {
                    Button { dismiss() } label: { Image(systemName: "xmark").font(.body.weight(.semibold)).frame(width: 22, height: 22) }
                        .buttonStyle(.glass)
                        .buttonBorderShape(.circle)
                        .accessibilityLabel("Close")
                        .accessibilityIdentifier("fullScreen.close")
                    Spacer()
                    Button {
                        control.toggle()
                    } label: {
                        Label(control ? "You Have Control" : "Take Control", systemImage: control ? "hand.raised.fill" : "eye")
                    }
                    .buttonStyle(.glass)
                    .tint(control ? .blue : nil)
                    .disabled(!vm.isRunning)
                }
                .padding(.horizontal)
            }
        }
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
    }
}

/// The empty Machines page when no VM provider is connected.
struct ConnectBoatView: View {
    @Environment(Router.self) private var router

    var body: some View {
        EmptyStateView(title: "No cloud VMs", symbol: "server.rack",
                       message: "Connect boat.dev in Settings to give each chat its own cloud VM with a desktop.",
                       actionTitle: "Connect boat.dev in Settings") { router.openSettings(.machines) }
            .accessibilityIdentifier("machines.connect")
    }
}

struct MachineSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LineBone(width: 200, font: .footnote)
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.quaternary).aspectRatio(16 / 9, contentMode: .fit)
            ActivitySkeleton()
            Spacer()
        }
        .padding()
    }
}
