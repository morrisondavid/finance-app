#!/usr/bin/env bash
# Install Caddy on Amazon Linux 2023 (aarch64 or x86_64) from GitHub release assets.
set -euo pipefail

ARCH=$(uname -m)
case "$ARCH" in
  aarch64|arm64) CADDY_ARCH="arm64" ;;
  x86_64) CADDY_ARCH="amd64" ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

VERSION="${CADDY_VERSION:-2.8.4}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${VERSION}/caddy_${VERSION}_linux_${CADDY_ARCH}.tar.gz" \
  | tar -xz -C "$TMP"
sudo mv "$TMP/caddy" /usr/local/bin/caddy
sudo chmod +x /usr/local/bin/caddy

sudo useradd --system --home /var/lib/caddy --shell /sbin/nologin caddy 2>/dev/null || true
sudo mkdir -p /etc/caddy /var/lib/caddy
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
sudo cp "${SCRIPT_DIR}/caddy/Caddyfile.example" /etc/caddy/Caddyfile
echo "Edit /etc/caddy/Caddyfile if needed (default is finances.traxiproducts.com), then: sudo /usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"
echo "For a systemd unit, see https://caddyserver.com/docs/running#using-service"
