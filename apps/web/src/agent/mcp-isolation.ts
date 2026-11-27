/**
 * OS-level isolation for local (stdio) MCP servers running on the shared MCP host VM (`mcp-host`).
 *
 * Each server runs under its own dedicated unprivileged Linux user (`dexmcp-<hash>`) with a mode-0700 home/work
 * directory under `/var/lib/dex-mcp/<id>`, mode-0600 env file, isolated `TMPDIR` and npm/uv caches, and (when the VM
 * kernel permits) `/proc` mounted `hidepid=2`. A compromised MCP package cannot read sibling servers' secrets, caches,
 * temp files, or `/proc/<pid>/environ`, nor touch `/home/user`.
 */

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Deterministic, valid 19-char Linux username (`dexmcp-<12 hex>`), unique per MCP server id. */
export function mcpLinuxUser(serverId: string): string {
  if (!SAFE_ID.test(serverId)) throw new Error(`Invalid MCP server id: ${serverId}`)
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b1
  for (let i = 0; i < serverId.length; i++) {
    const c = serverId.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c + i * 31), 0x85ebca6b) >>> 0
  }
  const suffix = `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`.slice(0, 12)
  return `dexmcp-${suffix}`
}

/** Isolated root directory for a local MCP server on the MCP VM. */
export function mcpIsolatedDir(serverId: string): string {
  if (!SAFE_ID.test(serverId)) throw new Error(`Invalid MCP server id: ${serverId}`)
  return `/var/lib/dex-mcp/${serverId}`
}

/** Whether the server command launches a Docker container (which needs docker socket access rather than a non-docker UID). */
export const isDockerMcpCommand = (command: string): boolean => /^\s*docker\s+run\b/.test(command)

export interface LocalMcpLaunchSpec {
  readonly serverId: string
  readonly command: string
  readonly port: number
  readonly supergatewayVersion: string
  readonly env: Readonly<Record<string, string>>
  readonly scrubCommand: string
}

/**
 * Builds the inner runner script that starts supergateway for one MCP server.
 * Kept separate from its secrets (`env` file, mode 0600) so secrets never sit in `/proc` command lines.
 */
export function buildMcpRunScript(spec: Pick<LocalMcpLaunchSpec, "command" | "port" | "supergatewayVersion">): string {
  const dirVar = "$HOME"
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `export XDG_CACHE_HOME="${dirVar}/.cache"`,
    `export XDG_CONFIG_HOME="${dirVar}/.config"`,
    `export TMPDIR="${dirVar}/tmp"`,
    `export NPM_CONFIG_CACHE="${dirVar}/.npm"`,
    `export UV_CACHE_DIR="${dirVar}/.uv"`,
    `mkdir -p "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$TMPDIR" "$NPM_CONFIG_CACHE" "$UV_CACHE_DIR" && chmod 700 "$TMPDIR"`,
    `if [ -f "${dirVar}/env" ]; then set -a; . "${dirVar}/env"; set +a; fi`,
    `if [[ ${shellQuote(spec.command)} == uvx* ]] && ! command -v uvx >/dev/null 2>&1; then curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1; fi`,
    `export PATH="${dirVar}/.local/bin:$PATH"`,
    `exec npx -y supergateway@${spec.supergatewayVersion} --stdio ${shellQuote(spec.command)} --outputTransport streamableHttp --port ${spec.port} --stateful --healthEndpoint /healthz --logLevel info`
  ].join("\n") + "\n"
}

/** Builds the mode-0600 environment file for one MCP server. */
export function buildMcpEnvFile(env: Readonly<Record<string, string>>): string {
  const lines = Object.entries(env)
    .filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
  return lines.length ? `${lines.join("\n")}\n` : ""
}

/**
 * Builds the provisioning + spawn shell command run on `mcp-host`.
 *
 * When passwordless `sudo` is available and the server is not a `docker run` container, provisions a dedicated
 * unprivileged Linux user (`dexmcp-<hash>`) with a mode-0700 `/var/lib/dex-mcp/<id>` home directory, moves the staged
 * scripts/env there with strict ownership, removes any legacy `/home/user/mcp/<id>` folder, and launches via `sudo -u`.
 * OCI (`docker run`) servers stay container-isolated while keeping their env/scripts in mode-0700 `/var/lib/dex-mcp/<id>`.
 */
