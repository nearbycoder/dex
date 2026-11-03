import Foundation

/// The mock agent's methods for: VMs: lifecycle, activity, commands, peeks, desktop URLs, ports.
extension MockAgent {
    /// How long a mock VM takes to start or stop, and between streamed output lines.
    var vmStep: Duration { chunkDelay * 12 }

    func installMachineHandlers() {
        installMachineFixtures()

        register("vmRefresh") { [unowned self] args, _ in try self.vmInfo(args.string(0)) }
        register("vmStart") { [unowned self] args, _ in
            let key = try self.requireVmKey(args.string(0))
            await self.startVm(key)
            return try self.vmInfo(key)
        }
        register("vmStop") { [unowned self] args, _ in
            let key = try self.requireVmKey(args.string(0))
            guard self.state.vm(key)?.status == "running" else { return try self.vmInfo(key) }
            self.updateVm(key) { $0.status = "stopping" }
            try? await Task.sleep(for: self.vmStep)
            self.updateVm(key) { $0.status = "stopped"; $0.busy = false }
            self.logVm(key, actor: "user", kind: "lifecycle", title: "stopped the VM (disk saved)")
            return try self.vmInfo(key)
        }
        register("vmDestroy") { [unowned self] args, _ in
            let key = try self.requireVmKey(args.string(0))
            self.state.vms.removeAll { $0.key == key }
            self.store["vm-activity:\(key)"] = nil
            self.publish()
            return try JSONValue(encoding: VmInfo(key: key))
        }
        register("vmRerunSetup") { [unowned self] args, _ in
            let key = try self.requireVmKey(args.string(0))
            await self.startVm(key)
            for step in ["signing in to GitHub", "cloning octocat/dex", "running the setup script"] {
                self.updateVm(key) { $0.setup = VmSetup(status: "running", step: step, error: nil) }
                try? await Task.sleep(for: self.vmStep)
            }
            self.updateVm(key) { $0.setup = VmSetup(status: "done", step: nil, error: nil) }
            self.logVm(key, actor: "system", kind: "lifecycle", title: "setup finished")
            return .null
        }
        register("vmTouch") { [unowned self] args, _ in
            if let key = args.string(0) { self.updateVm(key, publish: false) { $0.lastActiveAt = .nowMs } }
            return .null
        }
        register("vmActivity") { [unowned self] args, _ in
            let items = self.vmActivity(args.string(0) ?? "")
            let limit = args.value(1).int ?? 100
            return try JSONValue(encoding: Array(items.suffix(limit)))
        }
        register("vmRun") { [unowned self] args, _ in
            let key = try self.requireVmKey(args.string(0))
            let command = args.string(1) ?? ""
            await self.startVm(key)
            return try await self.runOnVm(key, command: command)
        }
        register("vmPeek") { [unowned self] args, _ in
            let key = try self.requireVmKey(args.string(0))
            let view = args.string(1) ?? "files"
            let path = args.string(2) ?? "~/work"
            guard let vm = self.state.vm(key), vm.status == "running" else {
                return ["running": false, "status": .string(self.state.vm(key)?.status ?? "none"), "view": .string(view)]
            }
            return Self.peek(view: view, path: path)
        }
        register("vmFiles") { [unowned self] args, _ in
            let key = try self.requireVmKey(args.string(0))
            guard let vm = self.state.vm(key), vm.status == "running" else {
                return ["running": false, "status": .string(self.state.vm(key)?.status ?? "none")]
            }
            return ["running": true, "data": try Self.files(view: args.string(1) ?? "directory", path: args.string(2) ?? "~/work")]
        }
        register("vmDesktopUrl") { [unowned self] args, _ in
            guard let key = args.string(0), self.state.vm(key)?.status == "running" else { return .null }
            return .string(Self.desktopPage(key: key, mode: args.string(1) ?? "selkies"))
        }
        register("vmExposePort") { [unowned self] args, _ in
            let key = try self.requireVmKey(args.string(0))
            let port = args.value(1).int ?? 0
            guard (1...65_535).contains(port) else { throw AgentError.remote("Pick a port from 1 to 65535.") }
            await self.startVm(key)
            let box = self.state.vm(key)?.id ?? "box"
            let url = "https://\(port)-\(box).boat.dev/?_token=mock-\(port)"
            self.logVm(key, actor: "user", kind: "port", title: "expose port \(port)", output: "https://\(port)-\(box).boat.dev/?_token=…")
            return .string(url)
        }
    }

