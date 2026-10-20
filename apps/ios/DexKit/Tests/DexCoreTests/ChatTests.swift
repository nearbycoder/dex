import Foundation
import Testing
@testable import DexCore

@Suite struct ChatMediaTests {
    let server = URL(string: "https://dex.example.com")!

    @Test func ownMedia() {
        #expect(ChatMedia.source("/api/media/s-1/clip.mp4") == .own(url: "/api/media/s-1/clip.mp4", kind: .video))
        #expect(ChatMedia.source("/api/media/s-1/song.m4a?x=1") == .own(url: "/api/media/s-1/song.m4a?x=1", kind: .audio))
        #expect(ChatMedia.source("https://dex.example.com/api/media/s-1/a.PNG", server: server) == .own(url: "https://dex.example.com/api/media/s-1/a.PNG", kind: .image))
        #expect(ChatMedia.source("/api/media/s-1/page.html") == nil)
        #expect(ChatMedia.ownKey("/api/media/s-1/a.png#top") == "s-1/a.png")
        #expect(ChatMedia.absolute("/api/media/k.png", server: server)?.absoluteString == "https://dex.example.com/api/media/k.png")
    }

    @Test func vmLinks() {
        let link = "https://box-1a2b-8080.on.boat.dev/out/demo.mp4?token=secret"
        #expect(ChatMedia.vmSource(link)?.source == "box-1a2b-8080.on.boat.dev/out/demo.mp4")
        #expect(ChatMedia.vmSource(link)?.port == 8080)
        #expect(ChatMedia.source(link) == .vm(url: link, kind: .video))
        #expect(ChatMedia.vmSource("http://box-8080.on.boat.dev/a.mp4") == nil)
        #expect(ChatMedia.vmSource("https://box-8080.on.boat.dev/index.html") == nil)
        let text = "See [it](\(link)) and \(link) and https://box-1a2b-8080.on.boat.dev/shot.png and https://box-1a2b-8080.on.boat.dev/x.png."
        #expect(ChatMedia.vmLinks(in: text).count == 2) // the last one ends in "." like the web, so it isn't media
    }

    @Test func videosElsewhere() {
        #expect(ChatMedia.source("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == .youtube(id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
        #expect(ChatMedia.source("https://youtu.be/dQw4w9WgXcQ") == .youtube(id: "dQw4w9WgXcQ", url: "https://youtu.be/dQw4w9WgXcQ"))
        #expect(ChatMedia.source("https://m.youtube.com/shorts/dQw4w9WgXcQ")?.url == "https://m.youtube.com/shorts/dQw4w9WgXcQ")
        #expect(ChatMedia.source("https://www.youtube.com/watch?v=short") == nil)
        #expect(ChatMedia.source("https://vimeo.com/76979871") == .vimeo(id: "76979871", url: "https://vimeo.com/76979871"))
        #expect(ChatMedia.source("https://cdn.example.com/a/b.webm") == .file(url: "https://cdn.example.com/a/b.webm"))
        #expect(ChatMedia.source("http://cdn.example.com/a/b.mp4") == nil)
        #expect(ChatMedia.source("https://example.com/page") == nil)
        #expect(ChatMedia.embedURL(.youtube(id: "dQw4w9WgXcQ", url: ""))?.host() == "www.youtube-nocookie.com")
        #expect(ChatMedia.host(.file(url: "https://cdn.example.com/b.mp4")) == "cdn.example.com")
        #expect(ChatMedia.fileName("https://cdn.example.com/a/My%20Clip.mp4") == "My Clip.mp4")
    }

    @Test func savedCopiesReplaceLinks() {
        let saved = ChatArtifact(key: "s/demo.mp4", url: "/api/media/s/demo.mp4", name: "demo.mp4", kind: "video", size: 1, source: "box-8080.on.boat.dev/demo.mp4", createdAt: 0)
        let other = ChatArtifact(key: "s/x.png", url: "/api/media/s/x.png", name: "x.png", kind: "image", size: 1, createdAt: 0)
        #expect(ChatMedia.bySource([saved, other]) == ["box-8080.on.boat.dev/demo.mp4": saved])
    }
}

