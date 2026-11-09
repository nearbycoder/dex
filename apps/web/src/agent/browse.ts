/**
 * The VM's browser for agents: browse (https://opencode.ai/browse, by Anomaly) runs Playwright code in the VM's own
 * Chrome through its extension, so the agent browses in a real, visible browser with its cookies and logins, on the
 * desktop the user watches, instead of a headless one. The browse CLI lives on the VM; its extension is force-installed
 * by Chromium policy and paired with the CLI's local relay the first time a chat browses (each VM pairs its own, so no
 * pairing key is baked into the template).
 */
export const BROWSE_EXTENSION_ID = "mfnicocicmmlkpjnaffgihfjhdgjkdjg"

/**
 * Installs browse's CLI (into ~/.local/bin, where its own updater keeps it current) and has Chrome install the
 * extension from the Web Store. boat's Chrome is a Chromium build, which reads /etc/chromium/policies; the Google
 * Chrome path is written too in case the image switches. Idempotent; run on the template builder and, from
 * BROWSE_READY, on VMs made before the template had it.
 */
export const BROWSE_BAKE = `set -e
policy='{"ExtensionInstallForcelist":["${BROWSE_EXTENSION_ID};https://clients2.google.com/service/update2/crx"]}'
for dir in /etc/chromium/policies/managed /etc/opt/chrome/policies/managed; do
  sudo mkdir -p "$dir"
  echo "$policy" | sudo tee "$dir/dex-browse.json" > /dev/null
done
if [ ! -x "$HOME/.local/bin/browse" ]; then
  curl -fsSL https://opencode.ai/browse/install -o /tmp/browse-install.sh
  sh /tmp/browse-install.sh --no-setup > /tmp/browse-install.log 2>&1 || { tail -20 /tmp/browse-install.log >&2; exit 1; }
  rm -f /tmp/browse-install.sh /tmp/browse-install.log
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

/**
 * Gets the VM's browser ready for `browse execute --session <session>`: browse installed, Chrome open on the desktop,
 * its extension connected to the relay (pairing it the first time, by opening the extension's welcome page with a
 * fresh one-time code, as `browse install` does), and the session created (`session` must be a plain lowercase id,
 * it goes into the script as is). Quick when all of that already holds. Runs in the caller's shell (its exports are
 * for the commands after it) and exits it when the browser can't be made ready.
 * The relay is allowed to raise the agent's tab (OPENCODE_BROWSER_ALLOW_FOREGROUND), so the user watching the desktop
 * sees the page the agent is on rather than a background tab.
 */
export const browseReady = (session: string) => `export DISPLAY=:0 OPENCODE_BROWSER_ALLOW_FOREGROUND=1 PATH="$HOME/.local/bin:$PATH"
cd ~
[ -x "$HOME/.local/bin/browse" ] || ( ${BROWSE_BAKE} ) || exit 1
connected() { browse status 2>/dev/null | grep -q '^Extension: connected'; }
# Any operational command starts the relay (stopped after a VM stop); a paired extension reconnects within seconds.
browse session list > /dev/null 2>&1 || true
if ! connected; then
  if ! pgrep -x chrome > /dev/null; then
    # A lock left by another machine (this disk copied from a VM whose Chrome was open) would make Chrome refuse the profile.
    rm -f "$HOME"/.config/google-chrome/Singleton*
    setsid nohup google-chrome --no-first-run --no-default-browser-check --start-maximized --hide-crash-restore-bubble > /tmp/dex-chrome.log 2>&1 < /dev/null &
  fi
  for i in $(seq 60); do [ -d "$HOME/.config/google-chrome/Default/Extensions/${BROWSE_EXTENSION_ID}" ] && break; sleep 0.5; done
  for i in $(seq 12); do connected && break; sleep 0.5; done
fi
if ! connected; then
  echo "Pairing the VM's Chrome with browse…"
  rm -f /tmp/dex-browse-pair.log
  setsid nohup browse pair --wait-seconds 60 > /tmp/dex-browse-pair.log 2>&1 < /dev/null &
  code=""
  for i in $(seq 40); do code=$(grep -o 'Pairing code: [0-9A-Za-z-]*' /tmp/dex-browse-pair.log 2>/dev/null | cut -d' ' -f3); [ -n "$code" ] && break; sleep 0.25; done
  [ -n "$code" ] || { cat /tmp/dex-browse-pair.log >&2; exit 1; }
  google-chrome "chrome-extension://${BROWSE_EXTENSION_ID}/welcome.html#code=$code" > /dev/null 2>&1 < /dev/null
  for i in $(seq 60); do connected && break; sleep 0.5; done
  connected || { echo "The VM's Chrome didn't connect to browse." >&2; cat /tmp/dex-browse-pair.log >&2; browse status >&2; exit 1; }
  # Show the agent's cursor and keep its tabs an hour: the user is watching, and chats come back to a page.
  browse settings set cursor=always idleMinutes=60 > /dev/null 2>&1 || true
fi
browse session new ${session} > /dev/null 2>&1 || true`
