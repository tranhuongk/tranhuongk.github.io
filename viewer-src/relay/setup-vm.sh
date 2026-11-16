#!/usr/bin/env bash
# Install the relay on a fresh Ubuntu 24.04+ VM (Oracle Always Free or any VPS).
# Run as root from the directory holding relay.mjs + package.json + package-lock.json:
#   sudo bash setup-vm.sh [public-hostname]
# Without a hostname it uses <public-ip>.sslip.io, so Caddy can get a Let's Encrypt cert
# with no domain to buy. Re-running is safe (updates the relay, keeps the cert).
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR=/opt/uv-relay
PORT=8080

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo" >&2; exit 1; }
# shellcheck disable=SC1091
. /etc/os-release
# Ubuntu 24.04 ships Node 18 and Caddy in its own archive; 22.04 has neither.
if [ "${ID:-}" != ubuntu ] || [ "${VERSION_ID%%.*}" -lt 24 ]; then
  echo "Needs Ubuntu 24.04 or newer (found ${PRETTY_NAME:-unknown})" >&2
  exit 1
fi

echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q nodejs npm caddy curl iptables-persistent

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || { echo "Node >= 18 required, got $(node --version)" >&2; exit 1; }

echo "== relay files"
install -d -m 755 "$APP_DIR"
install -m 644 "$SRC_DIR/relay.mjs" "$SRC_DIR/package.json" "$SRC_DIR/package-lock.json" "$APP_DIR/"
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund)

echo "== systemd service"
cat > /etc/systemd/system/uv-relay.service <<EOF
[Unit]
Description=Web viewer WS<->TCP relay
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$(command -v node) $APP_DIR/relay.mjs
Environment=RELAY_HOST=127.0.0.1 RELAY_PORT=$PORT
Restart=always
RestartSec=2
DynamicUser=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now uv-relay
systemctl restart uv-relay

echo "== hostname"
HOST="${1:-}"
if [ -z "$HOST" ]; then
  PUBIP="$(curl -4 -fsS https://api.ipify.org)"
  HOST="${PUBIP//./-}.sslip.io"
fi
echo "   $HOST"

echo "== caddy (TLS)"
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
	reverse_proxy 127.0.0.1:$PORT
}
EOF
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

echo "== host firewall (Oracle Ubuntu images REJECT everything but 22 by default)"
if ! iptables -C INPUT -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null; then
  iptables -I INPUT 1 -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW -j ACCEPT
fi
netfilter-persistent save >/dev/null

echo "== check"
curl -fsS "http://127.0.0.1:$PORT/healthz"
for _ in $(seq 1 30); do
  if curl -fsS "https://$HOST/healthz" >/dev/null 2>&1; then
    echo "OK  https://$HOST/healthz"
    echo "Relay URL for the viewer:  wss://$HOST"
    exit 0
  fi
  sleep 2
done
echo "Relay runs locally, but https://$HOST is not reachable yet." >&2
echo "Check the cloud firewall (Oracle: VCN Security List ingress TCP 80 and 443 from 0.0.0.0/0)," >&2
echo "then: journalctl -u caddy -n 50" >&2
exit 2
