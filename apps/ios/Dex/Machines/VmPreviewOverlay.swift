import DexCore
import SwiftUI

/// A chat's VM, watchable while you read the chat (the web's vm-preview.tsx): a small floating glass button that opens
/// a picture-in-picture window of the live desktop. Both can be dragged anywhere and snap to the nearest side like the
/// system's PiP window; the window resizes from the corner facing the middle and stays 16:9. Where they sit, the
/// window's size, and whether it's open are kept on this device. The window only watches; the Machine page is where you
/// take control. Closing it back to the button stops the stream.
///
/// While a project chat's VM sets up, the button grows into a capsule with the current step.
struct VmPreviewOverlay: View {
    let vm: VmInfo
    @AppStorage("dex.vmPreview.open") private var open = false
    // The button rests just above the composer, at the end of the transcript, where it covers the least.
    @AppStorage("dex.vmPreview.button") private var buttonSpot = PreviewSpot(right: true, y: 1).raw
    @AppStorage("dex.vmPreview.window") private var windowSpot = PreviewSpot(right: true, y: 0.85).raw
    @AppStorage("dex.vmPreview.width") private var savedWidth: Double = 0

    var body: some View {
        GeometryReader { geometry in
            let bounds = PreviewBounds(size: geometry.size)
            if open {
                PreviewWindow(vm: vm, bounds: bounds, spot: $windowSpot, savedWidth: $savedWidth) { open = false }
                    .transition(.scale(scale: 0.6, anchor: .bottomTrailing).combined(with: .opacity))
            } else {
                PreviewButton(vm: vm, bounds: bounds, spot: $buttonSpot) { open = true }
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.35, bounce: 0.15), value: open)
        .sensoryFeedback(.impact(weight: .light), trigger: open)
    }
}

/// Where a floating box rests: against the left or right side, some fraction of the way down the free space. Kept as a
/// fraction so it lands in the same place after a rotation, a split-view resize, or the keyboard opening.
struct PreviewSpot: Equatable {
    var right: Bool
    var y: Double

    var raw: String { "\(right ? "r" : "l"):\(y)" }

    init(right: Bool, y: Double) {
        self.right = right
        self.y = min(max(y, 0), 1)
    }

    init(raw: String) {
        let parts = raw.split(separator: ":")
        self.init(right: parts.first != "l", y: parts.count > 1 ? Double(parts[1]) ?? 0.85 : 0.85)
    }
}

/// The area a floating box may use: the chat's safe area, less margins and room for the composer at the bottom.
struct PreviewBounds {
    let size: CGSize
    static let margin: CGFloat = 12
    static let top: CGFloat = 8
    /// Keeps the message field uncovered.
    static let bottom: CGFloat = 84

    func origin(_ spot: PreviewSpot, size box: CGSize) -> CGPoint {
        let x = spot.right ? size.width - Self.margin - box.width : Self.margin
        let range = verticalRange(box)
        return CGPoint(x: x, y: range.lowerBound + spot.y * (range.upperBound - range.lowerBound))
    }

    /// The resting spot for a box dropped at `origin` (its side by which half its middle is in).
    func spot(at origin: CGPoint, size box: CGSize) -> PreviewSpot {
        let range = verticalRange(box)
        let span = range.upperBound - range.lowerBound
        return PreviewSpot(right: origin.x + box.width / 2 > size.width / 2, y: span > 0 ? (origin.y - range.lowerBound) / span : 1)
    }

    private func verticalRange(_ box: CGSize) -> ClosedRange<CGFloat> {
        let low = Self.top
        return low...max(low, size.height - Self.bottom - box.height)
    }

    /// The widest the window's picture may be.
    var maxWidth: CGFloat { max(160, size.width - 2 * Self.margin - 2 * PreviewWindow.inset) }
    var compact: Bool { size.width < 600 }
}

/// Moves a floating box with a drag and lets it settle against the nearer side, carried a little by the fling.
private struct FloatingPlacement: ViewModifier {
    let bounds: PreviewBounds
    let size: CGSize
    @Binding var spot: String
    @State private var offset: CGSize = .zero

    func body(content: Content) -> some View {
        let origin = bounds.origin(PreviewSpot(raw: spot), size: size)
        content
            .frame(width: size.width, height: size.height)
            .position(x: origin.x + size.width / 2 + offset.width, y: origin.y + size.height / 2 + offset.height)
            .gesture(
                DragGesture(minimumDistance: 6, coordinateSpace: .global)
                    .onChanged { value in offset = value.translation }
                    .onEnded { value in
                        let fling = CGSize(width: (value.predictedEndTranslation.width - value.translation.width) * 0.35,
                                           height: (value.predictedEndTranslation.height - value.translation.height) * 0.35)
                        let dropped = CGPoint(x: origin.x + value.translation.width + fling.width, y: origin.y + value.translation.height + fling.height)
                        withAnimation(.spring(duration: 0.4, bounce: 0.2)) {
                            spot = bounds.spot(at: dropped, size: size).raw
                            offset = .zero
                        }
                    }
            )
    }
}

/// The closed preview: a glass button with the VM's status (and, while it sets up, the step).
private struct PreviewButton: View {
    let vm: VmInfo
    let bounds: PreviewBounds
    @Binding var spot: String
    let onOpen: () -> Void
    @State private var size = CGSize(width: 52, height: 52)

    var body: some View {
        content
            .fixedSize()
            .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
            .modifier(FloatingPlacement(bounds: bounds, size: size, spot: $spot))
    }

