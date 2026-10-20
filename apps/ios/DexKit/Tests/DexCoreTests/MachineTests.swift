import Foundation
import Testing
@testable import DexCore

@Suite struct MachineModelTests {
    let minute = 60_000.0

    @Test func statusLabels() {
        #expect(VmInfo.statusLabel("none") == "No VM yet")
        #expect(VmInfo.statusLabel("stopped") == "Stopped · disk saved")
        #expect(VmInfo.statusLabel("running") == "Running")
        #expect(VmInfo(key: "a", status: "stopped").startLabel == "Resume")
        #expect(VmInfo(key: "a", status: "error").startLabel == "Start")
        #expect(VmInfo(key: "a", status: "error").canStart)
        #expect(!VmInfo(key: "a", status: "running").canStart)
        #expect(VmInfo(key: "a", status: "starting").isLive)
    }

    @Test func setupAndIdleText() {
        let now = 10_000_000.0
        var vm = VmInfo(key: "a", status: "running", lastActiveAt: now - 2 * minute)
        #expect(vm.idleText(minutes: 5, now: now) == "stops when idle in 3 min")
        vm.lastActiveAt = now - 6 * minute
        #expect(vm.idleText(minutes: 5, now: now) == "idle, stopping any moment now")
        vm.busy = true
        #expect(vm.idleText(minutes: 5, now: now) == "in use")
        vm.setup = VmSetup(status: "running", step: nil, error: nil)
        #expect(vm.setupText == "Setting up: preparing")
        vm.setup = VmSetup(status: "error", step: "cloning", error: "denied")
        #expect(vm.setupText == "Setup failed at “cloning”")
        vm.setup = .none
        #expect(vm.setupText == nil)
    }

    @Test func labelsAndOrder() {
        let state = MockData.state()
        #expect(state.vmLabel(VmKeys.mcp).title == "MCP servers")
        #expect(state.vmLabel(VmKeys.shared).title == "Shared VM")
        let label = state.vmLabel(MockData.vmChatId)
        #expect(label.title == "Fix the flaky test in dex")
        #expect(label.detail == "Dex · PR Author")
        #expect(state.vmLabel("gone").title == "Deleted chat")
        #expect(state.vmLabel(MockData.chartChatId).detail == "Data Analyst")
        // A chat without a VM yet is a "No VM yet" machine; an unknown key is nothing.
        #expect(state.machine(MockData.chartChatId)?.status == "none")
        #expect(state.machine("gone") == nil)

        let sorted = [VmInfo(key: "old", status: "stopped", lastActiveAt: 1), VmInfo(key: "new", status: "stopped", lastActiveAt: 5), VmInfo(key: "run", status: "running", lastActiveAt: 0)]
            .sorted(by: VmInfo.byRecentUse)
        #expect(sorted.map(\.key) == ["run", "new", "old"])
    }

    @Test func activityMergesStreamedOutput() {
        var log = VmActivityLog()
        let running = VmActivity(id: 7, at: 1, actor: "user", kind: "exec", title: "ls", status: "running", exitCode: nil, output: "")
        let applied = log.apply(.vmActivity(vmKey: "k", activity: running), vmKey: "k")
        let ignored = log.apply(.vmActivity(vmKey: "other", activity: running), vmKey: "k")
        #expect(applied && !ignored)
        log.apply(.vmOutput(vmKey: "k", id: 7, data: "a\n"), vmKey: "k")
        log.apply(.vmOutput(vmKey: "k", id: 7, data: "b\n"), vmKey: "k")
        let lost = log.apply(.vmOutput(vmKey: "k", id: 99, data: "lost"), vmKey: "k")
        #expect(!lost)
        #expect(log.items.count == 1 && log.items[0].output == "a\nb\n")
        // A repeat of the running entry doesn't wipe what streamed; the finished one replaces it.
        log.apply(.vmActivity(vmKey: "k", activity: running), vmKey: "k")
        #expect(log.items[0].output == "a\nb\n")
        var done = running
        done.status = "error"; done.exitCode = 2; done.output = "a\nb\nfailed\n"
        log.apply(.vmActivity(vmKey: "k", activity: done), vmKey: "k")
        #expect(log.items[0].failureText == "exit 2")
        #expect(log.items[0].output.hasSuffix("failed\n"))
    }