@Suite struct ChatAlertsTests {
    func session(_ id: String, busy: Bool, muted: Bool = false) -> SessionMeta {
        SessionMeta(id: id, title: "Chat \(id)", model: "m", thinking: "low", createdAt: 0, updatedAt: 0, busy: busy, muted: muted)
    }

    @Test func runsThatEnded() {
        let before = [session("a", busy: true), session("b", busy: true), session("c", busy: false)]
        let after = [session("a", busy: false), session("b", busy: true), session("c", busy: false), session("d", busy: false)]
        #expect(ChatAlerts.finished(previous: before, current: after).map(\.id) == ["a"])
    }

    @Test func whoGetsNotified() {
        #expect(ChatAlerts.shouldNotify(session("a", busy: false), openChat: "b", appActive: true))
        #expect(!ChatAlerts.shouldNotify(session("a", busy: false), openChat: "a", appActive: true))
        // In the background, even the open chat.
        #expect(ChatAlerts.shouldNotify(session("a", busy: false), openChat: "a", appActive: false))
        #expect(!ChatAlerts.shouldNotify(session("a", busy: false, muted: true), openChat: nil, appActive: false))
    }

    @Test func content() {
        let done = ChatAlerts.content(title: "Plan a trip", reply: "## Saturday\n**Morning:** see [the castle](https://x.y). ```code``` Done", error: nil)
        #expect(done == .init(title: "Plan a trip", body: "Saturday Morning: see the castle. Done", failed: false))
        #expect(ChatAlerts.content(title: "T", reply: "", error: nil).body == "Done.")
        let failed = ChatAlerts.content(title: "T", reply: nil, error: "Rate limited")
        #expect(failed.title == "Problem in “T”" && failed.body == "Rate limited" && failed.failed)
        #expect(ChatAlerts.lastReply(readSession: ["messages": [["role": "user", "text": "hi"], ["role": "assistant", "text": "Hello!"]]]) == "Hello!")
    }

    @Test func lastReplyOfATranscript() {
        var transcript = TranscriptState()
        transcript.entries = [
            EntryRecord(id: "1", kind: "pi.user", model: [.user(UserMessage(text: "hi"))]),
            EntryRecord(id: "2", kind: "pi.assistant", model: [.assistant(AssistantMessage(content: [.text("Hello there")], stopReason: "stop"))])
        ]
        #expect(ChatAlerts.lastReply(transcript)?.text == "Hello there")
        transcript.entries.append(EntryRecord(id: "3", kind: "pi.assistant", model: [.assistant(AssistantMessage(content: [], stopReason: "error", errorMessage: "Boom"))]))
        #expect(ChatAlerts.lastReply(transcript)?.error == "Boom")
        transcript.entries.append(EntryRecord(id: "4", kind: "pi.assistant", model: [.assistant(AssistantMessage(content: [], stopReason: "aborted"))]))
        #expect(ChatAlerts.lastReply(transcript) == nil)
    }
}

@Suite struct ChatTextTests {
    @Test func uiNotes() {
        let (notes, text) = UserText.splitUiNotes("[Done in this chat's UI since my last message]\n- Deleted a chat\n- Saved a filter\n\nWhat next?")
        #expect(notes == ["Deleted a chat", "Saved a filter"])
        #expect(text == "What next?")
        #expect(UserText.splitUiNotes("Plain").notes.isEmpty)
    }

    @Test func slashMenu() {
        #expect(DirectorySkill.slashQuery("/") == "")
        #expect(DirectorySkill.slashQuery("/front") == "front")
        #expect(DirectorySkill.slashQuery("/front end") == nil)
        #expect(DirectorySkill.slashQuery("hi /x") == nil)
        let skills = [SkillInfo(id: "release-notes", description: ""), SkillInfo(id: "frontend-design", description: "", source: "anthropics/skills", path: "skills/frontend-design"), SkillInfo(id: "notes-frontend", description: "")]
        #expect(DirectorySkill.installed(skills, matching: "front").map(\.id) == ["frontend-design", "notes-frontend"])
        let results = [DirectorySkill(id: "anthropics/skills/frontend-design", source: "anthropics/skills", skillId: "frontend-design", name: "frontend-design", installs: 12_000),
                       DirectorySkill(id: "vercel/skills/react", source: "vercel/skills", skillId: "react", name: "react", installs: 980)]
        #expect(DirectorySkill.notInstalled(results, have: skills).map(\.skillId) == ["react"])
        #expect(DirectorySkill.formatInstalls(1_234_567) == "1.2M")
        #expect(DirectorySkill.formatInstalls(12_345) == "12K")
        #expect(DirectorySkill.formatInstalls(1_234) == "1.2K")
        #expect(DirectorySkill.formatInstalls(980) == "980")
    }
}

