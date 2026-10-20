import Foundation

/// The mock agent's methods for: Settings, connections, secrets, access tokens, notifications, usage, workspace files, schedules.
extension MockAgent {
    func installSettingsHandlers() {
        installSettingsFixtures()
        installConnectionHandlers()
        installSecretAndAccessHandlers()
        installPushHandlers()
        installUsageHandlers()
        installWorkspaceHandlers()
    }

    /// Extra sample data for these pages: an admin action waiting for you, a failed operation, another push device,
    /// scheduled prompts, and workspace files.
    private func installSettingsFixtures() {
        let now = Double.nowMs
        state.access.pending = [
            PendingAction(id: "pa-1", sessionId: MockData.welcomeId, operation: "app_update_settings", summary: "Change the default model to Kimi K3", createdAt: now - 4 * 60_000, status: "pending")
        ]
        state.access.audit.insert(
            AuditEntry(id: 3, at: now - 30 * 60_000, actor: "ui", actorLabel: "Site traffic this week", operation: "app_delete_session", summary: "Delete a chat", ok: false, error: "Chat not found"),
            at: 0
        )
        state.push.devices.append(PushDevice(id: "d-2", label: "iPhone · Home Screen app", kinds: ["reply", "error", "scheduled", "machine"], onlyWhenAway: false, createdAt: now - 3 * 86_400_000, lastSentAt: nil, error: "Gone: the browser unsubscribed"))
        store["schedules"] = (try? JSONValue(encoding: [
            ScheduledPrompt(id: "sch-1", prompt: "Summarize my open pull requests", sessionId: nil, when: Self.iso(now + 3_600_000 * 15), cron: "0 9 * * 1-5"),
            ScheduledPrompt(id: "sch-2", prompt: "Remind me to renew the domain", sessionId: "s-snoozed", when: Self.iso(now + 86_400_000 * 2), cron: nil)
        ])) ?? []
        let files: [(String, String, Double)] = [
            (Workspace.memory, "# Memory\n\n- Prefers concise answers.\n- Works on the **dex** repo (TypeScript, Swift).\n- Lives in Chicago.\n", now - 2 * 3_600_000),
            ("/workspace/notes/lisbon.md", "# Lisbon weekend\n\n## Saturday\n- Belém and *pastéis de nata*\n- Tram 28 to Alfama\n\n| Time | Plan |\n| --- | --- |\n| 10:00 | Brunch |\n| 19:00 | Dinner |\n", now - 86_400_000),
            ("/workspace/reports/traffic.html", "<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{font:16px -apple-system,sans-serif;padding:16px}h1{color:#059669}</style></head><body><h1 id=\"title\">Weekly traffic</h1><p>Friday was the busiest day.</p><script>document.getElementById('title').textContent += ' (live)'</script></body></html>", now - 3 * 3_600_000),
            ("/workspace/scripts/fetch.sh", "#!/bin/sh\ncurl -s https://api.example.com/weather/lisbon | jq '.temp'\n", now - 5 * 86_400_000),
            ("/workspace/data/visits.csv", "day,visits\nMon,120\nTue,180\nWed,150\n", now - 2 * 86_400_000)
        ]
        var workspace: [String: JSONValue] = [:]
        for (path, content, mtime) in files { workspace[path] = ["content": .string(content), "mtime": .number(mtime)] }
        store["workspace"] = .object(workspace)
    }

