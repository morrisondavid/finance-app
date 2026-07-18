#!/usr/bin/env bash
# One-shot VPS bootstrap: Docker, AWS CLI, dirs, Caddy. Run once after scp'ing this folder.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "${ROOT}"

chmod +x "${ROOT}"/*.sh "${ROOT}"/lib/*.sh 2>/dev/null || true

echo "== [00] Docker + AWS CLI =="
"${ROOT}/01-host-install-docker.sh"

echo ""
echo "== [00] Durable mount dirs =="
"${ROOT}/02-host-create-dirs.sh"

echo ""
echo "== [00] Caddy =="
"${ROOT}/03-install-caddy.sh"

echo ""
echo "[00] Bootstrap done."
echo "[00] Next:"
echo "  1. scp production-env.local.sh from your laptop (do NOT cp the example over an existing file)"
echo "  2. cp config.example.sh config.sh && edit if needed"
echo "  3. gunzip -c ~/bank-app-latest.tar.gz | docker load"
echo "  4. ./04-docker-run-production.sh"
echo "  5. sudo systemctl start caddy"
