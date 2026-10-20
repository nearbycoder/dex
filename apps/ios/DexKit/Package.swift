// swift-tools-version: 6.2
import PackageDescription

/// DexCore: everything in the iOS app that isn't a view. The wire protocol, the agent connection (WebSocket, RPC,
/// synced state), sign-in, the chat transcript reducer, the OpenUI engine, and an in-process mock agent for tests and
/// previews. It builds for macOS too, so `swift test` runs its tests without a simulator.
let package = Package(
    name: "DexKit",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "DexCore", targets: ["DexCore"])
    ],
    targets: [
        .target(
            name: "DexCore",
            resources: [.copy("Resources/openui-engine.js"), .copy("Resources/openui-spec.json")]
        ),
        .testTarget(
            name: "DexCoreTests",
            dependencies: ["DexCore"],
            resources: [.copy("Fixtures")]
        )
    ]
)