    nonisolated static func iso(_ ms: Double) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date(timeIntervalSince1970: ms / 1000))
    }

    private static func hint(_ key: String) -> String { "…" + key.suffix(4) }

    /// The mock's key check: anything with "bad" or "invalid" in it fails, as a wrong key would.
    private static func keyProblem(_ key: String, service: String) -> String? {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "Paste your \(service) API key." }
        if trimmed.lowercased().contains("bad") || trimmed.lowercased().contains("invalid") { return "\(service) didn't accept that key. Check it and try again." }
        return nil
    }

    private func installConnectionHandlers() {
        register("connectCline") { [unowned self] args, _ in
            let key = args.string(0) ?? ""
            if let problem = Self.keyProblem(key, service: "Cline") { return ["ok": false, "error": .string(problem)] }
            self.state.cline = ClineStatus(connected: true, source: "user", keyHint: Self.hint(key), verifiedAt: .nowMs)
            self.publish()
            return ["ok": true, "note": "ClinePass is active on this account."]
        }
        register("disconnectCline") { [unowned self] _, _ in
            self.state.cline = ClineStatus(connected: false)
            self.publish()
            return .null
        }
        register("connectOpenCode") { [unowned self] args, _ in
            let key = args.string(0) ?? ""
            if let problem = Self.keyProblem(key, service: "OpenCode") { return ["ok": false, "error": .string(problem)] }
            self.state.opencode = ClineStatus(connected: true, source: "user", keyHint: Self.hint(key), verifiedAt: .nowMs)
            self.publish()
            return ["ok": true]
        }
        register("disconnectOpenCode") { [unowned self] _, _ in
            self.state.opencode = ClineStatus(connected: false)
            self.publish()
            return .null
        }
        register("connectBoat") { [unowned self] args, _ in
            let key = args.string(0) ?? ""
            if let blocked = self.vmsBlockingKeyChange(), self.state.boat.connected { return ["ok": false, "error": .string(blocked)] }
            if let problem = Self.keyProblem(key, service: "boat.dev") { return ["ok": false, "error": .string(problem)] }
            self.state.boat = BoatStatus(connected: true, source: "user", keyHint: Self.hint(key))
            self.state.vmConfigured = true
            self.publish()
            return ["ok": true]
        }
        register("disconnectBoat") { [unowned self] _, _ in
            if let blocked = self.vmsBlockingKeyChange() { return ["ok": false, "error": .string(blocked)] }
            self.state.boat = BoatStatus(connected: false)
            self.state.vmConfigured = false
            self.publish()
            return ["ok": true]
        }
        register("connectGitHub") { [unowned self] args, _ in
            let token = args.string(0)?.trimmingCharacters(in: .whitespaces) ?? ""
            let via = args.string(1) == "oauth" ? "oauth" : "token"
            if token.isEmpty { return ["ok": false, "error": "Paste a GitHub personal access token."] }
            if token.lowercased().contains("bad") { return ["ok": false, "error": "GitHub didn't accept that token (401 Bad credentials)."] }
            self.state.github = GitHubStatus(connected: true, login: "octocat", via: via, oauthAvailable: self.state.github.oauthAvailable, expired: false)
            self.publish()
            return ["ok": true, "login": "octocat"]
        }
        register("disconnectGitHub") { [unowned self] _, _ in
            self.state.github = GitHubStatus(connected: false, oauthAvailable: self.state.github.oauthAvailable)
            self.publish()
            return .null
        }
        register("signOutEverywhere") { [unowned self] _, _ in
            // Like the agent: every socket closes with 4001 (after this answer, so the caller hears it).
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(50))
                self.signOutEverywhere()
            }
            return .null
        }
        register("listScheduledPrompts") { [unowned self] _, _ in self.store["schedules"] ?? [] }
        register("cancelScheduledPrompt") { [unowned self] args, _ in
            let id = args.string(0) ?? ""
            let before = self.store["schedules"]?.array ?? []
            let after = before.filter { $0["id"]?.string != id }
            self.store["schedules"] = .array(after)
            return .bool(after.count < before.count)
        }
    }

    private func vmsBlockingKeyChange() -> String? {
        let count = state.vms.filter { $0.key != VmKeys.mcp && $0.status != "none" }.count
        guard count > 0 else { return nil }
        return "Delete your \(count == 1 ? "VM" : "\(count) VMs") on the Machines page first: \(count == 1 ? "it belongs" : "they belong") to the boat.dev account you're using now."
    }

    private func installSecretAndAccessHandlers() {
        register("saveSecret") { [unowned self] args, _ in
            let key = (args.string(0) ?? "").trimmingCharacters(in: .whitespaces).uppercased()
            if let problem = SecretName.problem(key) { throw AgentError.remote(problem) }
            let value = args.string(1)
            let existing = self.state.secrets.firstIndex { $0.name == key }
            if (value ?? "").isEmpty, existing == nil { throw AgentError.remote("Enter the secret's value.") }
            if value?.contains("\n") == true { throw AgentError.remote("Values must be one line.") }
            let note = args.string(2).map { String($0.trimmingCharacters(in: .whitespaces).prefix(200)) } ?? (existing.map { self.state.secrets[$0].note } ?? "")
            let secret = SavedSecret(name: key, note: note, updatedAt: .nowMs)
            if let existing { self.state.secrets[existing] = secret } else { self.state.secrets.append(secret) }
            self.state.secrets.sort { $0.name < $1.name }
            self.publish()
            return .string(key)
        }
        register("removeSecret") { [unowned self] args, _ in
            let before = self.state.secrets.count
            self.state.secrets.removeAll { $0.name == args.string(0) }
            self.publish()
            return .bool(self.state.secrets.count < before)
        }
        register("createAccessToken") { [unowned self] args, _ in
            let label = (args.string(0) ?? "").trimmingCharacters(in: .whitespaces)
            if label.isEmpty { throw AgentError.remote("Name the token.") }
            let scope = ["read", "write", "admin"].contains(args.string(1) ?? "") ? args.string(1)! : "read"
            let now = Double.nowMs
            let days = args.value(2).number
            let token = AccessToken(id: "t-\(UUID().uuidString.prefix(6).lowercased())", label: String(label.prefix(60)), scope: scope, createdAt: now, lastUsedAt: nil, expiresAt: days.map { now + $0 * 86_400_000 })
            self.state.access.tokens.insert(token, at: 0)
            self.publish()
            return try JSONValue(encoding: CreatedAccessToken(token: token, secret: "dexk.mock\(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())"))
        }
        register("revokeAccessToken") { [unowned self] args, _ in
            self.state.access.tokens.removeAll { $0.id == args.string(0) }
            self.publish()
            return .null
        }
        register("resolvePendingAction") { [unowned self] args, _ in
            guard let index = self.state.access.pending.firstIndex(where: { $0.id == args.string(0) }) else { throw AgentError.remote("That request is gone.") }
            let approve = args.value(1).bool == true
            var action = self.state.access.pending[index]
            action.status = approve ? "approved" : "declined"
            self.state.access.pending[index] = action
            if approve {
                let id = (self.state.access.audit.map(\.id).max() ?? 0) + 1
                self.state.access.audit.insert(AuditEntry(id: id, at: .nowMs, actor: "user", actorLabel: self.state.session(action.sessionId)?.title ?? "a chat", operation: action.operation, summary: action.summary, ok: true), at: 0)
            }
            self.publish()
            return .null
        }
    }

    private func installPushHandlers() {
        register("pushSubscribe") { [unowned self] args, _ in
            let id = "d-\(UUID().uuidString.prefix(6).lowercased())"
            self.state.push.devices.append(PushDevice(id: id, label: args.string(1) ?? "Device", kinds: NotifyKinds.defaults, onlyWhenAway: true, createdAt: .nowMs))
            self.publish()
            return .string(id)
        }
        register("pushUpdate") { [unowned self] args, _ in
            guard let index = self.state.push.devices.firstIndex(where: { $0.id == args.string(0) }) else { return .null }
            let patch = args.value(1)
            if let kinds = patch["kinds"]?.array { self.state.push.devices[index].kinds = kinds.compactMap(\.string) }
            if let away = patch["onlyWhenAway"]?.bool { self.state.push.devices[index].onlyWhenAway = away }
            self.publish()
            return .null
        }
        register("pushUnsubscribe") { [unowned self] args, _ in
            self.state.push.devices.removeAll { $0.id == args.string(0) }
            self.publish()
            return .null
        }
        register("pushTest") { [unowned self] args, _ in
            guard let index = self.state.push.devices.firstIndex(where: { $0.id == args.string(0) }) else { return "That device is gone." }
            if let error = self.state.push.devices[index].error { return .string(error) }
            self.state.push.devices[index].lastSentAt = .nowMs
            self.publish()
            return .null
        }
        if handlers["setSessionMuted"] == nil {
            register("setSessionMuted") { [unowned self] args, _ in
                guard let index = self.state.sessions.firstIndex(where: { $0.id == args.string(0) }) else { return .null }
                self.state.sessions[index].muted = args.value(1).bool == true
                self.publish()
                return .null
            }
        }
    }

    private func installUsageHandlers() {
        register("usageReport") { [unowned self] args, _ in
            let range = UsageRange(rawValue: args.string(0) ?? "month") ?? .month
            try await Task.sleep(for: .milliseconds(150))
            return try JSONValue(encoding: MockUsage.report(range: range, openCodeConnected: self.state.opencode.connected))
        }
    }

    // MARK: Workspace

    private var workspaceFiles: [String: JSONValue] { store["workspace"]?.object ?? [:] }

    private func writeWorkspace(_ path: String, _ content: String) {
        var files = workspaceFiles
        files[path] = ["content": .string(content), "mtime": .number(.nowMs)]
        store["workspace"] = .object(files)
    }

    private func installWorkspaceHandlers() {
        register("listFiles") { [unowned self] _, _ in
            let files = self.workspaceFiles.map { path, record in
                WorkspaceFile(path: path, size: (record["content"]?.string ?? "").utf8.count, mtime: record["mtime"]?.number ?? 0)
            }.sorted { $0.path < $1.path }
            return try JSONValue(encoding: files)
        }
        register("readFile") { [unowned self] args, _ in
            let path = Workspace.resolve(args.string(0) ?? "")
            guard let record = self.workspaceFiles[path] else { throw AgentError.remote("No such file: \(path)") }
            let content = record["content"]?.string ?? ""
            return try JSONValue(encoding: WorkspaceFileContent(path: path, content: content, size: content.utf8.count))
        }
        register("writeFile") { [unowned self] args, _ in
            let path = Workspace.resolve(args.string(0) ?? "")
            guard path.hasPrefix(Workspace.root + "/") else { throw AgentError.remote("Paths must be inside /workspace") }
            self.writeWorkspace(path, args.string(1) ?? "")
            return .null
        }
        register("deleteFile") { [unowned self] args, _ in
            let path = Workspace.resolve(args.string(0) ?? "")
            var files = self.workspaceFiles
            let removed = files.keys.filter { $0 == path || $0.hasPrefix(path + "/") }
            for key in removed { files[key] = nil }
            self.store["workspace"] = .object(files)
            return .bool(!removed.isEmpty)
        }
        register("runCommand") { [unowned self] args, _ in
            try JSONValue(encoding: self.mockShell(args.string(0) ?? ""))
        }
    }

    /// A tiny stand-in for the workspace's simulated bash: pwd, ls, cat, echo (with `>`), and wc -l.
    private func mockShell(_ command: String) -> CommandResult {
        let words = command.split(separator: " ").map(String.init)
        guard let name = words.first else { return CommandResult(stdout: "", stderr: "", exitCode: 0) }
        let files = workspaceFiles
        switch name {
        case "pwd":
            return CommandResult(stdout: "/workspace\n", stderr: "", exitCode: 0)
        case "ls":
            let names = Set(files.keys.map { Workspace.relative($0).split(separator: "/").first.map(String.init) ?? "" }).sorted()
            return CommandResult(stdout: names.joined(separator: "\n") + "\n", stderr: "", exitCode: 0)
        case "cat" where words.count > 1:
            let path = Workspace.resolve(words[1])
            guard let content = files[path]?["content"]?.string else { return CommandResult(stdout: "", stderr: "cat: \(words[1]): No such file or directory\n", exitCode: 1) }
            return CommandResult(stdout: content, stderr: "", exitCode: 0)
        case "wc" where words.count > 2 && words[1] == "-l":
            let path = Workspace.resolve(words[2])
            guard let content = files[path]?["content"]?.string else { return CommandResult(stdout: "", stderr: "wc: \(words[2]): No such file or directory\n", exitCode: 1) }
            return CommandResult(stdout: "\(content.filter { $0 == "\n" }.count) \(words[2])\n", stderr: "", exitCode: 0)
        case "echo":
            if let arrow = words.firstIndex(of: ">"), words.indices.contains(arrow + 1) {
                writeWorkspace(Workspace.resolve(words[arrow + 1]), words[1..<arrow].joined(separator: " ") + "\n")
                return CommandResult(stdout: "", stderr: "", exitCode: 0)
            }
            return CommandResult(stdout: words.dropFirst().joined(separator: " ") + "\n", stderr: "", exitCode: 0)
        default:
            return CommandResult(stdout: "", stderr: "bash: \(name): command not found\n", exitCode: 127)
        }
    }
}

