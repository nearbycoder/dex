import { PROJECT_ROOT, type ProjectProfile, repoLabel } from "~/shared/projects"
import { VM_ENV_FILE, VM_ENV_HOOK } from "./secrets"
import type { VmSetupContext } from "./vm"

export interface ProvisionPlan {
  readonly github: { readonly token: string; readonly login: string; readonly name: string; readonly email: string } | null
  readonly project: ProjectProfile | null
  /** The saved secrets' env file (see AccountSecrets), written first so setup scripts can use them. */
  readonly env: string | null
}

const SETUP_TIMEOUT_MS = 30 * 60_000
const POLL_MS = 3_000

/** A single-quoted shell word. */
export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

/**
 * Prepares a new VM: signs the GitHub CLI and git in with the user's token, clones the project's repos
 * into ~/work, and runs its setup script. Throws on the first failed step.
 */
export async function provisionVm(setup: VmSetupContext, plan: ProvisionPlan) {
  if (plan.env) {
    setup.step("Adding your secrets")
    await setup.writeFile(VM_ENV_FILE, plan.env)
    await setup.quiet(VM_ENV_HOOK)
  }

  if (plan.github) {
    setup.step("Signing in to GitHub")
    // The token goes through a file, never a command line, so it stays out of the activity log.
    await setup.writeFile("/tmp/.dex-gh-token", plan.github.token)
    // `gh auth login` refuses tokens without the scopes it wants (read:org), though everything Dex needs works
    // without them: for those, it writes the CLI's credentials itself. Then it checks the token reaches GitHub.
    const login = await setup.run(
      "Sign in to GitHub (gh auth login)",
      `if ! gh auth login --hostname github.com --git-protocol https --with-token < /tmp/.dex-gh-token; then
         echo "Signing the GitHub CLI in directly instead"
         mkdir -p ~/.config/gh && (umask 077; printf 'github.com:\n    oauth_token: %s\n    user: %s\n    git_protocol: https\n' "$(cat /tmp/.dex-gh-token)" ${shellQuote(plan.github.login)} > ~/.config/gh/hosts.yml)
       fi
       rm -f /tmp/.dex-gh-token
       gh auth setup-git && git config --global user.name ${shellQuote(plan.github.name)} && git config --global user.email ${shellQuote(plan.github.email)} && echo "Signed in as $(gh api user --jq .login)"`
    )
    if (login.exitCode !== 0) throw new Error("gh auth login failed; check the GitHub token in Settings")
  }

  const project = plan.project
  if (!project) return
  await setup.quiet(`mkdir -p ${PROJECT_ROOT}/.dex`)

  for (const repo of project.repos) {
    const label = repoLabel(repo.url)
    const target = `${PROJECT_ROOT}/${repo.dir}`
    setup.step(`Cloning ${label}`)
    const clone = await setup.run(
      `Clone ${label}${repo.branch ? ` (${repo.branch})` : ""} into ~/work/${repo.dir}`,
      `if [ -d ${shellQuote(`${target}/.git`)} ]; then echo "Already cloned"; else git clone --filter=blob:none ${repo.branch ? `--branch ${shellQuote(repo.branch)} ` : ""}${shellQuote(repo.url)} ${shellQuote(target)}; fi`,
      { timeoutSeconds: 600 }
    )
    if (clone.exitCode !== 0) {
      throw new Error(
        `git clone of ${label} failed${plan.github ? "" : " (for a private repo, add a GitHub token in Settings)"}`
      )
    }
  }

  const script = project.setupScript.trim()
  if (!script) return
  setup.step("Running the setup script")
  await setup.writeFile(`${PROJECT_ROOT}/.dex/setup.sh`, `#!/usr/bin/env bash\nset -eo pipefail\ncd ${PROJECT_ROOT}\n${script}\n`)
  // Setup can outlast boat's 10-minute command limit (installs, builds), so it runs detached and is polled.
  await setup.quiet(`rm -f ${PROJECT_ROOT}/.dex/setup.exit ${PROJECT_ROOT}/.dex/setup.log`)
  await setup.spawn(`bash -lc 'bash .dex/setup.sh > .dex/setup.log 2>&1; echo $? > .dex/setup.exit'`, PROJECT_ROOT)
  const log = setup.begin("Run the project's setup script (~/work/.dex/setup.sh)")
  let offset = 0
  const deadline = Date.now() + SETUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    if (setup.signal?.aborted) throw setup.signal.reason
    // Byte offsets, so a partial line is never sent twice.
    const poll = await setup.quiet(
      `cd ${PROJECT_ROOT}/.dex && size=$(stat -c %s setup.log 2>/dev/null || echo 0); echo "$size $(cat setup.exit 2>/dev/null)"; tail -c +${offset + 1} setup.log 2>/dev/null | head -c $((size - ${offset}))`,
      { timeoutSeconds: 30 }
    )
    const stdout = poll.stdout ?? ""
    const newline = stdout.indexOf("\n")
    const [sizeText = "0", exitText = ""] = (newline === -1 ? stdout : stdout.slice(0, newline)).trim().split(" ")
    const chunk = newline === -1 ? "" : stdout.slice(newline + 1)
    if (chunk) log.append(chunk)
    offset = Math.max(offset, Number(sizeText) || offset)
    if (exitText !== "") {
      const exitCode = Number(exitText)
      log.finish(exitCode === 0, exitCode)
      if (exitCode !== 0) throw new Error(`the setup script exited with code ${exitCode}; its log is ~/work/.dex/setup.log`)
      return
    }
  }
  log.finish(false)
  throw new Error("the setup script was still running after 30 minutes; it keeps running in the background")
}
