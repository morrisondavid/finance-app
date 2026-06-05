#!/usr/bin/env bash
# Idempotently install 16:00 + 23:00 Europe/London feed sync crontab for ec2-user.
# Run once on the EC2 host after deploy (not part of 09-docker-run-production.sh).
#
# Amazon Linux 2023 minimal images often omit cron — this script installs cronie when needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
WRAPPER="${ROOT}/feed-sync-all.sh"
MARKER="# bank-statements-app feed-sync-all"
LOG_FILE="/var/log/bank-feed-sync.log"

ensure_crontab_available() {
  if command -v crontab >/dev/null 2>&1; then
    return 0
  fi
  echo "[install-feed-sync-cron] crontab not found — installing cron package…" >&2
  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y cronie
    sudo systemctl enable --now crond
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y cronie
    sudo systemctl enable --now crond
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y cron
    sudo systemctl enable --now cron
  else
    echo "[install-feed-sync-cron] FATAL: install cron manually (e.g. sudo dnf install -y cronie)." >&2
    exit 1
  fi
  if ! command -v crontab >/dev/null 2>&1; then
    echo "[install-feed-sync-cron] FATAL: crontab still missing after package install." >&2
    exit 1
  fi
}

ensure_log_file_writable() {
  if [[ -w "${LOG_FILE}" ]]; then
    return 0
  fi
  if [[ ! -e "${LOG_FILE}" ]]; then
    sudo touch "${LOG_FILE}"
    sudo chown "${USER}:${USER}" "${LOG_FILE}"
    sudo chmod 644 "${LOG_FILE}"
  fi
}

ensure_crontab_available
ensure_log_file_writable

if [[ ! -x "${WRAPPER}" ]]; then
  chmod +x "${WRAPPER}"
fi

# Resolve path for crontab (symlink-safe)
WRAPPER_ABS="$(cd "$(dirname "${WRAPPER}")" && pwd)/$(basename "${WRAPPER}")"

FRAGMENT="$(mktemp)"
trap 'rm -f "${FRAGMENT}"' EXIT

cat > "${FRAGMENT}" <<EOF
TZ=Europe/London
${MARKER}
0 16 * * * ${WRAPPER_ABS} >> ${LOG_FILE} 2>&1
0 23 * * * ${WRAPPER_ABS} >> ${LOG_FILE} 2>&1
EOF

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "${EXISTING}" | grep -v "${MARKER}" | grep -v 'feed-sync-all.sh' || true)"

{
  printf '%s\n' "${FILTERED}" | sed '/^[[:space:]]*$/d'
  cat "${FRAGMENT}"
} | crontab -

echo "[install-feed-sync-cron] Installed 16:00 and 23:00 Europe/London → ${WRAPPER_ABS}"
echo "[install-feed-sync-cron] Logs: ${LOG_FILE}"
crontab -l | grep -E 'feed-sync|TZ=Europe' || true