    @Test func activityCapsOutputAndItems() {
        var log = VmActivityLog(items: [VmActivity(id: 1, at: 0, actor: "agent", kind: "exec", title: "yes", status: "running", exitCode: nil, output: "")])
        log.apply(.vmOutput(vmKey: "k", id: 1, data: String(repeating: "x", count: VmActivityLog.maxOutput) + "END"), vmKey: "k")
        #expect(log.items[0].output.count == VmActivityLog.maxOutput)
        #expect(log.items[0].output.hasSuffix("END"))
        for id in 2...(VmActivityLog.maxItems + 5) {
            log.apply(.vmActivity(vmKey: "k", activity: VmActivity(id: id, at: 0, actor: "agent", kind: "exec", title: "t", status: "done", exitCode: 0, output: "")), vmKey: "k")
        }
        #expect(log.items.count == VmActivityLog.maxItems)
        #expect(log.items.last?.id == VmActivityLog.maxItems + 5)
    }

    @Test func historyMerge() {
        var log = VmActivityLog(items: [
            VmActivity(id: 3, at: 0, actor: "user", kind: "exec", title: "new", status: "running", exitCode: nil, output: "streamed so far")
        ])
        log.merge(history: [
            VmActivity(id: 1, at: 0, actor: "agent", kind: "exec", title: "old", status: "done", exitCode: 0, output: ""),
            VmActivity(id: 3, at: 0, actor: "user", kind: "exec", title: "new", status: "running", exitCode: nil, output: "")
        ])
        #expect(log.items.map(\.id) == [1, 3])
        #expect(log.items[1].output == "streamed so far")
    }

