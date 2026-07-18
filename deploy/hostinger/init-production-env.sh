#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TARGET="${ROOT}/production-env.local.sh"
EXAMPLE="${ROOT}/production-env.local.example.sh"

if [[ -f "${TARGET}" ]]; then
  echo "[init-env] Refusing to overwrite existing ${TARGET}" >&2
  echo "[init-env] Edit in place, or scp a new file from your laptop." >&2
  exit 1
fi

if [[ ! -f "${EXAMPLE}" ]]; then
  echo "[init-env] FATAL: missing ${EXAMPLE}" >&2
  exit 1
fi

cp "${EXAMPLE}" "${TARGET}"
chmod 600 "${TARGET}"
echo "[init-env] Created ${TARGET} from example — fill in secrets before ./04-docker-run-production.sh"
