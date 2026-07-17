#!/usr/bin/env bash
# Operator: pull TrueLayer feed JSON cache from S3 to local repo (read-only replay).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

if [[ -f "${ROOT}/.env.local" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT}/.env.local"
  set +a
fi

BUCKET="${BANK_S3_DURABLE_BUCKET:-traxiproducts-finances-bank-app-data-eu-west-2}"
PREFIX="${BANK_S3_DURABLE_PREFIX:-bank-state/prod}"
PREFIX="${PREFIX#/}"
PREFIX="${PREFIX%/}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-eu-west-2}}"

DEST="${ROOT}/data/truelayer-feed-cache"
REMOTE="s3://${BUCKET}/${PREFIX}/data/truelayer-feed-cache/"

mkdir -p "${DEST}"
echo "Syncing ${REMOTE} → ${DEST}/"
aws s3 sync "${REMOTE}" "${DEST}/" --region "${REGION}"
echo "Done. Feed sync will use S3 cache automatically when BANK_S3_DURABLE_BUCKET is set."