/// A realistic usage report: daily rows with every service, two subscriptions' models and chats, VM runs, Cloudflare
/// meters, and OpenCode Go's live allowance.
public enum MockUsage {
    public static func report(range: UsageRange, openCodeConnected: Bool, now: Date = .now) -> UsageReport {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let today = calendar.startOfDay(for: now)
        let start: Date = switch range {
        case .month: calendar.date(from: calendar.dateComponents([.year, .month], from: today))!
        case .days30: calendar.date(byAdding: .day, value: -29, to: today)!
        case .all: calendar.date(byAdding: .day, value: -74, to: today)!
        }
        var daily: [DailySpend] = []
        var day = start
        var index = 0
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        while day <= today {
            // Repeatable "noise" from the date, so screenshots stay the same.
            let seed = Double((calendar.ordinality(of: .day, in: .era, for: day) ?? 0) % 97)
            let weekend = calendar.isDateInWeekend(day)
            daily.append(DailySpend(
                date: formatter.string(from: day),
                cline: weekend ? 0.2 + seed.truncatingRemainder(dividingBy: 5) * 0.05 : 0.8 + seed.truncatingRemainder(dividingBy: 13) * 0.11,
                opencode: openCodeConnected ? 0.1 + seed.truncatingRemainder(dividingBy: 7) * 0.04 : 0,
                boat: weekend ? 0 : 0.02 + seed.truncatingRemainder(dividingBy: 6) * 0.015,
                cloudflare: 0.01 + seed.truncatingRemainder(dividingBy: 4) * 0.004
            ))
            day = calendar.date(byAdding: .day, value: 1, to: day)!
            index += 1
        }
        let clineCost = daily.reduce(0) { $0 + $1.cline }
        let openCost = daily.reduce(0) { $0 + $1.opencode }
        let boatCost = daily.reduce(0) { $0 + $1.boat }
        let cfCost = daily.reduce(0) { $0 + $1.cloudflare }
        let scale = Double(daily.count)
        let nowMs = now.timeIntervalSince1970 * 1000
        let hour = 3_600_000.0
        return UsageReport(
            range: range, since: start.timeIntervalSince1970 * 1000, until: nowMs,
            cline: ModelUsage(
                responses: Int(scale * 14), inputTokens: scale * 820_000, outputTokens: scale * 41_000, cacheReadTokens: scale * 510_000, totalTokens: scale * 861_000, listCost: clineCost,
                byModel: [
                    ModelUsageRow(model: "cline-pass/glm-5.3", responses: Int(scale * 9), totalTokens: scale * 560_000, listCost: clineCost * 0.55),
                    ModelUsageRow(model: "cline-pass/kimi-k3", responses: Int(scale * 4), totalTokens: scale * 250_000, listCost: clineCost * 0.38),
                    ModelUsageRow(model: "cline-pass/qwen3.8-max", responses: Int(scale), totalTokens: scale * 51_000, listCost: clineCost * 0.07)
                ],
                byChat: [
                    ChatUsageRow(sessionId: MockData.vmChatId, title: "Fix the flaky test in dex", totalTokens: scale * 420_000, listCost: clineCost * 0.48),
                    ChatUsageRow(sessionId: MockData.welcomeId, title: "Plan a weekend in Lisbon", totalTokens: scale * 190_000, listCost: clineCost * 0.2),
                    ChatUsageRow(sessionId: "s-gone", title: "Deleted chat", totalTokens: scale * 40_000, listCost: clineCost * 0.04)
                ]
            ),
            opencode: ModelUsage(
                responses: openCodeConnected ? Int(scale * 3) : 0, totalTokens: openCodeConnected ? scale * 120_000 : 0, listCost: openCost,
                byModel: openCodeConnected ? [ModelUsageRow(model: "opencode-go/glm-5.3", responses: Int(scale * 3), totalTokens: scale * 120_000, listCost: openCost)] : [],
                byChat: openCodeConnected ? [ChatUsageRow(sessionId: MockData.chartChatId, title: "Site traffic this week", totalTokens: scale * 120_000, listCost: openCost)] : [],
                connected: openCodeConnected,
                limits: openCodeConnected ? OpenCodeLimits(
                    rolling: OpenCodeWindow(percent: 34, resetsAt: MockAgent.iso(nowMs + 2.4 * hour)),
                    weekly: OpenCodeWindow(percent: 86, resetsAt: MockAgent.iso(nowMs + 60 * hour)),
                    monthly: OpenCodeWindow(percent: 41, resetsAt: MockAgent.iso(nowMs + 12 * 24 * hour))
                ) : nil
            ),
            boat: BoatUsage(
                hours: boatCost / 0.018, cost: boatCost, running: true,
                bySize: [BoatUsage.SizeRow(size: "small", hours: boatCost / 0.018 * 0.8, cost: boatCost * 0.8), BoatUsage.SizeRow(size: "default", hours: boatCost / 0.036 * 0.2, cost: boatCost * 0.2)],
                runs: [
                    BoatUsage.Run(startedAt: nowMs - 0.5 * hour, endedAt: nil, size: "small", hours: 0.5, cost: 0.009),
                    BoatUsage.Run(startedAt: nowMs - 26 * hour, endedAt: nowMs - 24.5 * hour, size: "small", hours: 1.5, cost: 0.027),
                    BoatUsage.Run(startedAt: nowMs - 50 * hour, endedAt: nowMs - 49.6 * hour, size: "default", hours: 0.4, cost: 0.0144)
                ]
            ),
            cloudflare: CloudflareUsage(
                configured: true, error: nil, since: max(start.timeIntervalSince1970 * 1000, nowMs - 31 * 24 * hour),
                lines: [
                    CloudflareLine(label: "Worker requests", quantity: scale * 21_000, unit: "requests", cost: scale * 21_000 * 0.3 / 1_000_000, allowanceUsed: range == .all ? nil : scale * 21_000 / 10_000_000),
                    CloudflareLine(label: "Worker CPU time", quantity: scale * 380_000, unit: "ms", cost: scale * 380_000 * 0.02 / 1_000_000, allowanceUsed: range == .all ? nil : scale * 380_000 / 30_000_000),
                    CloudflareLine(label: "Durable Object duration", quantity: scale * 9_000, unit: "GB-s", cost: cfCost * 0.7, allowanceUsed: range == .all ? nil : scale * 9_000 / 400_000),
                    CloudflareLine(label: "Workers AI", quantity: scale * 1_200, unit: "neurons", cost: 0, allowanceUsed: nil, accountWide: true)
                ],
                meteredCost: cfCost
            ),
            daily: daily
        )
    }
}
