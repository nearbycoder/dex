import Foundation

/// The mock agent's methods for: generative UI (operations run by cards, and their saved state). It also adds a few
/// chats whose replies are richer generated UIs (a form with a password, tabs and switches, live data with a Mutation
/// that needs confirming, and a gallery of every component).
extension MockAgent {
    func installOpenUIHandlers() {
        register("uiStates") { [unowned self] args, _ in self.store["ui:\(args.string(0) ?? "")"] ?? .object([:]) }
        register("saveUiState") { [unowned self] args, _ in
            guard let session = args.string(0), let card = args.string(1) else { return .null }
            var states = self.store["ui:\(session)"] ?? .object([:])
            states[card] = args.value(2)
            self.store["ui:\(session)"] = states
            return .null
        }
        register("runUiOperation") { [unowned self] args, _ in
            let name = args.string(1) ?? ""
            let input = args.value(2)
            let confirmed = args.value(3)["confirmed"]?.bool == true
            switch name {
            case "app_list_sessions":
                return ["ok": true, "result": try JSONValue(encoding: self.state.sessions)]
            case "app_delete_sessions", "app_delete_session":
                return confirmed ? ["ok": true, "result": .null, "changed": "Deleted a chat"] : ["ok": "confirm", "summary": "Delete the chat?"]
            case "app_list_schedules":
                let all = self.store["ui:schedules"]?.array ?? []
                let repeatFilter = input["repeat"]?.string ?? "all"
                return ["ok": true, "result": .array(all.filter { repeatFilter == "all" || $0["repeat"]?.string == repeatFilter })]
            case "app_cancel_schedule":
                guard let id = input["id"]?.string, let schedule = self.store["ui:schedules"]?.array?.first(where: { $0["id"]?.string == id }) else {
                    return ["ok": false, "error": "No such schedule"]
                }
                guard confirmed else { return ["ok": "confirm", "summary": .string("Cancel the scheduled prompt “\(schedule["prompt"]?.string ?? id)”")] }
                self.store["ui:schedules"] = .array((self.store["ui:schedules"]?.array ?? []).filter { $0["id"]?.string != id })
                return ["ok": true, "result": ["cancelled": .string(id)], "changed": "Cancelled a scheduled prompt"]
            case "app_usage_report":
                return ["ok": false, "error": "Usage isn't tracked here."]
            default:
                return ["ok": false, "error": .string("Unknown operation \(name)")]
            }
        }
        installOpenUISamples()
    }

    /// The sample chats with generated UIs, older than the rest so they sit at the bottom of the inbox.
    private func installOpenUISamples() {
        let now = Double.nowMs
        store["ui:schedules"] = [
            ["id": "sch-1", "prompt": "Summarize my inbox", "repeat": "daily", "nextRunAt": .number(now + 3 * MockData.hour)],
            ["id": "sch-2", "prompt": "Check the deploy", "repeat": "hourly", "nextRunAt": .number(now + 20 * MockData.minute)],
            ["id": "sch-3", "prompt": "Weekly report", "repeat": "weekly", "nextRunAt": .number(now + 2 * MockData.day)]
        ]
        for (index, sample) in MockOpenUI.samples.enumerated() {
            let updated = now - Double(6 + index) * MockData.hour
            state.sessions.append(SessionMeta(id: sample.id, title: sample.title, model: "cline-pass/glm-5.3", thinking: "low", createdAt: updated - MockData.hour, updatedAt: updated))
            let t = updated - 10 * MockData.minute
            let call = "ui-\(sample.id)"
            entries[sample.id] = [
                EntryRecord(id: "1", kind: "pi.user", model: [.user(UserMessage(text: sample.prompt, timestamp: t))]),
                EntryRecord(id: "2", kind: "pi.assistant", model: [MockData.assistant([
                    .toolCall(.init(id: call, name: "render_ui", arguments: ["title": .string(sample.title), "code": .string(sample.code)]))
                ], at: t + 1_000, stop: "toolUse")]),
                EntryRecord(id: "3", kind: "pi.toolResult", model: [.toolResult(ToolResultMessage(toolCallId: call, toolName: "render_ui", content: [.text("Rendered.")], timestamp: t + 1_500))]),
                EntryRecord(id: "4", kind: "pi.assistant", model: [MockData.assistant([.text(sample.reply)], at: t + 2_000, duration: 1_000)])
            ]
        }
    }
}