    // MARK: Fixtures

    /// More VMs than MockData's two: one setting up, one failed, the MCP host, and the legacy shared VM; and each one's
    /// activity history.
    private func installMachineFixtures() {
        let now = Double.nowMs
        let minute = 60_000.0
        if state.vm("s-snoozed") == nil {
            state.vms.append(VmInfo(key: "s-snoozed", id: "box-2468", status: "running", size: "default", lastActiveAt: now - 2 * minute, busy: true,
                                    setup: VmSetup(status: "running", step: "cloning octocat/dex", error: nil)))
        }
        if state.vm("s-settled") == nil {
            state.vms.append(VmInfo(key: "s-settled", id: "box-1357", status: "error", size: "small", error: "VM is archived", lastActiveAt: now - 4 * 1_440 * minute,
                                    setup: VmSetup(status: "error", step: "running the setup script", error: "npm ci exited with 1")))
        }
        if state.vm(VmKeys.mcp) == nil {
            state.vms.append(VmInfo(key: VmKeys.mcp, id: "box-mcp", status: "stopped", size: "small", lastActiveAt: now - 2 * 1_440 * minute))
        }
        if state.vm(VmKeys.shared) == nil {
            state.vms.append(VmInfo(key: VmKeys.shared, id: "box-old", status: "stopped", size: "small", lastActiveAt: now - 30 * 1_440 * minute))
        }
        let t = now - 20 * minute
        setVmActivity(MockData.vmChatId, [
            VmActivity(id: 1, at: t, actor: "system", kind: "lifecycle", title: "started the VM", status: "done", exitCode: nil, output: ""),
            VmActivity(id: 2, at: t + 20_000, actor: "agent", kind: "exec", title: "cd ~/work/dex && npm test -- dates", status: "error", exitCode: 1,
                       output: "FAIL src/dates.test.ts\n  ✕ formats midnight (12 ms)\n\nTests: 1 failed, 41 passed"),
            VmActivity(id: 3, at: t + 60_000, actor: "agent", kind: "file", title: "write ~/work/dex/src/dates.test.ts", status: "done", exitCode: nil, output: "1,204 characters"),
            VmActivity(id: 4, at: t + 90_000, actor: "agent", kind: "exec", title: "cd ~/work/dex && TZ=Pacific/Auckland npm test -- dates", status: "done", exitCode: 0,
                       output: "PASS src/dates.test.ts\n  ✓ formats midnight (9 ms)\n\nTests: 42 passed"),
            VmActivity(id: 5, at: t + 120_000, actor: "agent", kind: "screenshot", title: "screenshot", status: "done", exitCode: nil, output: "1280×800")
        ])
        setVmActivity("s-snoozed", [
            VmActivity(id: 1, at: now - 3 * minute, actor: "system", kind: "lifecycle", title: "started the VM", status: "done", exitCode: nil, output: ""),
            VmActivity(id: 2, at: now - 2 * minute, actor: "system", kind: "exec", title: "git clone https://github.com/octocat/dex ~/work/dex", status: "running", exitCode: nil,
                       output: "Cloning into '/home/user/work/dex'...\nReceiving objects:  48% (2310/4812)")
        ])
        setVmActivity("s-settled", [
            VmActivity(id: 1, at: now - 4 * 1_440 * minute, actor: "system", kind: "exec", title: "npm ci", status: "error", exitCode: 1,
                       output: "npm ERR! code ERESOLVE\nnpm ERR! Could not resolve dependency")
        ])
    }

    // MARK: Helpers

    private func requireVmKey(_ key: String?) throws -> String {
        guard let key, state.vm(key) != nil || state.session(key) != nil else { throw AgentError.remote("No such VM.") }
        return key
    }

    private func vmInfo(_ key: String?) throws -> JSONValue {
        let key = try requireVmKey(key)
        return try JSONValue(encoding: state.vm(key) ?? VmInfo(key: key))
    }

