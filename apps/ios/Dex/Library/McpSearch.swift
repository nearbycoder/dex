import DexCore
import SwiftUI

/// Find MCP servers on Smithery (the default: fast, with use counts) or the official MCP Registry. Opening a result runs
/// Dex's checks on it before you add it.
struct McpSearchView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var query = ""
    @State private var source = "smithery"
    @State private var results: [RegistryServer] = []
    @State private var searched = ""
    @State private var loading = false
    @State private var error: String?
    @State private var checking: RegistryServer?
    @State private var adding: McpPrefill?

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces)
        let servers = client.state?.mcp ?? []
        let addedUrls = Set(servers.map { $0.url.trimmingSuffix("/") })
        List {
            Section {
                Picker("Source", selection: $source) {
                    Text("Smithery").tag("smithery")
                    Text("Official Registry").tag("registry")
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
                .accessibilityIdentifier("mcp.source")
            } footer: {
                Text(source == "smithery"
                     ? "Smithery hosts these: you sign in through Smithery and requests pass through it. The official registry has publishers' own endpoints."
                     : "The registry verifies who published a server, not the server itself: open one to check it.")
            }

            if q.count < 2 {
                let unused = McpTemplate.all.filter { template in !servers.contains { $0.url == template.url } }
                if !unused.isEmpty {
                    Section("Popular Servers") {
                        ForEach(unused) { template in
                            Button { adding = McpPrefill(template: template) } label: { McpTemplateRow(template: template) }
                                .tint(.primary)
                                .accessibilityIdentifier("mcp.template.\(template.id)")
                        }
                    }
                }
            } else if let error {
                ContentUnavailableView("Search Failed", systemImage: "exclamationmark.triangle", description: Text(error)).libraryEmptyRow()
            } else if results.isEmpty && loading {
                if source == "registry" {
                    Text("Searching… the official registry can take a while for a new search.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(0..<4, id: \.self) { _ in LibraryRowSkeleton(avatar: false) }
            } else if results.isEmpty && searched == "\(source):\(q)" {
                ContentUnavailableView("No Servers", systemImage: "magnifyingglass", description: Text("No remote servers named like “\(q)”.")).libraryEmptyRow()
            } else {
                Section("Results") {
                    ForEach(results) { server in
                        Button { checking = server } label: {
                            RegistryRow(server: server, added: !server.url.isEmpty && addedUrls.contains(server.url.trimmingSuffix("/")))
                        }
                        .tint(.primary)
                        .accessibilityIdentifier("mcp.result.\(server.name)")
                    }
                }
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search for an MCP server")
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .navigationTitle("Find Servers")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if loading { ToolbarItem(placement: .primaryAction) { ProgressView() } }
        }
        .task(id: "\(source):\(q)") { await search(q) }
        .sheet(item: $checking) { server in
            McpCheckSheet(server: server, addedUrls: addedUrls) { id in
                checking = nil
                router.open(.mcpServer(id), compact: sizeClass == .compact)
            }
        }
        .sheet(item: $adding) { prefill in
            NavigationStack {
                McpServerEditor(existing: nil, prefill: prefill) { id in
                    adding = nil
                    router.open(.mcpServer(id), compact: sizeClass == .compact)
                } onCancel: { adding = nil }
            }
        }
        .accessibilityIdentifier("mcp.searchPage")
    }

    private func search(_ q: String) async {
        guard q.count >= 2 else { results = []; error = nil; return }
        loading = true
        results = []
        try? await Task.sleep(for: .milliseconds(source == "registry" ? 450 : 250))
        guard !Task.isCancelled else { return }
        defer { loading = false }
        do {
            let found = try await client.searchMcpRegistry(q, source: source)
            guard !Task.isCancelled else { return }
            results = found
            error = nil
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
        searched = "\(source):\(q)"
    }
}

private extension String {
    func trimmingSuffix(_ suffix: String) -> String { hasSuffix(suffix) ? String(dropLast(suffix.count)) : self }
}

private struct RegistryRow: View {
    let server: RegistryServer
    let added: Bool

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 5) {
                    Text(server.title).font(.body.weight(.medium)).foregroundStyle(.primary).lineLimit(1)
                    if server.verified == true {
                        Image(systemName: "checkmark.seal.fill").font(.caption).foregroundStyle(.green).accessibilityLabel("Verified by Smithery")
                    }
                    if server.needsKey { Tag(text: "API key") }
                    if server.transport == "sse" { Tag(text: "SSE") }
                    if server.transport == "stdio" { Tag(text: "Runs on VM") }
                    if server.templated { Tag(text: "Needs setup") }
                }
                Text(server.name).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
                if !server.description.isEmpty {
                    Text(server.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: 4)
            if added {
                Label("Added", systemImage: "checkmark").font(.caption).foregroundStyle(.green)
            } else if let uses = server.uses {
                Text("\(Skills.formatInstalls(uses)) uses").font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .contentShape(.rect)
    }
}

/// A registry result checked before adding it: secure endpoint, publisher, domain, a live handshake, its tools, and
/// its source repo's health. "Add Server" opens the editor filled in from what the server answered.
struct McpCheckSheet: View {
    @Environment(DexClient.self) private var client
    @Environment(\.dismiss) private var dismiss
    let server: RegistryServer
    let addedUrls: Set<String>
    let onAdded: (String) -> Void
    @State private var report: McpCheckReport?
    @State private var error: String?
    @State private var prefill: McpPrefill?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) {
                            Text(server.title).font(.title2.bold())
                            if server.verified == true { Image(systemName: "checkmark.seal.fill").foregroundStyle(.green).accessibilityLabel("Verified by Smithery") }
                        }
                        Text(server.name).font(.caption.monospaced()).foregroundStyle(.secondary)
                        if !server.description.isEmpty { Text(server.description).font(.subheadline) }
                        HStack(spacing: 10) {
                            if let uses = server.uses { Label("\(Skills.formatInstalls(uses)) uses", systemImage: "person.2").labelStyle(.compact) }
                            if !server.version.isEmpty { Text("v\(server.version)") }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        if let url = report?.url ?? (server.url.isEmpty ? nil : server.url), !url.isEmpty {
                            Text(url).font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section {
                    if let error {
                        FieldProblem(text: error)
                    } else if let report {
                        ForEach(report.checks) { check in CheckRow(check: check) }
                    } else {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Checking it: connecting, reading its sign-in and tools, looking at its source…").font(.footnote).foregroundStyle(.secondary)
                        }
                        .accessibilityIdentifier("mcp.checking")
                    }
                } header: {
                    Text("Checks")
                }

                if let report, !report.tools.isEmpty {
                    Section("Tools") {
                        FlowTags(items: Array(report.tools.prefix(24)), more: max(0, report.tools.count - 24))
                    }
                }

                if let report {
                    Section {
                        if let run = server.run {
                            Button {
                                prefill = McpPrefill(name: server.title, command: run.command, env: run.env.map(\.name))
                            } label: {
                                Label("Add to Run on a VM", systemImage: "plus").frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.glassProminent)
                            .accessibilityIdentifier("mcp.check.add")
                        } else if !report.url.isEmpty || !server.url.isEmpty {
                            let url = report.url.isEmpty ? server.url : report.url
                            if addedUrls.contains(url.hasSuffix("/") ? String(url.dropLast()) : url) {
                                Label("Already added", systemImage: "checkmark").foregroundStyle(.green)
                            } else {
                                Button {
                                    prefill = McpPrefill(name: server.title, url: url, auth: report.auth,
                                                         header: report.header ?? server.headers.first { $0.required }?.name,
                                                         headerPlaceholder: server.headers.first { $0.required }?.value)
                                } label: {
                                    Label(report.failed ? "Add Anyway" : "Add Server", systemImage: "plus").frame(maxWidth: .infinity)
                                }
                                .buttonStyle(report.failed ? AnyPrimitiveButtonStyle(.glass) : AnyPrimitiveButtonStyle(.glassProminent))
                                .accessibilityIdentifier("mcp.check.add")
                            }
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
            }
            .navigationTitle("Check Server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }.accessibilityIdentifier("mcp.check.close")
                }
            }
            .navigationDestination(item: $prefill) { prefill in
                McpServerEditor(existing: nil, prefill: prefill) { id in onAdded(id) } onCancel: { self.prefill = nil }
            }
            .task {
                do { report = try await client.checkMcpServer(server) } catch { self.error = error.localizedDescription }
            }
        }
        .presentationDetents([.large])
    }
}

private struct CheckRow: View {
    let check: McpCheck

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: symbol)
                .foregroundStyle(color)
                .frame(width: 20)
                .accessibilityLabel(check.status)
            VStack(alignment: .leading, spacing: 2) {
                Text(check.label).font(.subheadline.weight(.medium))
                Text(check.detail).font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("mcp.check.\(check.id)")
    }

    private var symbol: String {
        switch check.status {
        case "pass": "checkmark.circle.fill"
        case "warn": "exclamationmark.triangle.fill"
        case "fail": "xmark.octagon.fill"
        default: "info.circle"
        }
    }

    private var color: Color {
        switch check.status {
        case "pass": .green
        case "warn": .orange
        case "fail": .red
        default: .secondary
        }
    }
}

/// Tool names as wrapping chips.
private struct FlowTags: View {
    let items: [String]
    let more: Int

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(items, id: \.self) { item in
                Text(item)
                    .font(.caption.monospaced())
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Color(.tertiarySystemFill), in: .capsule)
            }
            if more > 0 { Text("+\(more) more").font(.caption).foregroundStyle(.secondary).padding(.vertical, 3) }
        }
        .padding(.vertical, 4)
    }
}

/// Lays children out in rows, wrapping at the available width.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.last.map { $0.y + $0.height } ?? 0
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(width: bounds.width, subviews: subviews) {
            for (index, x) in zip(row.indices, row.xs) {
                subviews[index].place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + row.y), proposal: .unspecified)
            }
        }
    }

    private struct Row { var indices: [Int] = []; var xs: [CGFloat] = []; var y: CGFloat = 0; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(.unspecified)
            if rows[rows.count - 1].width + size.width > width, !rows[rows.count - 1].indices.isEmpty {
                let last = rows[rows.count - 1]
                rows.append(Row(y: last.y + last.height + spacing))
            }
            var row = rows[rows.count - 1]
            row.xs.append(row.width)
            row.indices.append(index)
            row.width += size.width + spacing
            row.height = max(row.height, size.height)
            rows[rows.count - 1] = row
        }
        return rows
    }
}

/// Either of two button styles, picked at runtime.
struct AnyPrimitiveButtonStyle: PrimitiveButtonStyle {
    private let make: (Configuration) -> AnyView
    init<S: PrimitiveButtonStyle>(_ style: S) { make = { AnyView(style.makeBody(configuration: $0)) } }
    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}
