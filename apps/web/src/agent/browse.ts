/**
 * The VM's browser for agents: browse (https://opencode.ai/product/browse, by Anomaly) drives the VM's own Chrome
 * through its extension, so the agent browses in a real, visible browser with its cookies and logins, on the desktop
 * the user watches, instead of a headless one. browse 0.1.0 and later is one native binary (CLI and relay, no Node or
 * Playwright) whose `execute` runs JavaScript with a Playwright-style `page` in the relay; tabs are the handle (there
 * are no sessions), so each of Dex's sessions is a tab group of that name and Dex keeps the session's tab id on the VM.
 * The browse CLI lives on the VM; its extension is force-installed by Chromium policy and paired with the CLI's local
 * relay the first time a chat browses (each VM pairs its own, so no pairing key is baked into the template).
 */
export const BROWSE_EXTENSION_ID = "mfnicocicmmlkpjnaffgihfjhdgjkdjg"

/** Whether the VM's browse is the Rust one (0.1.0+); the TypeScript one (0.0.x) had sessions and a different CLI. */
const BROWSE_CURRENT = `case "$("$HOME/.local/bin/browse" --version 2>/dev/null)" in ""|0.0.*) false ;; *) true ;; esac`

/**
 * Installs browse's CLI (into ~/.local/bin, where its own updater keeps it current; an older TypeScript one there is
 * replaced) and has Chrome install the extension from the Web Store. boat's Chrome is a Chromium build, which reads
 * /etc/chromium/policies; the Google Chrome path is written too in case the image switches. Idempotent; run on the
 * template builder and, from browseReady, on VMs made before the template had it (or had an older browse).
 */
export const BROWSE_BAKE = `set -e
policy='{"ExtensionInstallForcelist":["${BROWSE_EXTENSION_ID};https://clients2.google.com/service/update2/crx"]}'
for dir in /etc/chromium/policies/managed /etc/opt/chrome/policies/managed; do
  sudo mkdir -p "$dir"
  echo "$policy" | sudo tee "$dir/dex-browse.json" > /dev/null
done
if ! ${BROWSE_CURRENT}; then
  curl -fsSL https://opencode.ai/browse/install -o /tmp/browse-install.sh
  sh /tmp/browse-install.sh --no-setup > /tmp/browse-install.log 2>&1 || { tail -20 /tmp/browse-install.log >&2; exit 1; }
  rm -f /tmp/browse-install.sh /tmp/browse-install.log
  ${BROWSE_CURRENT} || { echo "browse didn't install." >&2; exit 1; }
fi`

/**
 * For the template builder, after BROWSE_BAKE: opens Chrome once on the desktop so it fetches the force-installed
 * extension into its profile, then closes it, so a VM made from the template has the extension from its first start
 * instead of waiting on the Web Store. Leaves no pairing (each VM pairs its own) and no profile lock (the lock names
 * the builder's host, and Chrome on another host would refuse the profile). Best effort: a template without the
 * extension still works, the first vm_browser call fetches it.
 */
export const BROWSE_PREWARM = `export DISPLAY=:0
for i in $(seq 60); do [ -e /tmp/.X11-unix/X0 ] && break; sleep 1; done
installed() { ls "$HOME"/.config/google-chrome/*/Extensions/${BROWSE_EXTENSION_ID}/*/manifest.json > /dev/null 2>&1; }
if ! installed; then
  setsid nohup google-chrome --no-first-run --no-default-browser-check about:blank > /tmp/dex-chrome-prewarm.log 2>&1 < /dev/null &
  for i in $(seq 180); do installed && break; sleep 0.5; done
  # Let Chrome finish writing the extension's settings before it closes.
  sleep 3
  pkill -TERM -x chrome || true
  for i in $(seq 30); do pgrep -x chrome > /dev/null || break; sleep 0.5; done
  pkill -KILL -x chrome 2> /dev/null || true
fi
rm -f "$HOME"/.config/google-chrome/Singleton* /tmp/dex-chrome-prewarm.log
installed || echo "Chrome didn't fetch the browse extension; VMs will fetch it on first use." >&2
true`

/** Where browseReady keeps each session's tab id on the VM. */
const TABS_DIR = "$HOME/.cache/dex-browse"

/**
 * Gets the VM's browser ready for `browse execute --tab "$tab"`: browse installed and current, Chrome open on the
 * desktop, its extension connected to the relay (pairing it the first time, by opening the extension's welcome page
 * with a fresh one-time code, as `browse install` does), and the session's tab open, its id in `$tab` (`session` must
 * be a plain lowercase id, it goes into the script as is). Quick when all of that already holds. Runs in the caller's
 * shell (its exports and `$tab` are for the commands after it) and exits it when the browser can't be made ready.
 * browse opens agent tabs in the background and can't raise them, so a session's new tab is shown with Chrome's own
 * "last tab" key (agent tabs aren't grouped, so it's last), and the user watching the desktop sees the page the agent
 * is on. Files under home are reachable from `files` and uploads (OPENCODE_BROWSER_FILE_ROOTS, read when the relay
 * starts).
 */
