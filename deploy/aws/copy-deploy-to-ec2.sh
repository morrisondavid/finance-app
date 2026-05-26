#!/usr/bin/env bash
# From your laptop at repo root: copy deploy/aws scripts to EC2 (flat ~/bank-deploy-aws).
# Uses tar over SSH only — Amazon Linux often has no rsync on the remote side.
#
# Preserves server-only files: streamed archive excludes production-env.local.sh and config.sh
# so existing copies on the host are left untouched when you extract over the directory.
#
# Prerequisites: ssh + tar locally and on the host; deploy/aws/.elastic-ip (or set EC2_IP); PEM at SSH_KEY.
#
# Usage:
#   ./deploy/aws/copy-deploy-to-ec2.sh
#   EC2_IP=1.2.3.4 SSH_KEY=~/.ssh/my.pem ./deploy/aws/copy-deploy-to-ec2.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SSH_KEY="${SSH_KEY:-${HOME}/.ssh/traxiproducts-finances-bank-app-eu-west-2.pem}"
EC2_USER="${EC2_USER:-ec2-user}"
REMOTE_DIR="${REMOTE_DIR:-bank-deploy-aws}"
REMOTE_REL="${REMOTE_DIR#/}" # drop leading /
REMOTE_REL="${REMOTE_REL%/}"

SENTINEL='Final pull' # marker in ./09-docker-run-production.sh (post-sync docker pull — must survive copy)

if [[ -z "${REMOTE_REL}" || "${REMOTE_REL}" == */* ]]; then
  echo "REMOTE_DIR must be a single relative path segment (no slashes); got '${REMOTE_DIR}'" >&2
  exit 1
fi

if [[ ! -f "${SCRIPT_DIR}/09-docker-run-production.sh" ]]; then
  echo "Missing ${SCRIPT_DIR}/09-docker-run-production.sh (run from a full repo checkout)." >&2
  exit 1
fi

if ! grep -Fq "${SENTINEL}" "${SCRIPT_DIR}/09-docker-run-production.sh"; then
  echo "Local 09-docker-run-production.sh lacks expected deploy logic (missing grep match for ${SENTINEL}). Update your repo checkout." >&2
  exit 1
fi

if [[ -n "${EC2_IP:-}" ]]; then
  HOST="${EC2_IP}"
else
  IP_FILE="${SCRIPT_DIR}/.elastic-ip"
  if [[ ! -f "${IP_FILE}" ]]; then
    echo "Set EC2_IP or create ${IP_FILE} with the instance public IP (one line)." >&2
    exit 1
  fi
  HOST="$(tr -d '[:space:]' < "${IP_FILE}")"
fi

if [[ -z "${HOST}" ]]; then
  echo "Could not resolve EC2 host (EC2_IP empty and .elastic-ip missing/empty)." >&2
  exit 1
fi

if [[ ! -f "${SSH_KEY}" ]]; then
  echo "SSH key not found: ${SSH_KEY} (set SSH_KEY=...)" >&2
  exit 1
fi

echo "[copy-deploy-to-ec2] ${SCRIPT_DIR}/ → ${EC2_USER}@${HOST}:~/${REMOTE_REL}/ (tar over SSH)"

# Extract under \$HOME explicitly (login cwd is usually ~ but not guaranteed).
# shellcheck disable=SC2029 # intentional: interpolate REMOTE_REL on the sender for a fixed remote path
tar -C "${SCRIPT_DIR}" \
  --exclude='production-env.local.sh' \
  --exclude='config.sh' \
  --exclude='.elastic-ip' \
  -cf - . | ssh -i "${SSH_KEY}" "${EC2_USER}@${HOST}" "mkdir -p \"\$HOME/${REMOTE_REL}\" && tar -C \"\$HOME/${REMOTE_REL}\" -xf -"

echo "[copy-deploy-to-ec2] Verifying remote 09-docker-run-production.sh …"
# shellcheck disable=SC2029
if ! ssh -i "${SSH_KEY}" "${EC2_USER}@${HOST}" "grep -Fq '${SENTINEL}' \"\$HOME/${REMOTE_REL}/09-docker-run-production.sh\""; then
  echo "[copy-deploy-to-ec2] ERROR: remote ${REMOTE_REL}/09-docker-run-production.sh missing marker line (${SENTINEL})." >&2
  echo "[copy-deploy-to-ec2] On the server try: grep -Fq '${SENTINEL}' \"\$HOME/${REMOTE_REL}/09-docker-run-production.sh\"" >&2
  echo "[copy-deploy-to-ec2] If you run ./09 elsewhere (e.g. nested aws/), use only ~/${REMOTE_REL}/ copies." >&2
  exit 1
fi

echo "[copy-deploy-to-ec2] Done. On EC2: cd \"~/${REMOTE_REL}\" && ./09-docker-run-production.sh"
