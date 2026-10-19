import type { AgentColor, AgentIcon } from "./agents"
import type { VmSize } from "./protocol"

/** Where a project's repos live on a chat's VM. */
export const PROJECT_ROOT = "/home/user/work"

export interface ProjectRepo {
  /** `owner/repo` on GitHub, or any https git URL. */
  readonly url: string
  /** Branch to check out; empty for the default branch. */
  readonly branch: string
  /** Folder under ~/work; defaults to the repo's name. */
  readonly dir: string
}

/**
 * A template for work on one or more repos. Starting a chat with it gives the chat a VM with the
 * repos cloned into ~/work and the setup script run, before the model touches it.
 */
export interface ProjectProfile {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly icon: AgentIcon
  readonly color: AgentColor
  readonly repos: ReadonlyArray<ProjectRepo>
  /** Bash, run in ~/work after cloning (e.g. installing dependencies). */
  readonly setupScript: string
  /** Context for the model: architecture, conventions, how to test. */
  readonly instructions: string
  /** Prefilled in the message box when the project is picked. */
  readonly starter: string
  /** VM size for this project's chats; null uses the default from Settings. */
  readonly vmSize: VmSize | null
  /**
   * A picture from one of its repos (a favicon or logo) or the repo owner's avatar, as a data: URL, shown instead of
   * the icon. Missing on projects saved before pictures existed.
   */
  readonly image?: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

export type ProjectDraft = Omit<ProjectProfile, "id" | "createdAt" | "updatedAt"> & { readonly id?: string }

/** A picture a project can show: from one of its repo's files, or the repo owner's GitHub avatar. */
export interface ProjectImageCandidate {
  /** The file's path in the repo, or "avatar" for the owner's avatar. */
  readonly path: string
  readonly dataUrl: string
}

/** Pictures are kept small: they're synced with every project. */
export const PROJECT_IMAGE_MAX_BYTES = 48_000

/** A data: URL of a raster or SVG image, small enough to keep. (Shown with <img>, so an SVG's scripts never run.) */
export const isProjectImage = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= Math.ceil(PROJECT_IMAGE_MAX_BYTES / 3) * 4 + 40 &&
  /^data:image\/(svg\+xml|png|x-icon|vnd\.microsoft\.icon|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(value)

/** The `owner/repo` of a GitHub clone URL; null for other hosts. */
export const githubFullName = (url: string) => /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url)?.[1] ?? null

/** `owner/repo`, `github.com/owner/repo`, or a full URL, as a clone URL; null if it isn't a repo. */
export const normalizeRepoUrl = (input: string): string | null => {
  const value = input.trim().replace(/\/+$/, "")
  const shorthand = /^(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(value)
  if (shorthand && !value.includes(":")) return `https://github.com/${shorthand[1]}/${shorthand[2]}.git`
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password) return null
    if (url.pathname.split("/").filter(Boolean).length < 2) return null
    return url.href
  } catch {
    return null
  }
}

/** A repo's default folder name: the last path segment without `.git`. */
export const repoDirName = (url: string) =>
  (url.split("/").filter(Boolean).pop() ?? "repo").replace(/\.git$/, "").replace(/[^\w.-]/g, "-") || "repo"

/** Short label for a repo, e.g. `owner/repo`. */
export const repoLabel = (url: string) => {
  const match = /github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url)
  return match?.[1] ?? url.replace(/^https:\/\//, "").replace(/\.git$/, "")
}

/** A GitHub repo for the project editor's picker. `accessible`: the user's connection can clone it (private ones included). */
export interface GitHubRepo {
  readonly fullName: string
  readonly private: boolean
  readonly description: string
  readonly defaultBranch: string
  readonly pushedAt: string | null
  readonly fork: boolean
  readonly archived: boolean
  readonly owner: string
  readonly ownerAvatar: string
  readonly accessible: boolean
  readonly language: string | null
  readonly stars: number
}

/** Who's connected to GitHub, the orgs Dex can see, and where to grant it more. */
export interface GitHubAccess {
  readonly connected: boolean
  readonly login: string | null
  readonly via: "oauth" | "token" | null
  readonly orgs: ReadonlyArray<{ readonly login: string; readonly avatarUrl: string }>
  readonly manageUrl: string | null
}