    @Test func decodesPeeks() throws {
        let down = try JSONDecoder.dex.decode(VmPeekResult.self, from: Data(#"{"running":false,"status":"stopped","view":"files"}"#.utf8))
        #expect(!down.running && down.status == "stopped" && down.entries.isEmpty)

        let files = try MockAgent.peek(view: "files", path: "~/work").decode(VmPeekResult.self)
        #expect(files.running && files.path == "~/work")
        #expect(files.sortedEntries.first?.isDirectory == true)
        #expect(files.entries.contains { $0.type == "link" })

        let git = try MockAgent.peek(view: "git", path: "~/work/dex").decode(VmPeekResult.self)
        #expect(git.repo == true && git.branch == "fix/dates-timezone" && git.tracking == "origin/fix/dates-timezone")
        #expect(git.changes.map(\.label) == ["Modified", "Untracked"])
        #expect(git.commits.first?.subject == "Pin the date tests to UTC")

        let notRepo = try JSONDecoder.dex.decode(VmPeekResult.self, from: Data(#"{"running":true,"status":"running","view":"git","path":"~","repo":false,"error":"fatal: not a git repository"}"#.utf8))
        #expect(notRepo.repo == false && notRepo.error?.hasPrefix("fatal") == true)

        let ports = try MockAgent.peek(view: "ports", path: "").decode(VmPeekResult.self)
        #expect(ports.ports.first == VmListeningPort(port: 3000, address: "0.0.0.0:3000", process: "node"))
        let processes = try MockAgent.peek(view: "processes", path: "").decode(VmPeekResult.self)
        #expect(processes.processes.first?.cpu == 38.5)
        let file = try MockAgent.peek(view: "file", path: "~/work/notes.md").decode(VmPeekResult.self)
        #expect(file.content?.hasPrefix("# Notes") == true)
    }

    @Test func paths() {
        #expect(VmPaths.join("~/work", "dex") == "~/work/dex")
        #expect(VmPaths.join("/", "etc") == "/etc")
        #expect(VmPaths.parent("~/work/dex") == "~/work")
        #expect(VmPaths.parent("~/work") == "~")
        #expect(VmPaths.parent("~") == nil)
        #expect(VmPaths.parent("/etc") == "/")
        #expect(VmPaths.parent("/") == nil)
    }

    @Test func desktopURLs() {
        let server = URL(string: "https://dex.example.com")!
        #expect(DesktopURL.resolve("/vm-desktop/s-1/", server: server)?.absoluteString == "https://dex.example.com/vm-desktop/s-1/")
        #expect(DesktopURL.resolve("/vm-desktop/s-1/", server: server, watchOnly: true)?.absoluteString == "https://dex.example.com/vm-desktop/s-1/?view=watch")
        let boat = "https://6080-box.boat.dev/vnc.html?resize=scale"
        #expect(DesktopURL.resolve(boat, server: server, watchOnly: true)?.absoluteString == boat)
        #expect(DesktopURL.isOnServer(URL(string: "https://dex.example.com/vm-desktop/x/")!, server: server))
        #expect(!DesktopURL.isOnServer(URL(string: boat)!, server: server))
        #expect(DesktopMode(saved: "vnc") == .vnc)
        #expect(DesktopMode(saved: "stream") == .selkies)
        #expect(DesktopMode(saved: nil) == .selkies)
    }

    @Test func portURLs() {
        #expect(PortURL.display("https://3000-box.boat.dev/?_token=abc") == "https://3000-box.boat.dev/")
        #expect(PortURL.display("https://3000-box.boat.dev/app?x=1&_token=abc") == "https://3000-box.boat.dev/app?x=1")
        #expect(PortURL.display("https://example.com/") == "https://example.com/")
        #expect(PortURL.parse("3000") == 3000)
        #expect(PortURL.parse("0") == nil)
        #expect(PortURL.parse("70000") == nil)
        #expect(PortURL.parse("abc") == nil)
    }
}

@MainActor
@Suite struct MachineMockTests {
    func connected() async -> (MockAgent, DexClient) {
        let agent = MockAgent()
        agent.chunkDelay = .milliseconds(1)
        let client = DexClient(credentials: nil, factory: MockTransportFactory(agent: agent), cache: nil)
        client.start()
        await eventually { client.isConnected }
        return (agent, client)
    }

    @Test func runStreamsIntoTheFeed() async throws {
        let (_, client) = await connected()
        let feed = MachineFeed(vmKey: MockData.vmChatId, client: client)
        feed.start()
        await eventually { feed.loaded && !feed.items.isEmpty }
        let before = feed.items.count
        let result = try await client.vmRun(MockData.vmChatId, command: "echo hello")
        #expect(result.exitCode == 0 && result.output == "hello\n")
        await eventually { feed.items.count == before + 1 && feed.items.last?.status == "done" }
        #expect(feed.items.last?.title == "echo hello")
        #expect(feed.items.last?.actor == "user")
        #expect(feed.items.last?.output == "hello\n")

        let failed = try await client.vmRun(MockData.vmChatId, command: "exit 3")
        #expect(failed.exitCode == 3)
        await eventually { feed.items.last?.failureText == "exit 3" }
    }

    @Test func lifecycle() async throws {
        let (agent, client) = await connected()
        let key = MockData.welcomeId
        #expect(client.state?.vm(key)?.status == "stopped")
        let started = try await client.vmStart(key)
        #expect(started.status == "running")
        await eventually { client.state?.vm(key)?.status == "running" }
        #expect(try await client.vmDesktopUrl(key, mode: .selkies)?.hasPrefix("data:text/html") == true)
        let stopped = try await client.vmStop(key)
        #expect(stopped.status == "stopped")
        #expect(try await client.vmDesktopUrl(key, mode: .selkies) == nil)
        let peek = try await client.vmPeek(key, view: .files)
        #expect(!peek.running && peek.status == "stopped")
        try await client.vmDestroy(key)
        await eventually { client.state?.vm(key) == nil }
        #expect(agent.calls.map(\.method).filter { $0.hasPrefix("vm") } == ["vmStart", "vmDesktopUrl", "vmStop", "vmDesktopUrl", "vmPeek", "vmDestroy"])
    }

    @Test func exposesAPort() async throws {
        let (_, client) = await connected()
        let url = try await client.vmExposePort(MockData.vmChatId, port: 3000)
        #expect(PortURL.display(url) == "https://3000-box-1234.boat.dev/")
        await #expect(throws: AgentError.self) { try await client.vmExposePort(MockData.vmChatId, port: 0) }
    }
}
