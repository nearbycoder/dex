import {
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  Bug,
  Calendar,
  ChartColumn,
  Code,
  Database,
  FileText,
  GitPullRequest,
  Globe,
  Lightbulb,
  type LucideIcon,
  Mail,
  MessagesSquare,
  Palette,
  PenLine,
  Rocket,
  SearchCode,
  ShieldCheck,
  Sparkles,
  Telescope,
  Terminal,
  Wrench
} from "lucide-react"
import { AGENT_COLORS, type AgentColor, type AgentIcon } from "~/shared/agents"

export const AGENT_ICON_COMPONENTS: Record<AgentIcon, LucideIcon> = {
  bot: Bot,
  "git-pull-request": GitPullRequest,
  "shield-check": ShieldCheck,
  "search-code": SearchCode,
  bug: Bug,
  rocket: Rocket,
  "pen-line": PenLine,
  "book-open": BookOpen,
  terminal: Terminal,
  database: Database,
  globe: Globe,
  telescope: Telescope,
  chart: ChartColumn,
  brain: Brain,
  wrench: Wrench,
  palette: Palette,
  lightbulb: Lightbulb,
  mail: Mail,
  calendar: Calendar,
  briefcase: Briefcase,
  messages: MessagesSquare,
  code: Code,
  "file-text": FileText,
  sparkles: Sparkles
}

/**
 * An agent's icon on its color: a rounded tile sized by `size` (px). With `image` (a project's picture, a data: URL),
 * the picture on a dark tile instead.
 */
export function AgentAvatar({
  icon,
  color,
  image,
  size = 32,
  className = ""
}: {
  icon: AgentIcon
  color: AgentColor
  image?: string | null
  size?: number
  className?: string
}) {
  if (image) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden bg-zinc-900 ring-1 ring-zinc-800 ring-inset ${className}`}
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), padding: Math.max(1, Math.round(size * 0.14)) }}
      >
        <img src={image} alt="" className="size-full object-contain" draggable={false} />
      </span>
    )
  }
  const Icon = AGENT_ICON_COMPONENTS[icon] ?? Bot
  const [background, foreground] = AGENT_COLORS[color] ?? AGENT_COLORS.emerald
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), background, color: foreground }}
    >
      <Icon style={{ width: size * 0.56, height: size * 0.56 }} strokeWidth={2} />
    </span>
  )
}
