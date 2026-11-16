// swift-tools-version: 6.2
import PackageDescription

/// DexCore: everything in the iOS app that isn't a view. The wire protocol, the agent connection (WebSocket, RPC,
/// synced state), sign-in, the chat transcript reducer, the OpenUI engine, and an in-process mock agent for tests and
/// previews. It builds for macOS too, so `swift test` runs its tests without a simulator.
let package = Package(
    name: "DexKit",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "DexCore", targets: ["DexCore"]),
        // Calls' voice (tiny-voca on ONNX Runtime): the app only.
        .library(name: "DexVoice", targets: ["DexVoice"])
    ],
    dependencies: [
        // Runs tiny-voca, the voice of calls with sidekicks (DexVoice). Pinned to an exact release.
        .package(url: "https://github.com/microsoft/onnxruntime-swift-package-manager", exact: "1.24.2")
    ],
    targets: [
        .target(
            name: "DexCore",
            // Sidekicks: the ready-made looks (assets/sidekicks at the repo root), as PNGs with presets.json.
            resources: [.copy("Resources/openui-engine.js"), .copy("Resources/openui-spec.json"), .copy("Resources/Sidekicks")]
        ),
        .target(
            name: "DexVoice",
            dependencies: ["DexCore", .product(name: "onnxruntime", package: "onnxruntime-swift-package-manager")]
        ),
        .testTarget(
            name: "DexCoreTests",
            dependencies: ["DexCore", "DexVoice"],
            resources: [.copy("Fixtures")]
        )
    ]
)