    private func updateVm(_ key: String, publish: Bool = true, _ change: (inout VmInfo) -> Void) {
        if let index = state.vms.firstIndex(where: { $0.key == key }) {
            change(&state.vms[index])
        } else {
            var vm = VmInfo(key: key, id: "box-\(UUID().uuidString.prefix(4).lowercased())", size: state.settings.vmSize)
            change(&vm)
            state.vms.append(vm)
        }
        if publish { self.publish() }
    }

    /// Starts a VM that isn't running (starting, then running a moment later).
    private func startVm(_ key: String) async {
        guard state.vm(key)?.status != "running" else { return }
        updateVm(key) { $0.status = "starting"; $0.error = nil }
        try? await Task.sleep(for: self.vmStep)
        updateVm(key) { $0.status = "running"; $0.lastActiveAt = .nowMs }
        logVm(key, actor: "system", kind: "lifecycle", title: "started the VM")
    }

    public func vmActivity(_ key: String) -> [VmActivity] {
        (try? store["vm-activity:\(key)"]?.decode([VmActivity].self)) ?? []
    }

    private func setVmActivity(_ key: String, _ items: [VmActivity]) {
        store["vm-activity:\(key)"] = try? JSONValue(encoding: items)
    }

    private func nextActivityId(_ key: String) -> Int { (vmActivity(key).map(\.id).max() ?? 0) + 1 }

    /// Records a finished entry and tells every watcher.
    @discardableResult
    private func logVm(_ key: String, actor: String, kind: String, title: String, output: String = "") -> VmActivity {
        let activity = VmActivity(id: nextActivityId(key), at: .nowMs, actor: actor, kind: kind, title: title, status: "done", exitCode: nil, output: output)
        setVmActivity(key, vmActivity(key) + [activity])
        broadcastActivity(key, activity)
        return activity
    }

    private func broadcastActivity(_ key: String, _ activity: VmActivity) {
        broadcast(["type": "dex.vm.activity", "sessionId": .null, "vmKey": .string(key), "activity": (try? JSONValue(encoding: activity)) ?? .null], sessionId: nil)
    }

    /// Runs a command as the user: the entry appears, its output streams line by line, then it finishes. `exit N`
    /// (or `false`) fails with that code.
    private func runOnVm(_ key: String, command: String) async throws -> JSONValue {
        var activity = VmActivity(id: nextActivityId(key), at: .nowMs, actor: "user", kind: "exec", title: command, status: "running", exitCode: nil, output: "")
        setVmActivity(key, vmActivity(key) + [activity])
        broadcastActivity(key, activity)
        updateVm(key) { $0.busy = true }

        let (lines, exitCode) = Self.output(for: command)
        var output = ""
        for line in lines {
            try? await Task.sleep(for: self.vmStep)
            let chunk = line + "\n"
            output += chunk
            broadcast(["type": "dex.vm.output", "sessionId": .null, "vmKey": .string(key), "id": .number(Double(activity.id)), "data": .string(chunk)], sessionId: nil)
        }
        activity.status = exitCode == 0 ? "done" : "error"
        activity.exitCode = exitCode
        activity.output = output
        setVmActivity(key, vmActivity(key).map { $0.id == activity.id ? activity : $0 })
        broadcastActivity(key, activity)
        updateVm(key) { $0.busy = false; $0.lastActiveAt = .nowMs }
        return ["exitCode": .number(Double(exitCode)), "output": .string(output)]
    }

    nonisolated static func output(for command: String) -> (lines: [String], exitCode: Int) {
        let trimmed = command.trimmingCharacters(in: .whitespaces)
        if trimmed == "false" { return ([], 1) }
        if trimmed.hasPrefix("exit "), let code = Int(trimmed.dropFirst(5)) { return (["exiting with \(code)"], code) }
        if trimmed.hasPrefix("echo ") { return ([String(trimmed.dropFirst(5))], 0) }
        switch trimmed {
        case "ls", "ls ~/work": return (["dex", "notes.md"], 0)
        case "pwd": return (["/home/user"], 0)
        default: return (["$ \(trimmed)", "step 1 of 3: preparing", "step 2 of 3: working", "step 3 of 3: done"], 0)
        }
    }

