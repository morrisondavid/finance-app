#!/usr/bin/env bash
# Run on the Hostinger VPS after image is loaded locally (see OPERATOR-image-transfer.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/config.sh"

SITE_ENV_LOCAL="${ROOT}/production-env.local.sh"
if [[ -f "${SITE_ENV_LOCAL}" ]]; then
  # shellcheck source=/dev/null
  source "${SITE_ENV_LOCAL}"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[04] docker not found — run 01-host-install-docker.sh first." >&2
  exit 1
fi

if ! docker image inspect "${BANK_APP_IMAGE}" >/dev/null 2>&1; then
  echo "[04] FATAL: image ${BANK_APP_IMAGE} not found locally. Load it per OPERATOR-image-transfer.md" >&2
  exit 1
fi

export NODE_ENV=production

BUCKET="${BANK_S3_DURABLE_BUCKET:-${BUCKET_DATA}}"
PREFIX="${BANK_S3_DURABLE_PREFIX:-bank-state/prod}"
PREFIX="${PREFIX#/}"
PREFIX="${PREFIX%/}"

docker rm -f bank 2>/dev/null || true

DEST_ROOT=/opt/bank-app
sudo mkdir -p "${DEST_ROOT}"
sudo chown -R "${USER}:${USER}" "${DEST_ROOT}"

if ! command -v aws >/dev/null 2>&1; then
  echo "[04] aws CLI not found — install awscli v2 (required for S3 durable sync)." >&2
  exit 1
fi

if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  echo "[04] FATAL: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in production-env.local.sh" >&2
  exit 1
fi

REMOTE_BASE="s3://${BUCKET}/${PREFIX}"
echo "[04] Syncing durable dirs from ${REMOTE_BASE}/ …"

S3_SYNC_FROM_REMOTE_FLAGS=(--region "${AWS_REGION}" --delete --exact-timestamps)

force_pull_s3_object() {
  local rel="$1"
  local dest="${DEST_ROOT}/${rel}"
  local remote="${REMOTE_BASE}/${rel}"
  if aws s3api head-object --bucket "${BUCKET}" --key "${PREFIX}/${rel}" --region "${AWS_REGION}" >/dev/null 2>&1; then
    mkdir -p "$(dirname "${dest}")"
    echo "[04]   force-pull ${rel}"
    aws s3 cp "${remote}" "${dest}" --region "${AWS_REGION}" --only-show-errors
  fi
}

DIRS=(
  statements budgets obligations debts deadlines net-worth
  autonize-it clients working-days reserves invoices debt-strategy
)

for d in "${DIRS[@]}"; do
  mkdir -p "${DEST_ROOT}/${d}"
  echo "[04]   sync ${d}/ …"
  aws s3 sync "${REMOTE_BASE}/${d}/" "${DEST_ROOT}/${d}/" "${S3_SYNC_FROM_REMOTE_FLAGS[@]}"
done

FORCE_PULL_REL_PATHS=(
  invoices/invoices.csv
  invoices/invoice_payments.csv
)
for rel in "${FORCE_PULL_REL_PATHS[@]}"; do
  force_pull_s3_object "${rel}"
done

mkdir -p "${DEST_ROOT}/data/truelayer-feed-cache"
aws s3 sync "${REMOTE_BASE}/data/" "${DEST_ROOT}/data/" --region "${AWS_REGION}" --delete \
  --exclude 'transactions.db*'

rm -f \
  "${DEST_ROOT}/data/transactions.db" \
  "${DEST_ROOT}/data/transactions.db-wal" \
  "${DEST_ROOT}/data/transactions.db-shm"

