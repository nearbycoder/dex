/**
 * VPNs for the VM's browser. You save a provider's WireGuard config (Surfshark, Mullvad, Proton… all hand them out
 * for manual setup) on the Secrets page, and pick one for a chat: that chat's VMs then send their Chrome's traffic
 * through it, so sites see the VPN's address and country. Only Chrome: commands (vm_exec, curl) and boat's own link to
 * the VM go out directly. On the VM, wireproxy (a userspace WireGuard client, no root or routing changes) serves the
 * tunnel as a SOCKS proxy on loopback, and a Chrome policy points the browser at it. Chrome applies policy changes
 * while it runs, so switching needs no restart. If the tunnel is down, Chrome can't reach anything: it never falls back
 * to going out directly.
 */

import type { VpnInfo } from "~/shared/protocol"

/** wireproxy release (github.com/windtf/wireproxy), pinned with each build's SHA-256. */
const WIREPROXY_VERSION = "1.1.3"
const WIREPROXY_SHA256: Record<string, string> = {
  amd64: "e88c1d090740373fc606c1bafd81d9a5eadc642cce5667616e20e9d7a444f51c",
  arm64: "370e00bd2167960d1ecd1c3c1439715bbaa94a0a110a2040468670c9af6021b6"
}
/** The tunnel's SOCKS proxy on the VM, reachable from the VM only. */
const VPN_PORT = 40780
/** Where Dex writes the chat's VPN config on the VM (its private key in it: readable by the VM's user only). */
export const VPN_CONFIG_PATH = "/home/user/.config/dex/vpn.conf"


// ── WireGuard configs ───────────────────────────────────────────────────────

const KEY = /^[A-Za-z0-9+/]{42,43}=?$/
const ADDRESSES = /^[0-9A-Fa-f:.\/, ]{3,400}$/
const ENDPOINT = /^(?:[A-Za-z0-9.-]{1,253}|\[[0-9A-Fa-f:]{2,45}\]):\d{1,5}$/

/**
 * Checks a WireGuard config (as a provider's "manual setup" gives it) and rewrites it with only the fields wireproxy
 * needs, so nothing else in a pasted file (PostUp scripts, extra tunnels) ever reaches the VM. Throws, saying what's
 * wrong, for anything that isn't one interface and one peer.
 */
export function parseWireGuard(text: string): { config: string; endpoint: string } {
  if (text.length > 20_000) throw new Error("That's too long for a WireGuard config.")
  const sections: Array<{ name: string; fields: Map<string, string> }> = []
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/[#;].*$/, "").trim()
    if (!line) continue
    const header = /^\[(\w+)\]$/.exec(line)
    if (header) {
      sections.push({ name: header[1]!.toLowerCase(), fields: new Map() })
      continue
    }
    const field = /^(\w+)\s*=\s*(.+)$/.exec(line)
    if (!field || !sections.length) throw new Error(`This doesn't look like a WireGuard config (at "${line.slice(0, 40)}").`)
    sections.at(-1)!.fields.set(field[1]!.toLowerCase(), field[2]!.trim())
  }
  const interfaces = sections.filter((section) => section.name === "interface")
  const peers = sections.filter((section) => section.name === "peer")
  if (interfaces.length !== 1 || peers.length !== 1) throw new Error("A WireGuard config needs one [Interface] and one [Peer] section.")
  const own = interfaces[0]!.fields
  const peer = peers[0]!.fields
  const need = (fields: Map<string, string>, name: string, label: string, valid: RegExp) => {
    const value = fields.get(name)
    if (!value) throw new Error(`The config has no ${label}.`)
    if (!valid.test(value)) throw new Error(`The config's ${label} doesn't look right.`)
    return value
  }
  const optional = (fields: Map<string, string>, name: string, label: string, valid: RegExp) => {
    const value = fields.get(name)
    if (value !== undefined && !valid.test(value)) throw new Error(`The config's ${label} doesn't look right.`)
    return value
  }
  const endpoint = need(peer, "endpoint", "Endpoint", ENDPOINT)
  const lines = [
    "[Interface]",
    `PrivateKey = ${need(own, "privatekey", "PrivateKey", KEY)}`,
    `Address = ${need(own, "address", "Address", ADDRESSES)}`,
    // Names are resolved through the tunnel, by its DNS servers (a provider's own, or Cloudflare's).
    `DNS = ${optional(own, "dns", "DNS", ADDRESSES) ?? "1.1.1.1"}`,
    ...(own.has("mtu") ? [`MTU = ${optional(own, "mtu", "MTU", /^\d{3,4}$/)}`] : []),
    "",
    "[Peer]",
    `PublicKey = ${need(peer, "publickey", "PublicKey", KEY)}`,
    ...(peer.has("presharedkey") ? [`PresharedKey = ${optional(peer, "presharedkey", "PresharedKey", KEY)}`] : []),
    `Endpoint = ${endpoint}`,
    `AllowedIPs = ${optional(peer, "allowedips", "AllowedIPs", ADDRESSES) ?? "0.0.0.0/0, ::/0"}`,
    // Keeps the tunnel open through the VM's NAT between page loads.
    `PersistentKeepalive = ${optional(peer, "persistentkeepalive", "PersistentKeepalive", /^\d{1,4}$/) ?? "25"}`
  ]
  return { config: lines.join("\n") + "\n", endpoint }
}