    // MARK: Peeks and the desktop

    /// The chat's VM files (`vmFiles`): ~/work/dex with a src folder, two changed files, and a new one.
    nonisolated static func files(view: String, path raw: String) throws -> JSONValue {
        let home = "/home/dex"
        let path = raw == "~/work" || raw == "~" ? home + "/work" : raw.replacingOccurrences(of: "~", with: home)
        let now = Double.nowMs
        let tree: [String: [VmFsEntry]] = [
            "\(home)/work": [VmFsEntry(path: "\(home)/work/dex", name: "dex", directory: true, modifiedAt: now - 600_000)],
            "\(home)/work/dex": [
                VmFsEntry(path: "\(home)/work/dex/src", name: "src", directory: true, modifiedAt: now - 600_000),
                VmFsEntry(path: "\(home)/work/dex/README.md", name: "README.md", directory: false, size: 412, modifiedAt: now - 86_400_000),
                VmFsEntry(path: "\(home)/work/dex/notes.md", name: "notes.md", directory: false, size: 96, modifiedAt: now - 120_000),
                VmFsEntry(path: "\(home)/work/dex/package.json", name: "package.json", directory: false, size: 2_140, modifiedAt: now - 3_600_000)
            ],
            "\(home)/work/dex/src": [
                VmFsEntry(path: "\(home)/work/dex/src/dates.ts", name: "dates.ts", directory: false, size: 380, modifiedAt: now - 900_000),
                VmFsEntry(path: "\(home)/work/dex/src/dates.test.ts", name: "dates.test.ts", directory: false, size: 512, modifiedAt: now - 300_000)
            ]
        ]
        let changes = [
            VmFsChange(status: "modified", path: "\(home)/work/dex/src/dates.test.ts"),
            VmFsChange(status: "modified", path: "\(home)/work/dex/src/dates.ts"),
            VmFsChange(status: "untracked", path: "\(home)/work/dex/notes.md")
        ]
        let dates = "export function formatDate(date: Date): string {\n  return date.toISOString().slice(0, 10)\n}\n\nexport function midnight(date: Date): Date {\n  const copy = new Date(date)\n  copy.setUTCHours(0, 0, 0, 0)\n  return copy\n}\n"
        let datesBefore = dates.replacingOccurrences(of: "setUTCHours", with: "setHours")
        let test = "import { formatDate, midnight } from \"./dates\"\n\nprocess.env.TZ = \"UTC\"\n\ntest(\"formats midnight\", () => {\n  expect(formatDate(midnight(new Date(\"2026-10-19T23:30:00Z\")))).toBe(\"2026-10-19\")\n})\n"
        let testBefore = test.replacingOccurrences(of: "process.env.TZ = \"UTC\"\n\n", with: "")
        switch view {
        case "directory":
            guard let entries = tree[path] else { throw AgentError.remote("No such folder: \(path)") }
            return try JSONValue(encoding: VmDirectory(path: path, parent: (path as NSString).deletingLastPathComponent, entries: entries))
        case "changes":
            return try JSONValue(encoding: VmChanges(path: path, repositories: path.hasPrefix(home + "/work") ? [home + "/work/dex"] : [], changes: changes.filter { $0.path.hasPrefix(path) }))
        default:
            switch (path as NSString).lastPathComponent {
            case "dates.ts": return try JSONValue(encoding: VmFile(path: path, size: dates.utf8.count, content: dates, before: datesBefore, change: "modified"))
            case "dates.test.ts": return try JSONValue(encoding: VmFile(path: path, size: test.utf8.count, content: test, before: testBefore, change: "modified"))
            case "notes.md": return try JSONValue(encoding: VmFile(path: path, size: 96, content: "# Notes\n\n- The date test depends on the time zone.\n", change: "untracked"))
            case "package.json": return try JSONValue(encoding: VmFile(path: path, size: 2_140, content: "{\n  \"name\": \"dex\",\n  \"private\": true\n}\n"))
            default: return try JSONValue(encoding: VmFile(path: path, size: 412, content: "# dex\n\nA personal agent harness.\n"))
            }
        }
    }

