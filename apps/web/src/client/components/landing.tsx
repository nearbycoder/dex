import {
  ArrowRight,
  BellRing,
  Bot,
  Boxes,
  Brain,
  CalendarClock,
  ChartColumn,
  Check,
  Clapperboard,
  Cloud,
  Command,
  Cpu,
  GitPullRequest,
  Inbox,
  KeyRound,
  Layers,
  ListOrdered,
  LockKeyhole,
  type LucideIcon,
  MonitorPlay,
  Play,
  Plug,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TabletSmartphone,
  Workflow
} from "lucide-react"
import type { ReactNode } from "react"
import { MODEL_MAKERS, MODELS, type ModelMaker } from "~/shared/models"
import { GitHubMark } from "./github-mark"

/**
 * The page signed-out visitors see at /: what Dex is and everything it does, shown with the app's own screenshots
 * (public/landing, made from docs/screenshots). Rendered on the server, with no data of anyone's in it.
 */

const REPO = "https://github.com/nearbycoder/dex"

/** The model families in the catalog, by the name people know them by. */
const FAMILIES: ReadonlyArray<readonly [ModelMaker, string]> = [
  ["anthropic", "Claude"],
  ["openai", "GPT"],
  ["google", "Gemini"],
  ["xai", "Grok"],
  ["deepseek", "DeepSeek"],
  ["qwen", "Qwen"],
  ["moonshot", "Kimi"],
  ["zai", "GLM"],
  ["minimax", "MiniMax"],
  ["xiaomi", "MiMo"],
  ["meta", "Llama"],
  ["meituan", "LongCat"],
  ["tencent", "Hunyuan"],
  ["stepfun", "Step"]
]
const families = FAMILIES.filter(([maker]) => MODELS.some((model) => model.maker === maker))

export function Landing() {
  return (
    <div className="relative min-h-full overflow-x-clip bg-zinc-950 text-zinc-100 selection:bg-emerald-500/30">
      <Nav />
      <main>
        <Hero />
        <ModelStrip />
        <Showcase />
        <MoreFeatures />
        <Phone />
        <NativeApps />
        <Tour />
        <Security />
        <BuiltOn />
        <Closing />
      </main>
      <Footer />
    </div>
  )
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

const button = {
  primary:
    "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-100 sm:w-auto px-5 py-3 text-sm font-semibold text-zinc-950 shadow-[0_8px_30px_-8px_rgba(16,185,129,0.6)] transition hover:bg-white",
  secondary:
    "inline-flex w-full items-center justify-center gap-2 rounded-xl border sm:w-auto border-zinc-700/80 bg-zinc-900/60 px-5 py-3 text-sm font-semibold text-zinc-100 backdrop-blur transition hover:border-zinc-600 hover:bg-zinc-800/80"
}

/** A screenshot in a window frame. */
function Frame({ src, alt, priority = false, className = "" }: { src: string; alt: string; priority?: boolean; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-zinc-900/70 p-1.5 shadow-2xl shadow-black/60 ring-1 ring-black/40 ${className}`}>
      <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2" aria-hidden="true">
        <span className="size-2.5 rounded-full bg-zinc-700" />
        <span className="size-2.5 rounded-full bg-zinc-700" />
        <span className="size-2.5 rounded-full bg-zinc-700" />
      </div>
      <img
        src={src}
        alt={alt}
        width={1280}
        height={800}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        className="block h-auto w-full rounded-xl"
      />
    </div>
  )
}

/** A phone screenshot in a phone frame. */
function PhoneFrame({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`rounded-[2.4rem] border border-zinc-700/70 bg-zinc-900 p-2 shadow-2xl shadow-black/70 ring-1 ring-black/50 ${className}`}>
      <img src={src} alt={alt} width={786} height={1704} loading="lazy" decoding="async" className="block h-auto w-full rounded-[1.9rem]" />
    </div>
  )
}

function Eyebrow({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-400">
      <Icon className="size-4" aria-hidden="true" />
      {children}
    </p>
  )
}

function SectionHeading({ eyebrow, icon, title, children }: { eyebrow: string; icon: LucideIcon; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="dex-reveal mx-auto max-w-2xl text-center">
      <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {children && <p className="mt-4 text-base text-pretty text-zinc-400 sm:text-lg">{children}</p>}
    </div>
  )
}

/** The emerald glow and fading grid behind the hero (and the closing call to action). */
function Backdrop({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 -z-10 ${className}`}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(16,185,129,0.22),transparent_70%)]" />
      <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_10%,black,transparent_75%)] bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:48px_48px]" />
    </div>
  )
}

