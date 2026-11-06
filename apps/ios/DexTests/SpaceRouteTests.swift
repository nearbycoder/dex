import DexCore
import Foundation
import Testing
@testable import Dex

@MainActor
@Suite struct SpaceRouteTests {
    @Test func newSpaceLink() {
        let router = Router()
        #expect(router.handle(URL(string: "dex://spaces/new")!))
        #expect(router.tab == .chats && router.spaceSheet == .new)
    }

    @Test func spacesPageAcrossSizeClasses() {
        let router = Router()
        router.open(.space("launch"), compact: false)
        #expect(router.tab == .spaces && router.spacesPath == [.space("launch")])
        router.adapt(compact: true)
        #expect(router.tab == .library && router.libraryPath == [.page(.spaces), .space("launch")])
        router.adapt(compact: false)
        #expect(router.tab == .spaces && router.spacesPath == [.space("launch")])
        #expect(router.libraryNewItem?.route == .newSpace)

        router.open(.newSpace, compact: false)
        router.replaceLibrary(.newSpace, with: .space("research"))
        #expect(router.spacesPath == [.space("research")])
        router.closeLibrary(.space("research"))
        #expect(router.spacesPath.isEmpty)
        #expect(AppTab.libraryPages.contains(.spaces))
    }
}
