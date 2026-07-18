#!/usr/bin/env bash

require_production_env() {
  local env_file="$1"
  if [[ ! -f "${env_file}" ]]; then
    echo "[deploy] FATAL: missing ${env_file}" >&2
    echo "[deploy] scp deploy/hostinger/production-env.local.sh from your laptop (do not cp the example over an existing file)." >&2
    exit 1
  fi
  # shellcheck source=/dev/null
  source "${env_file}"
  if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
    echo "[deploy] FATAL: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY empty in ${env_file}" >&2
    echo "[deploy] You may have run: cp production-env.local.example.sh production-env.local.sh" >&2
    echo "[deploy] That overwrites secrets. scp the real file from your laptop instead." >&2
    exit 1
  fi
  if [[ -z "${BANK_SITE_ACCESS_SECRET:-}" || -z "${MCP_BEARER_TOKEN:-}" ]]; then
    echo "[deploy] FATAL: BANK_SITE_ACCESS_SECRET and MCP_BEARER_TOKEN required in ${env_file}" >&2
    exit 1
  fi
}