/* ── Sections ───────────────────────────────────────────────────────────── */

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-zinc-950/70 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5 sm:px-8" aria-label="Main">
        <a href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <img src="/favicon.svg" alt="" width={28} height={28} className="size-7" />
          <span className="text-lg">Dex</span>
        </a>
        <div className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">
          <a href="#features" className="transition hover:text-zinc-100">
            Features
          </a>
          <a href="#apps" className="transition hover:text-zinc-100">
            Mobile apps
          </a>
          <a href="#tour" className="transition hover:text-zinc-100">
            Tour
          </a>
          <a href="#security" className="transition hover:text-zinc-100">
            Security
          </a>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <a href={REPO} className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-900 hover:text-white sm:inline-flex">
            <GitHubMark /> GitHub
          </a>
          <a href="/login" className="rounded-lg bg-zinc-100 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-white">
            Sign in
          </a>
        </div>
      </nav>
    </header>
  )
}

const HERO_POINTS = ["Generative UI", `${MODELS.length} models`, "A cloud VM per chat", "Skills", "Any MCP server", "iOS and Android apps"]

function Hero() {
  return (
    <section className="relative isolate px-5 pt-16 pb-20 sm:px-8 sm:pt-24 lg:pb-28">
      <Backdrop />
      <div className="mx-auto max-w-4xl text-center">
        <a
          href={REPO}
          className="animate-rise inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-medium text-emerald-300 transition hover:border-emerald-400/40"
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          Open source · Runs on your Cloudflare account
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </a>
        <img
          src="/favicon.svg"
          alt=""
          width={80}
          height={80}
          className="animate-rise mx-auto mt-10 size-16 drop-shadow-[0_12px_40px_rgba(16,185,129,0.55)] sm:size-20"
        />
        <h1 className="animate-rise mt-8 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Your personal AI agent,
          <span className="block bg-gradient-to-r from-emerald-300 via-emerald-400 to-teal-300 bg-clip-text pb-1 text-transparent">
            with a computer of its own.
          </span>
        </h1>
        <p className="animate-rise mx-auto mt-6 max-w-2xl text-base text-pretty text-zinc-400 sm:text-lg">
          Dex thinks with the models you choose, answers with live charts, tables, and forms, and does real work on its own
          cloud VM, where you can watch every click and command, or take over. On your computer and on your phone.
        </p>
        <div className="animate-rise mt-9 mx-auto flex max-w-xs flex-col items-center justify-center gap-3 sm:max-w-none sm:flex-row">
          <a href="/login" className={button.primary}>
            Sign in <ArrowRight className="size-4" aria-hidden="true" />
          </a>
          <a href={`${REPO}#deploy`} className={button.secondary}>
            <GitHubMark /> Deploy your own
          </a>
        </div>
        <ul className="animate-rise mt-8 flex flex-wrap items-center justify-center gap-2" aria-label="Highlights">
          {HERO_POINTS.map((point) => (
            <li key={point} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-300">
              <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
              {point}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative mx-auto mt-16 max-w-6xl sm:mt-20">
        <div aria-hidden="true" className="absolute inset-x-10 top-10 bottom-0 -z-10 rounded-[3rem] bg-emerald-500/20 blur-3xl" />
        <Frame
          priority
          src="/landing/vm-preview.webp"
          alt="A Dex chat answering with a revenue chart card, with a floating live preview of its VM's desktop"
          className="animate-rise"
        />
        <PhoneFrame
          src="/landing/mobile-chart.webp"
          alt="Dex on a phone showing a chart card"
          className="animate-rise absolute -bottom-10 -left-4 hidden w-[17%] min-w-36 -rotate-3 md:block lg:-left-10"
        />
      </div>
    </section>
  )
}

function ModelStrip() {
  return (
    <section className="border-y border-white/5 bg-zinc-900/30 px-5 py-12 sm:px-8">
      <div className="mx-auto max-w-6xl text-center">
        <p className="text-sm text-zinc-400">
          <span className="font-medium text-zinc-200">{MODELS.length} models</span> through{" "}
          <span className="font-medium text-zinc-200">ClinePass</span> and <span className="font-medium text-zinc-200">OpenCode Go</span>, in one menu
        </p>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          {families.map(([maker, family]) => (
            <li key={maker} className="flex items-center gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-300">
              <img src={MODEL_MAKERS[maker].logo} alt="" width={16} height={16} className={`size-4 object-contain ${maker === "meituan" ? "invert" : ""}`} />
              {family}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

type Feature = {
  readonly icon: LucideIcon
  readonly eyebrow: string
  readonly title: string
  readonly body: string
  readonly points: ReadonlyArray<string>
  readonly image: string
  readonly alt: string
}

const SHOWCASE: ReadonlyArray<Feature> = [
  {
    icon: ChartColumn,
    eyebrow: "Generative UI",
    title: "Answers you can see, not just read.",
    body: "Ask for numbers and get a chart. Ask for a plan and get a card. Dex answers with live UI that streams in as the model writes it.",
    points: ["Cards, stat tiles, tables, charts, and forms", "One tidy row per reply folds the thinking and tool calls", "Replies survive restarts, evictions, and deploys"],
    image: "/landing/chat-chart.webp",
    alt: "A chat answering with a weekly signups bar chart and stat tiles"
  },
  {
    icon: MonitorPlay,
    eyebrow: "A cloud VM for every chat",
    title: "A real computer, the moment it needs one.",
    body: "When a chat needs to run code, browse, or build, it gets its own Ubuntu VM with Docker, Node, Python, Chrome, and a desktop. Plain questions never start one.",
    points: [
      "Watch the desktop and every command live, or take control",
      "Computer use: clicks, typing, and a fresh screenshot in one step",
      "A floating preview while you chat; streams on iPhone too",
      "Stops when idle and keeps its disk"
    ],
    image: "/landing/machine.webp",
    alt: "The Machine page with the VM's live desktop and an activity log of commands"
  },
  {
    icon: Brain,
    eyebrow: "Models",
    title: "Two subscriptions. One searchable menu.",
    body: "Connect ClinePass, OpenCode Go, or both. Pick a model and thinking level per chat; free models and ones that train on your prompts are clearly marked.",
    points: ["GLM, Kimi, DeepSeek, Qwen, Claude, GPT, Grok, Gemini, and more", "Agents fall back to the subscription you have", "Each subscription's allowance and spend on the Usage page"],
    image: "/landing/models.webp",
    alt: "The model menu with All, ClinePass, and OpenCode Go tabs"
  },
  {
    icon: Command,
    eyebrow: "Skills",
    title: "Skills on a keystroke.",
    body: "Type / in any message to use a skill, or find one on skills.sh and install it in place. Auto skills load themselves when a request matches.",
    points: ["Install from skills.sh or write your own", "Private repos through your GitHub connection", "Read a skill before you install it"],
    image: "/landing/skill-menu.webp",
    alt: "The slash menu in the composer listing installed skills and skills.sh results"
  },
  {
    icon: Plug,
    eyebrow: "MCP servers",
    title: "Any MCP server, checked before you add it.",
    body: "Search Smithery or the official MCP Registry. Dex checks HTTPS, the publisher, a live handshake and its tools, and the GitHub repo, then adds it in a tap.",
    points: ["Remote servers with headers or OAuth", "Local npm, PyPI, and Docker servers on their own VM", "Turn servers on per chat or per agent"],
    image: "/landing/mcp-search.webp",
    alt: "MCP search results with Dex's checks on a server"
  },
  {
    icon: GitPullRequest,
    eyebrow: "Projects, GitHub, and agents",
    title: "From a repo to a pull request.",
    body: "A project is your repos, a setup script, and notes for the model. Start a chat and its VM boots, signs in to GitHub, clones, and sets up before the agent goes to work.",
    points: ["Search every repo your GitHub connection can reach", "Agents: PR Author, PR Reviewer, Researcher, and your own", "Agents push branches and open pull requests"],
    image: "/landing/repo-picker.webp",
    alt: "Adding a repository to a project by searching GitHub"
  }
]

function Showcase() {
  return (
    <section id="features" className="scroll-mt-20 px-5 py-24 sm:px-8 sm:py-32">
      <SectionHeading eyebrow="Everything in one place" icon={Layers} title="An agent that does the work, where you can see it.">
        Chat, a computer, tools, and your code, in one app that's yours.
      </SectionHeading>
      <div className="mx-auto mt-20 max-w-6xl space-y-24 sm:space-y-32">
        {SHOWCASE.map((feature, index) => (
          <article key={feature.title} className="dex-reveal grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
            <div className={`lg:col-span-5 ${index % 2 ? "lg:order-2" : ""}`}>
              <Eyebrow icon={feature.icon}>{feature.eyebrow}</Eyebrow>
              <h3 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{feature.title}</h3>
              <p className="mt-4 text-pretty text-zinc-400">{feature.body}</p>
              <ul className="mt-6 space-y-3">
                {feature.points.map((point) => (
                  <li key={point} className="flex gap-3 text-sm text-zinc-300">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <div className={`relative lg:col-span-7 ${index % 2 ? "lg:order-1" : ""}`}>
              <div aria-hidden="true" className="absolute inset-8 -z-10 rounded-full bg-emerald-500/10 blur-3xl" />
              <Frame src={feature.image} alt={feature.alt} />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

const MORE: ReadonlyArray<{ readonly icon: LucideIcon; readonly title: string; readonly body: string }> = [
  { icon: ListOrdered, title: "Queue, edit, and steer", body: "Messages sent mid-run wait in a queue you can edit and reorder, or steer into the current run." },
  { icon: Inbox, title: "Inbox triage", body: "Settle chats you're done with, or snooze one until tonight, tomorrow, or next week." },
  { icon: KeyRound, title: "Secrets the model never sees", body: "Saved keys reach VMs as environment variables; the model only sees $NAME, and output is masked." },
  { icon: Brain, title: "Memory", body: "A MEMORY.md every chat reads, and every edit to it is shown in the chat." },
  { icon: CalendarClock, title: "Schedules", body: "One-off or recurring prompts on a cron, running while you're away." },
  { icon: Clapperboard, title: "Inline media", body: "Videos, audio, and images a chat makes play right in the conversation." },
  { icon: Bot, title: "Custom agents", body: "Presets with instructions, a model, a thinking level, and MCP servers." },
  { icon: Workflow, title: "Chats and agents can run Dex", body: "Every feature is an operation, for chats and for external agents over MCP." }
]

function MoreFeatures() {
  return (
    <section className="border-t border-white/5 px-5 py-24 sm:px-8 sm:py-32">
      <SectionHeading eyebrow="And the rest" icon={Boxes} title="The details that make it yours.">
        The small things add up to an agent you can live in every day.
      </SectionHeading>
      <div className="mx-auto mt-16 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article className="dex-reveal relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6 sm:col-span-2 lg:row-span-2">
          <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
            <ChartColumn className="size-5" aria-hidden="true" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Know what it costs</h3>
          <p className="mt-2 max-w-md text-sm text-pretty text-zinc-400">
            Tokens per model and chat across both subscriptions, your OpenCode Go allowance read live, VM time, and Cloudflare, with a daily chart.
          </p>
          <img
            src="/landing/usage.webp"
            alt="The Usage page with spend by provider and a daily chart"
            width={1280}
            height={800}
            loading="lazy"
            decoding="async"
            className="mt-6 block h-auto w-full rounded-xl border border-white/10 shadow-xl shadow-black/50"
          />
        </article>
        {MORE.map(({ icon: Icon, title, body }) => (
          <article key={title} className="dex-reveal rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6 transition hover:border-zinc-700">
            <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <h3 className="mt-4 font-semibold">{title}</h3>
            <p className="mt-2 text-sm text-pretty text-zinc-400">{body}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

const PHONE_POINTS = [
  { icon: Smartphone, text: "Install it on your Home Screen: full screen, edge to edge, and fast to launch" },
  { icon: BellRing, text: "Push notifications for replies, schedules, and snoozed chats coming back" },
  { icon: Inbox, text: "Swipe for the sidebar, long-press a chat for its menu" },
  { icon: MonitorPlay, text: "Watch the VM's desktop on iPhone and iPad" }
]

function Phone() {
  return (
    <section id="phone" className="scroll-mt-20 overflow-hidden border-t border-white/5 px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-2">
        <div className="dex-reveal">
          <Eyebrow icon={Smartphone}>On your phone</Eyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Your agent. <span className="text-emerald-400">Everywhere you are.</span>
          </h2>
          <p className="mt-4 text-pretty text-zinc-400 sm:text-lg">
            Start something on your laptop, check on it from the couch. Dex is an installable app that feels native, with
            haptics on every tap and updates that arrive on their own.
          </p>
          <ul className="mt-8 space-y-4">
            {PHONE_POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3.5 text-sm text-zinc-300">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-emerald-400">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="pt-1.5">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="dex-reveal relative mx-auto flex w-full max-w-md justify-center">
          <div aria-hidden="true" className="absolute inset-10 -z-10 rounded-full bg-emerald-500/20 blur-3xl" />
          <PhoneFrame src="/landing/mobile-sidebar.webp" alt="The Dex sidebar on a phone, with snoozed and settled chats" className="w-[46%] translate-y-8 -rotate-6" />
          <PhoneFrame src="/landing/mobile-chart.webp" alt="A Dex chat on a phone showing a chart card" className="-ml-[8%] w-[46%] rotate-3" />
        </div>
      </div>
    </section>
  )
}

const NATIVE_APPS: ReadonlyArray<{
  readonly name: string
  readonly stack: string
  readonly src: string
  readonly alt: string
  readonly folder: string
  readonly points: ReadonlyArray<string>
}> = [
  {
    name: "iPhone and iPad",
    stack: "Swift, SwiftUI, and Liquid Glass",
    src: "/landing/ios-chat.webp",
    alt: "The Dex iPhone app: a chat with a table, a code block, and a confirmation card, above the Liquid Glass tab bar",
    folder: "apps/ios",
    points: [
      "iPhone, the foldable iPhone, and iPad, with a sidebar and split views when there's room",
      "Generated cards, tables, charts, and forms drawn with native controls",
      "The VM's live desktop, with a picture-in-picture preview while you chat",
      "Keyboard shortcuts, pointer, and multiple windows on iPad"
    ]
  },
  {
    name: "Android",
    stack: "Kotlin, Jetpack Compose, and Material 3 Expressive",
    src: "/landing/android-chat.webp",
    alt: "The Dex Android app: a chat with a live chart and table card, in Material 3",
    folder: "apps/android",
    points: [
      "Phones, tablets, flips, and book foldables like the Galaxy Z Fold, from the cover screen to the inner one",
      "Panes split at the hinge, and tabletop posture puts the VM desktop above the fold",
      "Picture-in-picture for the VM desktop, dynamic color, and predictive back",
      "ChromeOS and desktop windows, resized freely, with a hardware keyboard"
    ]
  }
]

function NativeApps() {
  return (
    <section id="apps" className="scroll-mt-20 border-t border-white/5 px-5 py-24 sm:px-8 sm:py-32">
      <SectionHeading eyebrow="Native apps" icon={TabletSmartphone} title="Native on iPhone, iPad, and Android.">
        Two open-source apps made for their platforms, talking to the same agent as the web: every chat, card, machine,
        and setting, signed in through your own Dex.
      </SectionHeading>
      <div className="mx-auto mt-16 grid max-w-5xl gap-6 md:grid-cols-2">
        {NATIVE_APPS.map(({ name, stack, src, alt, folder, points }) => (
          <article key={name} className="dex-reveal flex flex-col rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6 sm:p-8">
            <div className="relative mx-auto w-[62%] max-w-[15rem]">
              <div aria-hidden="true" className="absolute inset-6 -z-10 rounded-full bg-emerald-500/20 blur-3xl" />
              <PhoneFrame src={src} alt={alt} />
            </div>
            <h3 className="mt-8 text-lg font-semibold">{name}</h3>
            <p className="mt-1 text-sm text-emerald-400">{stack}</p>
            <ul className="mt-5 flex-1 space-y-3">
              {points.map((point) => (
                <li key={point} className="flex gap-2.5 text-sm text-pretty text-zinc-400">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
            <a
              href={`${REPO}/tree/main/${folder}`}
              className="mt-6 inline-flex items-center gap-2 self-start text-sm font-medium text-zinc-200 transition hover:text-white"
            >
              <GitHubMark /> Build it from {folder}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </a>
          </article>
        ))}
      </div>
    </section>
  )
}

function Tour() {
  return (
    <section id="tour" className="scroll-mt-20 border-t border-white/5 px-5 py-24 sm:px-8 sm:py-32">
      <SectionHeading eyebrow="The 2-minute tour" icon={Play} title="See it in action.">
        Generative UI, both subscriptions, a VM you watch while you chat, GitHub, skills, MCP, usage, and the phone apps.
      </SectionHeading>
      <div className="dex-reveal relative mx-auto mt-14 max-w-5xl">
        <div aria-hidden="true" className="absolute inset-x-10 inset-y-6 -z-10 rounded-[3rem] bg-emerald-500/15 blur-3xl" />
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl shadow-black/60">
          {/* Nothing loads until play: the tour is a few megabytes. */}
          <video
            controls
            playsInline
            preload="none"
            poster="/landing/tour-poster.webp"
            width={1280}
            height={800}
            className="block aspect-[16/10] h-auto w-full bg-zinc-950"
          >
            <source src="/tour.mp4" type="video/mp4" />
          </video>
        </div>
      </div>
    </section>
  )
}

const SECURITY: ReadonlyArray<{ readonly icon: LucideIcon; readonly title: string; readonly body: string }> = [
  { icon: LockKeyhole, title: "Encrypted at rest", body: "API keys, tokens, and secrets are AES-GCM encrypted, never sent to the browser, never returned to a chat." },
  { icon: ShieldCheck, title: "You confirm what lasts", body: "Deleting things, settings, schedules, and MCP servers wait for your tap, so a prompt-injected page can't." },
  { icon: Cloud, title: "Your account, your data", body: "Each user's agent lives in its own Durable Object on your Cloudflare account. Sign out everywhere in one tap." },
  { icon: Cpu, title: "A strict browser policy", body: "Scripts and connections only to Dex itself, and a VM can never run script on Dex's origin." }
]

function Security() {
  return (
    <section id="security" className="scroll-mt-20 border-t border-white/5 px-5 py-24 sm:px-8 sm:py-32">
      <SectionHeading eyebrow="Security" icon={ShieldCheck} title="Powerful by default. Careful by design.">
        Tools run without asking, so everything lasting or destructive waits for you.
      </SectionHeading>
      <div className="mx-auto mt-16 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SECURITY.map(({ icon: Icon, title, body }) => (
          <article key={title} className="dex-reveal rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-zinc-900/70 to-zinc-950 p-6">
            <Icon className="size-5 text-emerald-400" aria-hidden="true" />
            <h3 className="mt-4 font-semibold">{title}</h3>
            <p className="mt-2 text-sm text-pretty text-zinc-400">{body}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

const STACK = [
  { name: "Cloudflare Workers", note: "and Durable Objects" },
  { name: "Pi Durable", note: "the agent harness" },
  { name: "OpenUI", note: "generative UI" },
  { name: "boat.dev", note: "cloud VMs" },
  { name: "TanStack Start", note: "the app" },
  { name: "Effect", note: "services" }
]

function BuiltOn() {
  return (
    <section className="border-t border-white/5 px-5 py-16 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <p className="text-center text-sm text-zinc-500">Built on</p>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {STACK.map(({ name, note }) => (
            <li key={name} className="rounded-xl border border-zinc-800/70 bg-zinc-900/30 px-4 py-3 text-center">
              <p className="text-sm font-medium text-zinc-200">{name}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{note}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Closing() {
  return (
    <section className="relative isolate overflow-hidden border-t border-white/5 px-5 py-28 sm:px-8 sm:py-36">
      <Backdrop className="rotate-180" />
      <div className="dex-reveal mx-auto max-w-2xl text-center">
        <img src="/favicon.svg" alt="" width={56} height={56} className="mx-auto size-14 drop-shadow-[0_12px_40px_rgba(16,185,129,0.55)]" />
        <h2 className="mt-8 text-3xl font-semibold tracking-tight text-balance sm:text-5xl">Run your own Dex.</h2>
        <p className="mt-5 text-pretty text-zinc-400 sm:text-lg">
          Dex is open source under the MIT license. Deploy it to your Cloudflare account, invite who you like, and connect
          the subscriptions you already pay for.
        </p>
        <div className="mt-9 mx-auto flex max-w-xs flex-col items-center justify-center gap-3 sm:max-w-none sm:flex-row">
          <a href={`${REPO}#deploy`} className={button.primary}>
            <GitHubMark /> Deploy your own
          </a>
          <a href="/login" className={button.secondary}>
            Sign in <ArrowRight className="size-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-white/5 px-5 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-zinc-500 sm:flex-row">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" width={20} height={20} className="size-5" />
          <span>Dex · MIT License</span>
        </div>
        <div className="flex items-center gap-5">
          <a href={REPO} className="transition hover:text-zinc-200">
            GitHub
          </a>
          <a href={`${REPO}#readme`} className="transition hover:text-zinc-200">
            Docs
          </a>
          <a href="/login" className="transition hover:text-zinc-200">
            Sign in
          </a>
        </div>
      </div>
    </footer>
  )
}
