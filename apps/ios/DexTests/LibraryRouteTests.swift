import DexCore
import Foundation
import Testing
@testable import Dex

@MainActor
@Suite struct LibraryRouteTests {
    @Test func newItemBecomesTheSavedItem() {
        let router = Router()
        router.open(.newAgent, compact: true)
        #expect(router.libraryPath == [.page(.agents), .newAgent])
        router.replaceLibrary(.newAgent, with: .agent("travel-1"))
        #expect(router.libraryPath == [.page(.agents), .agent("travel-1")])

        router.open(.newSkill, compact: false)
        router.replaceLibrary(.newSkill, with: .skill("notes"))
        #expect(router.tab == .skills && router.skillsPath == [.skill("notes")])
    }

    @Test func closingARouteDropsWhatWasOpenedFromIt() {
        let router = Router()
        router.open(.project("p-dex"), compact: true)
        router.libraryPath.append(.newMcpServer)
        router.closeLibrary(.project("p-dex"))
        #expect(router.libraryPath == [.page(.projects)])

        router.open(.mcpServer("m-linear"), compact: false)
        router.closeLibrary(.mcpServer("m-linear"))
        #expect(router.mcpPath.isEmpty && router.tab == .mcp)
    }

    @Test func commandNMakesANewItemOnALibraryPage() {
        let router = Router()
        #expect(router.libraryNewItem == nil)
        router.open(.page(.skills), compact: false)
        #expect(router.libraryNewItem?.route == .newSkill)
        router.open(.page(.mcp), compact: true)
        #expect(router.libraryNewItem?.route == .newMcpServer)
        router.tab = .chats
        #expect(router.libraryNewItem == nil)
    }

    @Test func mcpPrefillFromATemplate() {
        let github = McpTemplate.all.first { $0.id == "github" }!
        let prefill = McpPrefill(template: github)
        #expect(prefill.auth == "headers" && prefill.header == "Authorization" && prefill.headerPlaceholder?.hasPrefix("Bearer") == true)
        #expect(prefill.command == nil)
    }
}