/// Sample generated UIs (the mock's chats, previews, and tests).
public enum MockOpenUI {
    public struct Sample: Sendable {
        public let id: String
        public let title: String
        public let prompt: String
        public let code: String
        public let reply: String
    }

    public static let formChatId = "s-ui-form"
    public static let tabsChatId = "s-ui-tabs"
    public static let liveChatId = "s-ui-live"
    public static let galleryChatId = "s-ui-gallery"

    public static let samples: [Sample] = [
        Sample(id: formChatId, title: "Connect the analytics database", prompt: "Connect my analytics database.", code: formProgram, reply: "Fill this in and I'll connect it."),
        Sample(id: tabsChatId, title: "Notification preferences", prompt: "Let me pick my notification settings.", code: tabsProgram, reply: "Pick what you'd like."),
        Sample(id: liveChatId, title: "My scheduled prompts", prompt: "Show my scheduled prompts.", code: liveProgram, reply: "Here they are, live."),
        Sample(id: galleryChatId, title: "Component gallery", prompt: "Show me every component.", code: galleryProgram, reply: "That's all of them.")
    ]

    /// A form with validation and a password field (its value is kept as a secret, never sent).
    public static let formProgram = """
    root = Card([header, form])
    header = CardHeader("Connect your database", "Dex keeps the password as a secret")
    form = Form("db", buttons, [fcHost, fcUser, fcPassword, fcSsl])
    buttons = Buttons([Button("Connect", @ToAssistant("Connect the database"), "primary"), Button("Not now", @ToAssistant("Skip connecting"), "secondary")])
    fcHost = FormControl("Host", Input("host", "db.example.com", "text", {required: true}), "The server's address")
    fcUser = FormControl("User", Input("user", "postgres", "text", {required: true}))
    fcPassword = FormControl("Password", Input("password", "At least 8 characters", "password", {required: true, minLength: 8}))
    fcSsl = FormControl("SSL", Select("ssl", [SelectItem("require", "Require"), SelectItem("disable", "Disable")], "Choose", {required: true}))
    """

    /// Tabs, switches, and a $variable filter: their state is kept when you leave and come back.
    public static let tabsProgram = """
    root = Card([header, tabs])
    header = CardHeader("Notifications", "Choose what reaches you")
    tabs = Tabs([tabChannels, tabQuiet])
    tabChannels = TabItem("channels", "Channels", [channels, channelsNote])
    channels = SwitchGroup("channels", [SwitchItem("Email", "A daily digest", "email", true), SwitchItem("Push", "On this device", "push"), SwitchItem("SMS", "Only for urgent things", "sms")], "card")
    channelsNote = TextContent("Changes apply to new messages.", "small")
    tabQuiet = TabItem("quiet", "Quiet hours", [quietPick, quietText])
    $quiet = "22"
    quietPick = Select("quiet", [SelectItem("20", "From 8 PM"), SelectItem("22", "From 10 PM"), SelectItem("0", "From midnight")], null, null, $quiet)
    quietText = TextContent("Quiet from " + $quiet + ":00.")
    """

    /// Live data: a Query-driven table with a filter, a Mutation that needs confirming, and a Query that fails.
    public static let liveProgram = """
    root = Card([header, filter, tbl, actions, usageNote])
    header = CardHeader("Scheduled prompts", "Live from Dex")
    $repeat = "all"
    filter = FormControl("Show", Select("repeat", [SelectItem("all", "All"), SelectItem("daily", "Daily"), SelectItem("hourly", "Hourly")], null, null, $repeat))
    q = Query("app_list_schedules", {repeat: $repeat}, {rows: []})
    tbl = Table([Col("Prompt", q.rows.prompt), Col("Repeats", q.rows.repeat), Col("Next run", @Each(q.rows, "s", @Ago(s.nextRunAt)))])
    cancel = Mutation("app_cancel_schedule", {id: q.rows[0].id})
    actions = Buttons([Button("Cancel the first", Action([@Run(cancel), @Run(q)]), "secondary", "destructive"), Button("Refresh", @Run(q), "tertiary")])
    usage = Query("app_usage_report", {}, {total: 0})
    usageNote = TextContent("Spent this month: $" + usage.total, "small")
    """