    nonisolated static func peek(view: String, path: String) -> JSONValue {
        let now = Double.nowMs
        switch view {
        case "files":
            let entries: [JSONValue] = path.hasSuffix("dex")
                ? [
                    ["name": "src", "type": "dir", "size": 4096, "modifiedAt": .number(now - 600_000)],
                    ["name": "package.json", "type": "file", "size": 2_140, "modifiedAt": .number(now - 3_600_000)],
                    ["name": "README.md", "type": "file", "size": 8_420, "modifiedAt": .number(now - 86_400_000)]
                ]
                : [
                    ["name": "dex", "type": "dir", "size": 4096, "modifiedAt": .number(now - 600_000)],
                    ["name": "notes.md", "type": "file", "size": 312, "modifiedAt": .number(now - 7_200_000)],
                    ["name": "latest", "type": "link", "size": 9, "modifiedAt": .number(now - 7_200_000)]
                ]
            return ["running": true, "status": "running", "view": "files", "path": .string(path), "entries": .array(entries)]
        case "file":
            return ["running": true, "status": "running", "view": "file", "path": .string(path),
                    "content": .string("# Notes\n\n- The date test depends on the time zone.\n- Pinned TZ=UTC in the test setup.\n")]
        case "ports":
            return ["running": true, "status": "running", "view": "ports", "ports": [
                ["port": 3000, "address": "0.0.0.0:3000", "process": "node"],
                ["port": 8082, "address": "*:8082", "process": "selkies"]
            ]]
        case "processes":
            return ["running": true, "status": "running", "view": "processes", "processes": [
                ["pid": 2201, "cpu": 38.5, "memory": 6.2, "seconds": 312, "command": "node"],
                ["pid": 981, "cpu": 12.0, "memory": 3.1, "seconds": 1_800, "command": "selkies"],
                ["pid": 1, "cpu": 0.1, "memory": 0.4, "seconds": 3_600, "command": "systemd"]
            ]]
        case "git":
            return ["running": true, "status": "running", "view": "git", "path": .string(path), "repo": true, "branch": "fix/dates-timezone", "tracking": "origin/fix/dates-timezone",
                    "changes": [["status": "M", "path": "src/dates.test.ts"], ["status": "??", "path": "notes.md"]],
                    "commits": [
                        ["hash": "a1b2c3d", "author": "Dex", "at": .number(now - 900_000), "subject": "Pin the date tests to UTC"],
                        ["hash": "9f8e7d6", "author": "octocat", "at": .number(now - 86_400_000), "subject": "Add date formatting"]
                    ]]
        default:
            return ["running": true, "status": "running", "view": .string(view)]
        }
    }

    /// A tiny desktop-like page for the web view (there's no real VM): a panel, a terminal window, and a clock.
    nonisolated static func desktopPage(key: String, mode: String) -> String {
        let html = """
        <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock desktop</title>
        <style>
        html,body{margin:0;height:100%;font:14px -apple-system,system-ui,sans-serif;color:#e4e4e7;overflow:hidden}
        body{background:linear-gradient(135deg,#0f172a,#1e3a5f 55%,#0e7490)}
        .bar{height:26px;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:space-between;padding:0 10px;font-size:12px}
        .win{position:absolute;left:8%;top:18%;width:60%;height:58%;background:#18181b;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.5);overflow:hidden}
        .title{background:#27272a;padding:6px 10px;font-size:12px;color:#a1a1aa}
        pre{margin:0;padding:10px;font:12px ui-monospace,Menlo,monospace;color:#86efac}
        </style></head><body>
        <div class="bar"><span>Activities</span><span id="clock"></span><span>\(mode)</span></div>
        <div class="win"><div class="title">Terminal — \(key)</div><pre>user@dex:~/work$ npm test\nPASS src/dates.test.ts\nTests: 42 passed\nuser@dex:~/work$ ▍</pre></div>
        <script>setInterval(function(){document.getElementById('clock').textContent=new Date().toLocaleTimeString()},500)</script>
        </body></html>
        """
        return "data:text/html;base64," + Data(html.utf8).base64EncodedString()
    }
}