/** The file wireproxy runs from on the VM: the cleaned config and its SOCKS proxy. */
export const wireproxyConfig = (config: string) => `${config}\n[Socks5]\nBindAddress = 127.0.0.1:${VPN_PORT}\n`

// ── Saved VPNs ──────────────────────────────────────────────────────────────

interface VpnHost {
  readonly sql: SqlStorage
  encrypt(value: string): Promise<string>
  decrypt(sealed: string): Promise<string | null>
  publish(vpns: VpnInfo[]): void
}

/** Saved VPN configs, encrypted; the list (names and servers, never keys) is in the synced state. */
export class VpnStore {
  private readonly host: VpnHost

  constructor(host: VpnHost) {
    this.host = host
    host.sql.exec(`CREATE TABLE IF NOT EXISTS dex_vpns (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, sealed TEXT NOT NULL, endpoint TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
  }

  list(): VpnInfo[] {
    return this.host.sql
      .exec<{ id: string; name: string; endpoint: string; updated_at: number }>(`SELECT id, name, endpoint, updated_at FROM dex_vpns ORDER BY name`)
      .toArray()
      .map((row) => ({ id: row.id, name: row.name, endpoint: row.endpoint, updatedAt: row.updated_at }))
  }

  get(id: string): VpnInfo | undefined {
    return this.list().find((vpn) => vpn.id === id)
  }

  refresh() {
    this.host.publish(this.list())
  }

  /** Adds a VPN, or with `id` renames that one and, given a config, replaces its config. */
  async save(draft: { id?: string; name: string; config?: string }): Promise<VpnInfo> {
    const name = draft.name.trim().slice(0, 60)
    if (!name) throw new Error("Give the VPN a name, like “Surfshark US”.")
    const existing = draft.id ? this.host.sql.exec<{ sealed: string; endpoint: string }>(`SELECT sealed, endpoint FROM dex_vpns WHERE id = ?`, draft.id).toArray()[0] : undefined
    if (draft.id && !existing) throw new Error("That VPN no longer exists.")
    if (!draft.config?.trim() && !existing) throw new Error("Paste the VPN's WireGuard config.")
    const parsed = draft.config?.trim() ? parseWireGuard(draft.config) : null
    const id = draft.id ?? crypto.randomUUID()
    const now = Date.now()
    this.host.sql.exec(
      `INSERT INTO dex_vpns (id, name, sealed, endpoint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, sealed = excluded.sealed, endpoint = excluded.endpoint, updated_at = excluded.updated_at`,
      id, name, parsed ? await this.host.encrypt(parsed.config) : existing!.sealed, parsed?.endpoint ?? existing!.endpoint, now, now
    )
    this.refresh()
    return this.get(id)!
  }

  remove(id: string) {
    const removed = this.host.sql.exec(`DELETE FROM dex_vpns WHERE id = ?`, id).rowsWritten > 0
    if (removed) this.refresh()
    return removed
  }

  /** The cleaned config, for the VM; null if it's gone or can't be decrypted. */
  async config(id: string): Promise<string | null> {
    const row = this.host.sql.exec<{ sealed: string }>(`SELECT sealed FROM dex_vpns WHERE id = ?`, id).toArray()[0]
    return row ? this.host.decrypt(row.sealed) : null
  }
}

// ── On the VM ───────────────────────────────────────────────────────────────

const WIREPROXY = `$HOME/.local/share/dex/wireproxy-${WIREPROXY_VERSION}`
const POLICY_DIRS = "/etc/chromium/policies/managed /etc/opt/chrome/policies/managed"
/** Chrome's whole traffic through the proxy (loopback, like browse's relay, always stays direct), and WebRTC too. */
const POLICY = JSON.stringify({
  ProxySettings: { ProxyMode: "fixed_servers", ProxyServer: `socks5://127.0.0.1:${VPN_PORT}` },
  WebRtcIPHandling: "disable_non_proxied_udp"
})
const TRACE = "https://www.cloudflare.com/cdn-cgi/trace"
const STATE = "$HOME/.cache/dex-browse"

/**
 * Shell for the start of browse.ts's scripts: puts the VM's Chrome on the chat's VPN (`on`: Dex wrote its config to
 * VPN_CONFIG_PATH first) or takes it off. Sets `vpn_changed` when Chrome's route changed while it was open, for
 * VPN_SETTLE once Chrome is connected. Cheap when nothing changes. Exits the script when the VPN can't connect,
 * with Chrome left on it (so it reaches nothing rather than going out directly).
 */
export const vpnSetup = (on: boolean) => (on ? VPN_ON : VPN_OFF)

const VPN_COMMON = `vpn_changed=""
mkdir -p "${STATE}"
# Matched from the start of the command line: this script's own text names it too.
vpn_stop() { pkill -f "^$HOME/.local/share/dex/wireproxy" 2> /dev/null || true; rm -f "${STATE}/vpn"; }
vpn_policy() {
  for dir in ${POLICY_DIRS}; do
    if [ "$1" = on ]; then
      cmp -s "$dir/dex-vpn.json" /tmp/dex-vpn-policy.json 2> /dev/null && continue
      sudo mkdir -p "$dir" && sudo cp /tmp/dex-vpn-policy.json "$dir/dex-vpn.json" && sudo chmod 644 "$dir/dex-vpn.json"
    else
      [ -e "$dir/dex-vpn.json" ] || continue
      sudo rm -f "$dir/dex-vpn.json"
    fi
    pgrep -x chrome > /dev/null && vpn_changed=1
  done
  true
}`

const VPN_ON = `${VPN_COMMON}
# Chrome on the proxy first, so it never goes out directly while the tunnel comes up (or when it can't).
echo '${POLICY}' > /tmp/dex-vpn-policy.json
vpn_policy on
[ -s ${VPN_CONFIG_PATH} ] || { echo "The chat's VPN config isn't on the VM. Call vm_browser again to retry." >&2; exit 1; }
chmod 600 ${VPN_CONFIG_PATH}
if [ ! -x "${WIREPROXY}" ]; then
  case "$(uname -m)" in
    x86_64) arch=amd64 sum=${WIREPROXY_SHA256.amd64} ;;
    aarch64|arm64) arch=arm64 sum=${WIREPROXY_SHA256.arm64} ;;
    *) echo "The VPN can't run on this VM's CPU ($(uname -m))." >&2; exit 1 ;;
  esac
  dir=$(mktemp -d)
  curl -fsSL -o "$dir/wireproxy.tgz" "https://github.com/windtf/wireproxy/releases/download/v${WIREPROXY_VERSION}/wireproxy_linux_$arch.tar.gz" &&
    echo "$sum  $dir/wireproxy.tgz" | sha256sum -c --quiet - && tar -xzf "$dir/wireproxy.tgz" -C "$dir" wireproxy &&
    mkdir -p "$(dirname "${WIREPROXY}")" && mv "$dir/wireproxy" "${WIREPROXY}" && chmod 755 "${WIREPROXY}"
  rm -rf "$dir"
  [ -x "${WIREPROXY}" ] || { echo "Couldn't install the VPN client on the VM." >&2; exit 1; }
fi
# Back after a VM restart, before anyone opens Chrome.
mkdir -p ~/.config/autostart
printf '[Desktop Entry]\\nType=Application\\nName=Dex VPN\\nExec=%s -s -c %s\\nNoDisplay=true\\nX-GNOME-Autostart-enabled=true\\n' "${WIREPROXY}" "${VPN_CONFIG_PATH}" > ~/.config/autostart/dex-vpn.desktop
want=$(sha256sum ${VPN_CONFIG_PATH} | cut -c1-16)
if [ "$(cat "${STATE}/vpn" 2> /dev/null)" != "$want" ] || ! pgrep -f "^$HOME/.local/share/dex/wireproxy" > /dev/null; then
  vpn_stop
  setsid nohup "${WIREPROXY}" -s -c ${VPN_CONFIG_PATH} > /tmp/dex-vpn.log 2>&1 < /dev/null &
  for i in $(seq 20); do ss -ltn 2> /dev/null | grep -q '127.0.0.1:${VPN_PORT} ' && break; sleep 0.25; done
  trace=""
  for i in 1 2 3; do
    trace=$(curl -s --max-time 10 --socks5-hostname 127.0.0.1:${VPN_PORT} ${TRACE} || true)
    [ -n "$trace" ] && break
    sleep 1
  done
  if [ -z "$trace" ]; then
    echo "The VPN didn't connect, so the VM's browser can't reach anything. Check its config on the Secrets page, or turn the chat's VPN off." >&2
    tail -3 /tmp/dex-vpn.log >&2
    vpn_stop
    exit 1
  fi
  echo "$want" > "${STATE}/vpn"
  echo "$trace" | sed -n 's/^ip=//p' > "${STATE}/vpn-ip"
  echo "VPN: on; the browser's traffic leaves from $(cat "${STATE}/vpn-ip") ($(echo "$trace" | sed -n 's/^loc=//p'))."
fi`

const VPN_OFF = `${VPN_COMMON}
if [ -e ${VPN_CONFIG_PATH} ] || [ -e ~/.config/autostart/dex-vpn.desktop ] || [ -e /etc/opt/chrome/policies/managed/dex-vpn.json ] || [ -e /etc/chromium/policies/managed/dex-vpn.json ]; then
  vpn_policy off
  rm -f ${VPN_CONFIG_PATH} ~/.config/autostart/dex-vpn.desktop
  vpn_stop
  echo "VPN: off; the browser goes out directly."
fi`

/**
 * After VPN_SETUP, once Chrome is connected to browse: Chrome applies a policy change within seconds, so when its route
 * changed while it was open, this waits (on a page of its own) until it has, so the next page loads on the new route.
 */
export const vpnSettle = (on: boolean) => `if [ -n "$vpn_changed" ]; then
  direct=" $(curl -s4 --max-time 5 ${TRACE} | sed -n 's/^ip=//p') $(curl -s6 --max-time 5 ${TRACE} | sed -n 's/^ip=//p') "
  echo 'await page.goto("${TRACE}"); return (await page.locator("body").innerText()).match(/^ip=(.*)$/m)?.[1] ?? ""' > /tmp/dex-vpn-check.js
  check=$(browse tabs new --group=dex-vpn-check 2> /dev/null | python3 -c 'import json, sys; print(json.load(sys.stdin)["tab"])' 2> /dev/null || true)
  settled=""
  for i in $(seq 12); do
    [ -n "$check" ] || break
    seen=$(browse execute --tab="$check" --timeout-ms=8000 --file=/tmp/dex-vpn-check.js 2> /dev/null | grep -m1 -E '^[0-9A-Fa-f:.]+$' || true)
    case "$direct" in
      *" $seen "*) ${on ? "" : `[ -n "$seen" ] && settled=1 && break`} ;;
      *) ${on ? `[ -n "$seen" ] && settled=1 && break` : ""} ;;
    esac
    sleep 1.5
  done
  browse tabs close --group=dex-vpn-check > /dev/null 2>&1 || true
  rm -f /tmp/dex-vpn-check.js
  ${on ? `[ -n "$settled" ] || { echo "The VM's Chrome didn't switch to the VPN. Call vm_browser again to retry." >&2; exit 1; }` : "true"}
fi`