    /// Every component in the chat library.
    public static let galleryProgram = """
    root = Card([header, intro, md, callout, tcallout, img, imgBlock, gallery, code, sep, inline, table, bar, line, area, radar, hbar, pie, radial, stacked, scatter, form, buttons, iconBtn, list, steps, tags, entity, editable, snippet, overview, context, composite, visual, tabs, sections, carousel, followups], [src1])
    header = CardHeader("Component gallery", "Every OpenUI component Dex can show")
    intro = TextContent("Charts, forms, cards, and layout, with a citation [1].", "large")
    md = MarkDownRenderer("**Markdown** with a [link](https://example.com) and `code`.", "card")
    callout = Callout("info", "Heads up", "This is a *callout*.")
    tcallout = TextCallout("success", "Saved", "Your changes were saved.")
    img = Image("A mountain lake", "https://picsum.photos/seed/dex/800/400")
    imgBlock = ImageBlock("https://picsum.photos/seed/dex2/800/400", "A forest")
    gallery = ImageGallery([{ src: "https://picsum.photos/seed/a/400/300", alt: "A" }, { src: "https://picsum.photos/seed/b/400/300", alt: "B", details: "Second" }])
    code = CodeBlock("swift", "let answer = 42")
    sep = Separator()
    inline = InlineHeader("Numbers", "This week's figures")
    table = Table([Col("Day", ["Mon", "Tue", "Wed"]), Col("Visits", [120, 180, 150], "number"), Col("Status", [Tag("Up", null, "sm", "success"), Tag("Down", null, "sm", "danger"), Tag("Flat", null, "sm", "neutral")])])
    days = ["Mon", "Tue", "Wed", "Thu"]
    bar = BarChart(days, [Series("Visits", [120, 180, 150, 210]), Series("Signups", [12, 20, 15, 30])], "grouped", "Day", "Count")
    line = LineChart(days, [Series("Visits", [120, 180, 150, 210])], "natural", "Day", "Visits")
    area = AreaChart(days, [Series("Load", [3, 5, 4, 6])], "linear")
    radar = RadarChart(["Speed", "Power", "Range", "Comfort", "Price"], [Series("Model A", [8, 6, 7, 9, 5]), Series("Model B", [6, 9, 5, 6, 8])])
    hbar = HorizontalBarChart(["Organic search", "Paid ads", "Referral"], [Series("Revenue ($k)", [82, 68, 54])], "grouped")
    pie = PieChart(["Chrome", "Safari", "Firefox"], [60, 30, 10], "donut")
    radial = RadialChart(["CPU", "Memory", "Disk"], [72, 45, 88])
    stacked = SingleStackedBarChart(["Used", "Free", "Reserved"], [60, 30, 10])
    scatter = ScatterChart([ScatterSeries("Group A", [Point(1, 2), Point(2, 4), Point(3, 5, 8)]), ScatterSeries("Group B", [Point(1, 5), Point(2, 3)])], "Height", "Weight")
    form = Form("profile", formButtons, [fcName, fcEmail, fcPassword, fcBio, fcPlan, fcDate, fcBudget, fcExtras, fcSize, fcAlerts, fcChips, fcCards])
    formButtons = Buttons([Button("Save", @ToAssistant("Save my profile"), "primary"), Button("Skip", @ToAssistant("Skip"), "secondary")], "row")
    fcName = FormControl("Name", Input("name", "Your name", "text", { required: true }), "As it appears on your ID")
    fcEmail = FormControl("Email", Input("email", "you@example.com", "email", { required: true, email: true }))
    fcPassword = FormControl("Password", Input("password", "At least 8 characters", "password", { minLength: 8 }))
    fcBio = FormControl("Bio", TextArea("bio", "A few words", 3))
    fcPlan = FormControl("Plan", Select("plan", [SelectItem("free", "Free"), SelectItem("pro", "Pro")], "Choose a plan", { required: true }))
    fcDate = FormControl("Start", DatePicker("start", "single"))
    fcBudget = FormControl("Budget", Slider("budget", "discrete", 0, 100, 10, [40], "Budget"))
    fcExtras = FormControl("Extras", CheckBoxGroup("extras", [CheckBoxItem("Backups", "Nightly backups", "backups", true), CheckBoxItem("Support", "Priority support", "support")]))
    fcSize = FormControl("Size", RadioGroup("size", [RadioItem("Small", "1 CPU", "s"), RadioItem("Large", "4 CPUs", "l")], "s"))
    fcAlerts = FormControl("Alerts", SwitchGroup("alerts", [SwitchItem("Email", "Send me email", "email", true), SwitchItem("Push", "Notify this device", "push")]))
    fcChips = FormControl("Stay", Chips("stay", "multiple", [ChipItem("hotel", "Hotel", Icon("building", "buildings")), ChipItem("camping", "Camping", Icon("tent", "nature"))], {}, ["hotel"]))
    fcCards = FormControl("Trip", OptionCards("trip", "single", [OptionCard("city", "City", "Museums and food", Icon("landmark", "buildings")), OptionCard("beach", "Beach", "Sun and sand", Icon("waves", "nature"))]))
    buttons = Buttons([Button("Open the docs", @OpenUrl("https://example.com/docs"), "secondary"), Button("Copy the id", @Copy("s-ui-gallery"), "tertiary"), Button("Delete", @ToAssistant("Delete it"), "secondary", "destructive")], "row")
    iconBtn = IconButton("Refresh", Icon("refresh-cw", "arrows"), @ToAssistant("Refresh"), "secondary", "medium", "circle")
    list = ListBlock([ListItem("First step", "Do this first", null, "Go", @ToAssistant("Tell me about the first step")), ListItem("Second step", "Then this")], "number")
    steps = Steps([StepsItem("Install", "Run `npm ci`."), StepsItem("Build", "Run `npm run build`.")])
    tags = TagBlock(["Swift", "iOS", "Charts"], "md")
    entity = EntityList([{ left: "Region", right: "eu-west" }, { left: "Price", right: "$12.00", rightVariant: "number" }], "default", { left: "Item", right: "Value" }, { left: "Total", right: "$12.00", rightVariant: "number" })
    editable = EditableTable("hosts", [{ type: "text", key: "name", header: "Name" }, { type: "number", key: "cpus", header: "CPUs" }, { type: "select", key: "tier", header: "Tier", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }], [{ id: "1", values: ["web", 2, "a"] }, { id: "2", values: ["db", 4, "b"] }])
    snippet = SnippetCardBlock([SnippetCardItem("rev", IconText(Icon("circle-dollar-sign", "finance"), "success", "m", "Revenue", "This month"), BoldText("number", "$284k", "+12%", "metric")), SnippetCardItem("users", IconText(Icon("users", "people"), "info", "m", "Users", "Active"), Text("number", "47k", "-2%", "metric"))], "grid", true, @ToAssistant("Explain this figure"))
    overview = OverviewCardBlock([OverviewCardItem("v", IconText(Icon("eye", "photography"), "neutral", "m", "Views"), MetricIndicatorInline("48.7M", "visits", { direction: "up", value: 2.5 })), OverviewCardItem("s", Text("text", "Sessions"), MetricIndicatorInline("2.1M", "sessions", { direction: "down", value: 1.2 }))], "grid")
    context = ContextCardBlock([ContextCardItem("a", "Art", "143 museums.", "gray"), ContextCardItem("b", Tag("Food", Icon("utensils", "food-beverage"), "sm", "info"), "9,000 restaurants.")], "grid", true, @ToAssistant("Tell me more"))
    composite = CompositeCardBlock([CompositeCardItem("p1", ImageText("https://picsum.photos/seed/p1/100/100", "Laptop", "Laptop", "14-inch"), [MetricIndicatorWithStrikethrough("$999", "on sale", "$1,199", { direction: "down", value: 17 }), TagBlock(["New"])], { price: BoldText("number", "$999"), button: Button("Buy", @OpenUrl("https://example.com/buy"), "primary") }), CompositeCardItem("p2", ImageTextLarge("https://picsum.photos/seed/p2/600/300", "Tablet", "Tablet", "11-inch"), [Text("text", "Light and fast.")])], "grid")
    visual = VisualCardBlock([VisualCardItem(BoldText("text", "Lisbon", "Sunny"), "lis", "https://picsum.photos/seed/lis/600/400", Tag("Trip", null, "sm", "info"), "Lisbon"), VisualCardItem(BoldText("text", "Porto", "Rain"), "opo", "https://picsum.photos/seed/opo/600/400")], "carousel")
    tabs = Tabs([TabItem("one", "First", [TextContent("The first tab.")]), TabItem("two", "Second", [TextContent("The second tab."), Accordion([AccordionItem("q1", "A question?", [TextContent("An answer.")]), AccordionItem("q2", "Another?", [TextContent("Another answer.")])])])])
    sections = SectionBlock([SectionItem("intro", "Introduction", [TextContent("Section one.")]), SectionItem("more", "More", [TextContent("Section two.")])])
    carousel = Carousel([[TextContent("Slide one")], [TextContent("Slide two")]], "card")
    followups = FollowUpBlock([FollowUpItem("Show me more"), FollowUpItem("Compare with last week")])
    src1 = { title: "Example source", sourceName: "Example", url: "https://example.com" }
    """
}