    private var content: some View {
        HStack(spacing: 8) {
            Image(systemName: "display")
                .font(.system(size: 20, weight: .medium))
                .overlay(alignment: .topTrailing) {
                    StatusDot(kind: StatusDot.vm(vm), size: 8).offset(x: 4, y: -3)
                }
            if vm.isSettingUp, let setup = vm.setupText {
                ProgressView().controlSize(.mini)
                Text(setup)
                    .font(.caption.weight(.medium))
                    .lineLimit(1)
                    .frame(maxWidth: bounds.compact ? 180 : 260, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, vm.isSettingUp ? 16 : 0)
        .frame(minWidth: 52, minHeight: 52)
        .contentShape(.capsule)
        .glassEffect(.regular.interactive(), in: .capsule)
        .onTapGesture(perform: onOpen)
        .hoverEffect(.lift)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Watch this chat's VM")
        .accessibilityValue(vm.setupText ?? vm.statusLabel)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onOpen() }
        .accessibilityIdentifier("vmPreview.button")
    }
}

/// The open preview: a title bar to drag it by, the desktop scaled to fit (watch only), and a resize grip.
private struct PreviewWindow: View {
    @Environment(Router.self) private var router
    let vm: VmInfo
    let bounds: PreviewBounds
    @Binding var spot: String
    @Binding var savedWidth: Double
    let onClose: () -> Void
    @AppStorage("dex.desktopMode") private var modeRaw = DesktopMode.selkies.rawValue
    @State private var resize: CGFloat = 0

    static let inset: CGFloat = 4
    static let titleBar: CGFloat = 34
    static let minWidth: CGFloat = 160
    /// The page lays out at this size and is scaled to the window (see DesktopSurface.fixedLayout).
    static let frame = CGSize(width: 960, height: 540)

    private var presets: (small: CGFloat, large: CGFloat) { bounds.compact ? (220, 330) : (260, 480) }
    private var baseWidth: CGFloat { savedWidth > 0 ? savedWidth : presets.small }
    private var pictureWidth: CGFloat { min(max(baseWidth + resize, Self.minWidth), bounds.maxWidth).rounded() }
    private var large: Bool { pictureWidth >= (presets.small + presets.large) / 2 }
    private var size: CGSize {
        CGSize(width: pictureWidth + 2 * Self.inset, height: Self.titleBar + pictureWidth * 9 / 16 + 2 * Self.inset)
    }
    private var onRight: Bool { PreviewSpot(raw: spot).right }

    var body: some View {
        VStack(spacing: 0) {
            titleBar
            DesktopSurface(vm: vm, mode: DesktopMode(saved: modeRaw), watchOnly: true, fixedLayout: Self.frame, compactPlaceholder: true)
                .frame(width: pictureWidth, height: pictureWidth * 9 / 16)
                .clipShape(.rect(cornerRadius: 12, style: .continuous))
                // Watch only: drags on the picture move the window instead of reaching the VM.
                .overlay { Color.clear.contentShape(.rect) }
        }
        .padding(Self.inset)
        .glassEffect(.regular, in: .rect(cornerRadius: 18, style: .continuous))
        .shadow(color: .black.opacity(0.25), radius: 16, y: 6)
        .overlay(alignment: onRight ? .bottomLeading : .bottomTrailing) { grip }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("vmPreview.window")
        .modifier(FloatingPlacement(bounds: bounds, size: size, spot: $spot))
    }

    private var title: String {
        if vm.isSettingUp { return "Setting up…" }
        if vm.status == "starting" { return "Starting…" }
        return vm.busy ? "Dex is working" : "VM desktop"
    }

    private var titleBar: some View {
        HStack(spacing: 2) {
            StatusDot(kind: StatusDot.vm(vm), size: 7).padding(.leading, 8)
            Text(title).font(.caption.weight(.semibold)).lineLimit(1).padding(.leading, 4)
                .accessibilityIdentifier("vmPreview.title")
            Spacer(minLength: 4)
            button(large ? "Smaller" : "Larger", symbol: large ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right", id: "vmPreview.size") {
                withAnimation(.spring(duration: 0.35)) { savedWidth = Double(large ? presets.small : presets.large) }
            }
            button("Open the Machine Page", symbol: "arrow.up.forward.square", id: "vmPreview.openMachine") {
                router.openMachine(vm.key)
            }
            button("Close to a Button", symbol: "pip.exit", id: "vmPreview.close", action: onClose)
        }
        .frame(height: Self.titleBar)
        .contentShape(.rect)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("vmPreview.titleBar")
    }

    private func button(_ label: String, symbol: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .frame(width: 30, height: 30)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .hoverEffect(.highlight)
        .accessibilityLabel(label)
        .accessibilityIdentifier(id)
    }

    /// Drags out from the corner facing the middle: whichever way the finger moved further sets the width.
    private var grip: some View {
        Image(systemName: "line.diagonal")
            .font(.system(size: 11, weight: .bold))
            .rotationEffect(.degrees(onRight ? 0 : 90))
            .foregroundStyle(.white.opacity(0.85))
            .shadow(radius: 2)
            .frame(width: 32, height: 32)
            .contentShape(.rect)
            .highPriorityGesture(
                DragGesture(minimumDistance: 2, coordinateSpace: .global)
                    .onChanged { value in
                        let dx = value.translation.width * (onRight ? -1 : 1)
                        let dy = value.translation.height * 16 / 9
                        resize = abs(dx) > abs(dy) ? dx : dy
                    }
                    .onEnded { _ in
                        savedWidth = Double(pictureWidth)
                        resize = 0
                    }
            )
            .accessibilityElement()
            .accessibilityLabel("Resize")
            .accessibilityAdjustableAction { direction in
                let step: CGFloat = direction == .increment ? 40 : -40
                savedWidth = Double(min(max(pictureWidth + step, Self.minWidth), bounds.maxWidth))
            }
            .accessibilityIdentifier("vmPreview.resize")
    }
}
