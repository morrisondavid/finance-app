#!/usr/bin/env bash
# One-time (or occasional) seed: upload authoritative durable trees from your laptop to S3.
# Run from repo root OR set BANK_STATEMENTS_REPO_ROOT to the repo directory.
#
#   cd bank-statements-app && ./deploy/aws/12-s3-seed-durable-from-local.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/config.sh"

REPO="${BANK_STATEMENTS_REPO_ROOT:-}"
if [[ -z "${REPO}" ]]; then
  REPO="$(cd "${SCRIPT_DIR}/../.." && pwd)"
fi

PREFIX="${BANK_S3_DURABLE_PREFIX:-bank-state/prod}"
DEST_ROOT="s3://${BUCKET_DATA}/${PREFIX}"

echo "Seeding ${DEST_ROOT} from ${REPO}"

DB="${REPO}/data/transactions.db"
if [[ -f "${DB}" ]] && command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DB}" "PRAGMA wal_checkpoint(TRUNCATE);"
  echo "SQLite WAL checkpoint(truncate) completed"
elif [[ -f "${DB}" ]]; then
  echo "WARN: sqlite3 CLI not found — uploading DB as-is (may include -wal/-shm sidecars)"
fi

DIRS=(
  statements budgets obligations debts deadlines net-worth
  autonize-it clients working-days reserves invoices data
)

for d in "${DIRS[@]}"; do
  src="${REPO}/${d}"
  if [[ ! -d "${src}" ]]; then
    echo "SKIP (missing dir): ${d}"
    continue
  fi
  if [[ "${d}" == 'data' ]]; then
    aws s3 sync "${src}/" "${DEST_ROOT}/${d}/" --exclude 'enable-sessions.json'
  else
    aws s3 sync "${src}/" "${DEST_ROOT}/${d}/"
  fi
  echo "Synced ${d}/"
done

echo "Done. EC2 containers with BANK_S3_DURABLE_SYNC=1 pull this prefix on boot."