export function buildMcpSpawnCommand(spec: LocalMcpLaunchSpec, stageDir: string): string {
  const user = mcpLinuxUser(spec.serverId)
  const dir = mcpIsolatedDir(spec.serverId)
  const legacyDir = `/home/user/mcp/${spec.serverId}`
  const isDocker = isDockerMcpCommand(spec.command)
  const qStage = shellQuote(stageDir)
  const qDir = shellQuote(dir)
  const qLegacy = shellQuote(legacyDir)
  const qUser = shellQuote(user)

  return [
    spec.scrubCommand,
    `NODE_BIN="$(dirname "$(command -v npx || command -v node || echo /usr/bin/node)")"`,
    `BASE_PATH="$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"`,
    `if sudo -n true 2>/dev/null; then`,
    `  sudo -n mount -o remount,hidepid=2 /proc 2>/dev/null || true`,
    `  sudo -n install -d -m 711 /var/lib/dex-mcp`,
    ...(isDocker
      ? [
          `  sudo -n install -d -m 700 -o user -g user ${qDir}`,
          `  sudo -n install -m 600 -o user -g user ${qStage}/env ${qDir}/env`,
          `  sudo -n install -m 700 -o user -g user ${qStage}/run.sh ${qDir}/run.sh`,
          `  rm -rf ${qStage} ${qLegacy}`,
          `  (pkill -f ${shellQuote(`[d]ex-mcp/${spec.serverId}/run.sh`)} || pkill -f ${shellQuote(`[m]cp/${spec.serverId}/run.sh`)} || true)`,
          `  HOME=${qDir} PATH="$BASE_PATH" bash ${qDir}/run.sh > ${qDir}/log 2>&1`
        ]
      : [
          `  id -u ${qUser} >/dev/null 2>&1 || sudo -n useradd --system --no-create-home --home-dir ${qDir} --shell /usr/sbin/nologin ${qUser}`,
          `  sudo -n pkill -u ${qUser} 2>/dev/null || true`,
          `  (pkill -f ${shellQuote(`[m]cp/${spec.serverId}/run.sh`)} || true)`,
          `  sudo -n install -d -m 700 -o ${qUser} -g ${qUser} ${qDir}`,
          `  sudo -n install -m 600 -o ${qUser} -g ${qUser} ${qStage}/env ${qDir}/env`,
          `  sudo -n install -m 700 -o ${qUser} -g ${qUser} ${qStage}/run.sh ${qDir}/run.sh`,
          `  sudo -n touch ${qDir}/log && sudo -n chown ${qUser}:${qUser} ${qDir}/log && sudo -n chmod 640 ${qDir}/log`,
          `  rm -rf ${qStage} ${qLegacy}`,
          `  if sudo -n -u ${qUser} env -i HOME=${qDir} PATH="$BASE_PATH" command -v npx >/dev/null 2>&1; then`,
          `    sudo -n -u ${qUser} env -i HOME=${qDir} PATH="$BASE_PATH" bash ${qDir}/run.sh > ${qDir}/log 2>&1`,
          `  else`,
          // Fallback only if node/npx lives inside a non-world-executable path (e.g. private ~/.nvm): keep mode-0700 dir.
          `    sudo -n chown -R user:user ${qDir}`,
          `    HOME=${qDir} PATH="$BASE_PATH" bash ${qDir}/run.sh > ${qDir}/log 2>&1`,
          `  fi`
        ]),
    `else`,
    `  chmod 700 ${qStage} && chmod 600 ${qStage}/env && chmod 700 ${qStage}/run.sh`,
    `  (pkill -f ${shellQuote(`[m]cp/${spec.serverId}/run.sh`)} || true)`,
    `  HOME=${qStage} PATH="$BASE_PATH" bash ${qStage}/run.sh > ${qStage}/log 2>&1`,
    `fi`
  ].join("\n")
}

/** Command that reads the last 40 lines of the MCP server's log (handles isolated `/var/lib/dex-mcp` and legacy fallback). */
export function buildMcpTailLogCommand(serverId: string, stageDir: string): string {
  const dir = mcpIsolatedDir(serverId)
  return `(sudo -n tail -n 40 ${shellQuote(`${dir}/log`)} 2>/dev/null || tail -n 40 ${shellQuote(`${stageDir}/log`)} 2>/dev/null || true)`
}

/** Command that stops a local MCP server (both isolated UID processes and any legacy/fallback process). */
export function buildMcpStopCommand(serverId: string, port: number, remove = false): string {
  const user = mcpLinuxUser(serverId)
  const dir = mcpIsolatedDir(serverId)
  const legacyDir = `/home/user/mcp/${serverId}`
  const lines = [
    `if sudo -n true 2>/dev/null; then`,
    `  sudo -n pkill -u ${shellQuote(user)} 2>/dev/null || true`,
    `  sudo -n pkill -f ${shellQuote(`[d]ex-mcp/${serverId}/run.sh`)} 2>/dev/null || true`,
    `fi`,
    `pkill -f ${shellQuote(`[m]cp/${serverId}/run.sh`)} 2>/dev/null || true`,
    `pkill -f ${shellQuote(`[p]ort ${port} `)} 2>/dev/null || true`
  ]
  if (remove) {
    lines.push(
      `if sudo -n true 2>/dev/null; then`,
      `  sudo -n rm -rf ${shellQuote(dir)}`,
      `  sudo -n userdel ${shellQuote(user)} 2>/dev/null || true`,
      `fi`,
      `rm -rf ${shellQuote(legacyDir)}`
    )
  }
  lines.push("true")
  return lines.join("\n")
}