if [[ -n "${BANK_EXPECT_SOURCE_SHA256:-}" ]]; then
  echo '[04] Verifying BANK_EXPECT_SOURCE_SHA256 …'
  ACTUAL_HEX="$(docker run --rm "${BANK_APP_IMAGE}" node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync("/app/dist/source-hash.json","utf8")).value);')"
  if [[ "${ACTUAL_HEX}" != "${BANK_EXPECT_SOURCE_SHA256}" ]]; then
    echo "[04] FATAL: expected ${BANK_EXPECT_SOURCE_SHA256}; image has ${ACTUAL_HEX}." >&2
    exit 1
  fi
fi

echo "[04] Starting container…"

docker run -d --name bank --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v /opt/bank-app/data:/app/data \
  -v /opt/bank-app/statements:/app/statements \
  -v /opt/bank-app/invoices:/app/invoices \
  -v /opt/bank-app/budgets:/app/budgets \
  -v /opt/bank-app/obligations:/app/obligations \
  -v /opt/bank-app/debts:/app/debts \
  -v /opt/bank-app/deadlines:/app/deadlines \
  -v /opt/bank-app/net-worth:/app/net-worth \
  -v /opt/bank-app/autonize-it:/app/autonize-it \
  -v /opt/bank-app/clients:/app/clients \
  -v /opt/bank-app/working-days:/app/working-days \
  -v /opt/bank-app/reserves:/app/reserves \
  -v /opt/bank-app/debt-strategy:/app/debt-strategy \
  -v /opt/bank-app/secrets:/opt/bank-app/secrets:ro \
  -e NODE_ENV \
  -e "AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}" \
  -e "AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}" \
  -e "AWS_REGION=${AWS_REGION}" \
  -e "AWS_DEFAULT_REGION=${AWS_REGION}" \
  -e "ENABLE_BANKING_APP_ID=${ENABLE_BANKING_APP_ID:-}" \
  -e "ENABLE_BANKING_REDIRECT_URL=${ENABLE_BANKING_REDIRECT_URL:-}" \
  -e "ENABLE_BANKING_PRIVATE_KEY_PATH=/opt/bank-app/secrets/enable-banking-private.pem" \
  -e "TRUELAYER_CLIENT_ID=${TRUELAYER_CLIENT_ID:-}" \
  -e "TRUELAYER_CLIENT_SECRET=${TRUELAYER_CLIENT_SECRET:-}" \
  -e "TRUELAYER_REDIRECT_URL=${TRUELAYER_REDIRECT_URL:-}" \
  -e "TRUELAYER_AUTH_BASE=${TRUELAYER_AUTH_BASE:-}" \
  -e "TRUELAYER_API_BASE=${TRUELAYER_API_BASE:-}" \
  -e "TRUELAYER_END_USER_EMAIL=${TRUELAYER_END_USER_EMAIL:-}" \
  -e "BANK_S3_DURABLE_BUCKET=${BUCKET}" \
  -e "BANK_S3_DURABLE_PREFIX=${PREFIX}" \
  -e "BANK_S3_DURABLE_SSE_KMS_KEY_ID=${BANK_S3_DURABLE_SSE_KMS_KEY_ID:-}" \
  -e BANK_STATEMENTS_SKIP_INIT_WHEN_MANIFEST_UNCHANGED=0 \
  -e "BANK_READ_CACHE_TTL_SECONDS=${BANK_READ_CACHE_TTL_SECONDS:-60}" \
  -e "BANK_SITE_ACCESS_SECRET=${BANK_SITE_ACCESS_SECRET:-}" \
  -e "BANK_SITE_LOGIN_PASSWORD=${BANK_SITE_LOGIN_PASSWORD:-}" \
  -e "MCP_BEARER_TOKEN=${MCP_BEARER_TOKEN:-}" \
  "${BANK_APP_IMAGE}"

echo "App listens on 127.0.0.1:3000 — Caddy serves https://${BANK_APP_PUBLIC_HOSTNAME}"
if [[ -n "${MCP_BEARER_TOKEN:-}" ]]; then
  echo "MCP: https://${BANK_APP_PUBLIC_HOSTNAME}/mcp (Authorization: Bearer MCP_BEARER_TOKEN)"
fi