@Suite struct ToolDisplayTests {
    @Test func knownTools() {
        #expect(ToolDisplay(.init(id: "1", name: "bash", arguments: ["command": "ls"])) == .terminal(command: "ls", onVm: false))
        #expect(ToolDisplay(.init(id: "1", name: "vm_exec", arguments: ["command": "npm test"])) == .terminal(command: "npm test", onVm: true))
        #expect(ToolDisplay(.init(id: "1", name: "edit_file", arguments: ["path": "a.md", "old_string": "x", "new_string": "y"])) == .file(path: "a.md", action: .edit(old: "x", new: "y"), onVm: false))
        #expect(ToolDisplay(.init(id: "1", name: "app_call", arguments: ["operation": "app_delete_sessions"])) == .appCall(operation: "app_delete_sessions", arguments: .object([:])))
        #expect(ToolDisplay(.init(id: "1", name: "linear__list_issues")) == .generic)
        #expect(ToolDisplay.symbol("linear__list_issues") == "powerplug")
        #expect(ToolDisplay.symbol("use_skill") == "book")
        #expect(ToolDisplay.exitCode("FAIL\nexit code: 1\n") == 1)
        #expect(ToolDisplay.exitCode("all good") == nil)
    }

    @Test func searchResults() {
        let output = """
        1. Visit Lisbon — 48 hours in Lisbon https://visitlisbon.com/48h
        A guide to two days.
        2. [Time Out](https://timeout.com/lisbon)
        URL: https://timeout.com/lisbon
        Best of Lisbon right now.
        """
        let results = ToolDisplay.searchResults(output)
        #expect(results.count == 2)
        #expect(results[0].title == "Visit Lisbon — 48 hours in Lisbon")
        #expect(results[0].url == "https://visitlisbon.com/48h")
        #expect(results[0].snippet == "A guide to two days.")
        #expect(results[1].title == "Time Out")
        #expect(results[1].url == "https://timeout.com/lisbon")
        #expect(ToolDisplay.searchResults("no results here").isEmpty)
    }

    @Test func confirmationsAndSharedMedia() {
        let calls: [ContentBlock] = [
            .toolCall(.init(id: "c1", name: "app_call", arguments: ["operation": "app_delete_sessions"])),
            .toolCall(.init(id: "c2", name: "share_media", arguments: ["path": "out.mp4"])),
            .text("Here it is.")
        ]
        let layout = ReplyLayout(messages: [AssistantMessage(content: calls)], streaming: false)
        let results: [String: ToolResultMessage] = [
            "c1": ToolResultMessage(toolCallId: "c1", toolName: "app_call", details: ["confirmation": ["id": "p-1", "summary": "Delete 2 chats"]]),
            "c2": ToolResultMessage(toolCallId: "c2", toolName: "share_media", details: ["media": ["url": "/api/media/s/out.mp4", "name": "out.mp4", "kind": "video"]])
        ]
        #expect(layout.confirmations(results: results).map(\.id) == ["p-1"])
        #expect(layout.sharedMedia(results: results).map(\.url) == ["/api/media/s/out.mp4"])
    }

    @Test func runningBetweenSteps() {
        let message = AssistantMessage(content: [.toolCall(.init(id: "c1", name: "bash", arguments: ["command": "make"]))], stopReason: "toolUse")
        #expect(!ReplyLayout(messages: [message], streaming: false).active)
        #expect(ReplyLayout(messages: [message], streaming: false, running: true).active)
    }
}
