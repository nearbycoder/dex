import DexCore
import Testing
@testable import Dex

@MainActor
@Suite struct RouterTests {
    @Test func deepLinks() {
        let router = Router()
        #expect(router.handle(URL(string: "dex://chat/s-1")!))
        #expect(router.tab == .chats && router.chat == "s-1")
        #expect(router.handle(URL(string: "dex://machine/s-2")!))
        #expect(router.tab == .machines && router.machine == "s-2")
        #expect(router.handle(URL(string: "dex://file/notes/todo.md")!))
        #expect(router.tab == .files && router.file == "/notes/todo.md")
        #expect(!router.handle(URL(string: "https://example.com")!))
    }

    @Test func libraryAcrossSizeClasses() {
        let router = Router()
        router.open(.agent("pr-author"), compact: false)
        #expect(router.tab == .agents && router.agentsPath == [.agent("pr-author")])
        // Folding (regular → compact) keeps the page and the open agent.
        router.adapt(compact: true)
        #expect(router.tab == .library && router.libraryPath == [.page(.agents), .agent("pr-author")])
        // Unfolding puts it back.
        router.adapt(compact: false)
        #expect(router.tab == .agents && router.agentsPath == [.agent("pr-author")])
        router.open(.skillSearch, compact: true)
        #expect(router.libraryPath == [.page(.skills), .skillSearch])
    }

    @Test func newChatDraft() {
        let router = Router()
        router.openChat("a")
        router.newChat(agentId: "researcher")
        #expect(router.chatSelection == .new && router.newChatDraft?.agentId == "researcher")
    }
}
