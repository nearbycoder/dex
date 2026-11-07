import DexCore
import SwiftUI

/// A chat's control panel (the web's /control/<chat>): every one of its VMs live at once, as square, watch-only tiles
/// that fill the screen, so you can watch the agent work several machines and browsers side by side. It covers the
/// whole screen; a tap shows one VM large, and its Machine page is where you take control.
struct ControlPanelView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    let chatId: String

    @State private var focused: String?
    @State private var adding = false

    private static let gap: CGFloat = 8
    /// Below this, tiles stop shrinking to fit and the grid scrolls.
    private static let minTile: CGFloat = 150

    private var vms: [VmInfo] {
        (client.state?.vms ?? []).filter { VmKeys.chat(of: $0.key) == chatId }.sorted { VmKeys.number(of: $0.key) < VmKeys.number(of: $1.key) }
    }

    var body: some View {
        let vms = vms
        let running = vms.filter(\.isRunning).count
        // The lowest free number, so a deleted VM's slot is reused.
        let next = (1...VmKeys.maxPerChat).first { n in !vms.contains { VmKeys.number(of: $0.key) == n } }
        NavigationStack {
            Group {
                if vms.isEmpty {
                    ContentUnavailableView {
                        Label("No VMs yet", systemImage: "square.grid.2x2")
                    } description: {
                        Text("Ask this chat to work on several at once, like “check these five sites side by side”, and each VM shows up here live. It can run up to \(VmKeys.maxPerChat).")
                    }
                } else if let key = focused, let vm = vms.first(where: { $0.key == key }) {
                    ControlTile(vm: vm, large: true) { focused = nil } openMachine: { open(vm.key) }
                        .padding(Self.gap)
                } else {
                    grid(vms)
                }
            }
            .background(Color.black.opacity(0.92))
            .navigationTitle(client.state?.sessions.first { $0.id == chatId }?.title ?? "VMs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("control.done")
                }
                ToolbarItem(placement: .principal) {
                    Text("\(vms.count) of \(VmKeys.maxPerChat) VMs · \(running) running")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if running > 0 {
                        Button {
                            client.perform { for vm in vms where vm.isRunning { try await client.vmStop(vm.key) } }
                        } label: { Label("Stop All", systemImage: "stop.fill") }
                            .accessibilityHint("Stops every VM of this chat; their disks are kept")
                    }
                    Button {
                        guard let next else { return }
                        adding = true
                        Task {
                            do { try await client.vmStart(VmKeys.key(for: chatId, number: next)) } catch { client.notice = error.localizedDescription }
                            adding = false
                        }
                    } label: {
                        if adding { ProgressView() } else { Label("Add VM", systemImage: "plus") }
                    }
                    .disabled(next == nil || adding)
                    .accessibilityHint("Starts another VM for this chat")
                    .accessibilityIdentifier("control.add")
                }
            }
        }
        .preferredColorScheme(.dark)
        .persistentSystemOverlays(.hidden)
        .accessibilityIdentifier("control.panel")
    }

    private func grid(_ vms: [VmInfo]) -> some View {
        GeometryReader { geometry in
            let layout = Self.fit(vms.count, in: CGSize(width: geometry.size.width - 2 * Self.gap, height: geometry.size.height - 2 * Self.gap))
            let fits = layout.tile >= Self.minTile
            let columns = fits
                ? Array(repeating: GridItem(.fixed(layout.tile), spacing: Self.gap), count: layout.columns)
                : [GridItem(.adaptive(minimum: 200), spacing: Self.gap)]
            ScrollView {
                LazyVGrid(columns: columns, spacing: Self.gap) {
                    ForEach(vms, id: \.key) { vm in
                        ControlTile(vm: vm, large: false) { focused = vm.key } openMachine: { open(vm.key) }
                            .aspectRatio(1, contentMode: .fit)
                    }
                }
                .padding(Self.gap)
                .frame(minHeight: fits ? geometry.size.height : nil)
            }
            .scrollDisabled(fits)
        }
    }

    /// The Machine page, to take control of one: the panel closes so it shows.
    private func open(_ key: String) {
        dismiss()
        router.openMachine(key)
    }

    /// The biggest square tile that fits `count` of them in `area`, and how many columns that takes.
    private static func fit(_ count: Int, in area: CGSize) -> (columns: Int, tile: CGFloat) {
        var best = (columns: 1, tile: CGFloat(0))
        for columns in 1...max(1, count) {
            let rows = CGFloat((count + columns - 1) / columns)
            let width = (area.width - gap * CGFloat(columns - 1)) / CGFloat(columns)
            let height = (area.height - gap * (rows - 1)) / rows
            let tile = floor(min(width, height))
            if tile > best.tile { best = (columns, tile) }
        }
        return best
    }
}

/// One VM, live and watch-only: its number and status, start or stop, and the way to its Machine page.
private struct ControlTile: View {
    @Environment(DexClient.self) private var client
    @AppStorage("dex.desktopMode") private var modeRaw = DesktopMode.selkies.rawValue
    let vm: VmInfo
    let large: Bool
    let toggle: () -> Void
    let openMachine: () -> Void

    var body: some View {
        let number = VmKeys.number(of: vm.key)
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                StatusDot(kind: StatusDot.vm(vm), size: 7)
                Text("VM \(number)").font(.caption.weight(.semibold))
                Text(vm.busy ? "Working…" : vm.status.capitalized)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if vm.isRunning {
                    Button { client.perform { try await client.vmStop(vm.key) } } label: { Image(systemName: "stop.fill") }
                        .accessibilityLabel("Stop VM \(number)")
                }
                Button(action: openMachine) { Image(systemName: "rectangle.on.rectangle") }
                    .accessibilityLabel("Open VM \(number)'s Machine page")
                if large {
                    Button(action: toggle) { Image(systemName: "xmark") }
                        .accessibilityLabel("Back to all VMs")
                }
            }
            .buttonStyle(.borderless)
            .font(.caption)
            .padding(.horizontal, 10)
            .frame(height: 32)
            ZStack {
                Color.black
                if vm.isRunning {
                    DesktopSurface(vm: vm, mode: DesktopMode(saved: modeRaw), watchOnly: true, fixedLayout: CGSize(width: 960, height: 540), compactPlaceholder: true)
                        .aspectRatio(16 / 9, contentMode: .fit)
                    // Watch only: a tap shows the VM large instead of reaching it.
                    Color.clear.contentShape(.rect).onTapGesture { if !large { toggle() } }
                } else {
                    VStack(spacing: 6) {
                        Image(systemName: vm.status == "starting" ? "hourglass" : "desktopcomputer").foregroundStyle(.secondary)
                        Text(vm.status == "starting" ? "Starting…" : vm.status.capitalized).font(.caption2).foregroundStyle(.secondary)
                        if ["stopped", "error", "none"].contains(vm.status) {
                            Button(vm.status == "stopped" ? "Resume" : "Start") { client.perform { try await client.vmStart(vm.key) } }
                                .font(.caption)
                        }
                    }
                }
            }
        }
        .background(Color(white: 0.11))
        .clipShape(.rect(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(vm.busy ? Color.dexAccent.opacity(0.6) : Color.white.opacity(0.1))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("control.tile.\(number)")
    }
}