export const browseReady = (session: string) => `export DISPLAY=:0 OPENCODE_BROWSER_FILE_ROOTS="$HOME" PATH="$HOME/.local/bin:$PATH"
cd ~
${BROWSE_CURRENT} || ( ${BROWSE_BAKE} ) || exit 1
connected() { browse status 2>/dev/null | grep -q '^Extension: connected'; }
# Any tool call starts the relay (stopped after a VM stop, or replaced: an older browse's relay is asked to stop);
# a paired extension reconnects within seconds.
browse tabs > /dev/null 2>&1 || true
if ! connected; then
  if ! pgrep -x chrome > /dev/null; then
    # A lock left by another machine (this disk copied from a VM whose Chrome was open) would make Chrome refuse the profile.
    rm -f "$HOME"/.config/google-chrome/Singleton*
    setsid nohup google-chrome --no-first-run --no-default-browser-check --start-maximized --hide-crash-restore-bubble > /tmp/dex-chrome.log 2>&1 < /dev/null &
  fi
  for i in $(seq 60); do [ -d "$HOME/.config/google-chrome/Default/Extensions/${BROWSE_EXTENSION_ID}" ] && break; sleep 0.5; done
  for i in $(seq 12); do connected && break; sleep 0.5; done
fi
# browse's setup page ("Connect your agent", in its own window): closed once pairing is over, however it went, so the
# desktop shows the agent's tab.
close_setup() {
  for w in $(xdotool search --name '^Connect your agent' 2> /dev/null); do
    xdotool windowactivate --sync "$w" key --clearmodifiers ctrl+w 2> /dev/null || true
  done
}
# One pairing attempt: a fresh one-time code from \`browse pair\`, handed to the extension through its welcome page.
pair() {
  # A pairing or setup left running (a cut-off attempt, or \`browse install\` run by hand) holds the relay's pairing.
  pkill -f 'browse (pair|install)' 2> /dev/null || true
  rm -f /tmp/dex-browse-pair.log
  setsid nohup browse pair --wait-seconds 60 > /tmp/dex-browse-pair.log 2>&1 < /dev/null &
  code=""
  for i in $(seq 40); do code=$(grep -o 'Pairing code: [0-9A-Za-z-]*' /tmp/dex-browse-pair.log 2>/dev/null | cut -d' ' -f3); [ -n "$code" ] && break; sleep 0.25; done
  [ -n "$code" ] || return 1
  google-chrome --new-window "chrome-extension://${BROWSE_EXTENSION_ID}/welcome.html#code=$code" > /dev/null 2>&1 < /dev/null
  for i in $(seq 40); do connected && return 0; sleep 0.5; done
  return 1
}
if ! connected; then
  echo "Pairing the VM's Chrome with browse…"
  # A second try covers an extension that wasn't listening yet (just installed, or Chrome just started).
  pair || { close_setup; sleep 2; pair; }
  close_setup
  if ! connected; then
    echo "The VM's Chrome didn't connect to browse. Call vm_browser again to retry; don't run browse install or browse pair yourself." >&2
    tail -5 /tmp/dex-browse-pair.log >&2
    exit 1
  fi
fi
close_setup
# The session's tab: the one kept for it while it's still among the session's tabs (a VM restart or idle cleanup
# closes them), else a new one.
mkdir -p "${TABS_DIR}"
tab=$(cat "${TABS_DIR}/${session}" 2> /dev/null || true)
if [ -z "$tab" ] || ! browse tabs --group ${session} 2> /dev/null | python3 -c 'import json, sys; sys.exit(0 if any(str(t.get("tab")) == sys.argv[1] for t in json.load(sys.stdin).get("tabs", [])) else 1)' "$tab" 2> /dev/null; then
  # Keep tabs an hour (chats come back to a page), and ungrouped, so the new tab is the window's last.
  browse settings --json '{"set":{"idleMinutes":60,"grouping":"none"}}' > /dev/null 2>&1 || true
  tab=$(browse tabs new --group ${session} 2> /tmp/dex-browse-tab.log | python3 -c 'import json, sys; print(json.load(sys.stdin)["tab"])' 2> /dev/null || true)
  if [ -z "$tab" ]; then
    echo "The VM's browser couldn't open a tab. Call vm_browser again to retry." >&2
    tail -5 /tmp/dex-browse-tab.log >&2
    exit 1
  fi
  echo "$tab" > "${TABS_DIR}/${session}"
  # Show it on the desktop: Chrome's Ctrl+9 selects a window's last tab.
  for w in $(xdotool search --onlyvisible --class 'chrom' 2> /dev/null); do
    xdotool windowactivate --sync "$w" key --clearmodifiers ctrl+9 2> /dev/null || true
  done
fi`
