/**
 * The VM desktop stream. Selkies (https://github.com/selkies-project/selkies, MPL-2.0) sends the VM's screen as
 * H.264 over one WebSocket, decoded by WebCodecs, so it plays in Safari too, unlike boat's Stream player. Its web
 * client ships with Dex (public/assets/selkies), so the version installed here must match it.
 */
export const SELKIES_VERSION = "2.0.0"
export const SELKIES_PORT = 8082

/**
 * Installs Selkies as an enabled systemd service, so it starts with the VM and again after every stop and resume.
 * On first start each VM picks its own random password, kept on the VM; the stream needs it as well as boat's port
 * cookie, and only Dex's Worker holds both. The desktop keeps its size (the agent's screenshots and clicks depend on
 * it); the viewer scales the picture. Run once on a template builder, or on a VM made before the template existed.
 */
export const SELKIES_BAKE = `set -e
if ! dpkg-query -W -f='\${Version}' selkies 2>/dev/null | grep -q '^${SELKIES_VERSION}-'; then
  cd /tmp
  curl -fsSLo selkies.deb "https://github.com/selkies-project/selkies/releases/download/${SELKIES_VERSION}/selkies-${SELKIES_VERSION}-ubuntu24.04-$(dpkg --print-architecture).deb"
  sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 install -y -q ./selkies.deb > /tmp/selkies-install.log 2>&1 || { tail -20 /tmp/selkies-install.log >&2; exit 1; }
  rm -f selkies.deb
fi
sudo tee /usr/local/bin/dex-selkies > /dev/null <<'EOS'
#!/bin/bash
set -e
dir="$HOME/.config/dex"
mkdir -p "$dir" && chmod 700 "$dir"
[ -s "$dir/selkies.pw" ] || (umask 077; head -c 48 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 32 > "$dir/selkies.pw")
export DISPLAY=:0 XDG_RUNTIME_DIR=/run/user/$(id -u)
export SELKIES_BASIC_AUTH_PASSWORD="$(cat "$dir/selkies.pw")"
# Wait for the desktop session: X answers once the user is signed in.
for i in $(seq 60); do xdpyinfo > /dev/null 2>&1 && break; sleep 1; done
exec selkies --public --port=${SELKIES_PORT} --enable-https=false --basic-auth-user=dex --enable-resize=false \\
  --audio-enabled=false --microphone-enabled=false --gamepad-enabled=false --ui-show-logo=false
EOS
sudo chmod 755 /usr/local/bin/dex-selkies
sudo tee /etc/systemd/system/dex-selkies.service > /dev/null <<'UNIT'
[Unit]
Description=Dex desktop stream (Selkies)
After=display-manager.service network.target

[Service]
User=user
Environment=HOME=/home/user
ExecStart=/usr/local/bin/dex-selkies
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable dex-selkies > /dev/null 2>&1`

/** Makes sure the stream runs on a VM (baking it first if the VM predates the template), then prints the password. */
export const SELKIES_SETUP = `${SELKIES_BAKE}
answer() { curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${SELKIES_PORT}/ || true; }
if [ "$(answer)" != 401 ]; then
  sudo systemctl restart dex-selkies
  for i in $(seq 60); do [ "$(answer)" = 401 ] && break; sleep 0.5; done
  [ "$(answer)" = 401 ] || { sudo journalctl -u dex-selkies --no-pager -n 20 >&2; exit 1; }
fi
cat ~/.config/dex/selkies.pw`

/** The template builder's last step: no password or logs in the saved disk, so each VM made from it picks its own. */
export const SELKIES_TEMPLATE_CLEANUP = `sudo systemctl stop dex-selkies 2>/dev/null || true
rm -f ~/.config/dex/selkies.pw /tmp/selkies*
sudo apt-get clean
sync`
