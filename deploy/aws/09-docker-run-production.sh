#!/usr/bin/env bash
# Run on the server (copy deploy/aws/ from the repo and ensure `config.sh` exists — see README).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/config.sh"

# Server-only secrets next to these scripts on the host (`chmod 600`). Not in git.
SITE_ENV_LOCAL="${ROOT}/production-env.local.sh"
if [[ -f "${SITE_ENV_LOCAL}" ]]; then
  # shellcheck source=/dev/null
  source "${SITE_ENV_LOCAL}"
fi

if [[ -z "${BANK_APP_IMAGE}" ]]; then
  ACCT=$(aws sts get-caller-identity --query Account --output text)
  BANK_APP_IMAGE="${ACCT}.dkr.ecr.${AWS_REGION}.amazonaws.com/${BANK_APP_ECR_REPO_NAME}:latest"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[09] docker not found on PATH — install Docker before running this script." >&2
  exit 1
fi

REGISTRY="${BANK_APP_IMAGE%%/*}"
if [[ "${REGISTRY}" == *".dkr.ecr."* ]]; then
  if ! command -v aws >/dev/null 2>&1; then
    echo "[09] aws CLI not found — required for ECR login/pull." >&2
    exit 1
  fi
  aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${REGISTRY}"
fi

print_image_digest() {
  local d
  d="$(docker image inspect "${BANK_APP_IMAGE}" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"
  if [[ -n "${d}" ]]; then
    echo "[09] Registry digest for ${BANK_APP_IMAGE}: ${d}"
  else
    echo "[09] Warning: could not read RepoDigests for ${BANK_APP_IMAGE} (inspect locally)." >&2
  fi
}

echo "[09] Prefetch ${BANK_APP_IMAGE} (layers while old container may still be running) …"
docker pull "${BANK_APP_IMAGE}"
print_image_digest

export NODE_ENV=production

BUCKET="${BANK_S3_DURABLE_BUCKET:-${BUCKET_DATA}}"
PREFIX="${BANK_S3_DURABLE_PREFIX:-bank-state/prod}"
PREFIX="${PREFIX#/}"
PREFIX="${PREFIX%/}"

docker rm -f bank 2>/dev/null || true

# Bind mounts were written by the container as root; `aws s3 sync` runs as ${USER}
# and cannot place temp/part files beside root-owned objects without ownership fix.
DEST_ROOT=/opt/bank-app
sudo mkdir -p "${DEST_ROOT}"
sudo chown -R "${USER}:${USER}" "${DEST_ROOT}"

# S3 ↔ local (--delete mirrors remote). Paths must align with ../../server/storage/durable-paths.ts (DURABLE_TOP_LEVEL_DIRS + data/, excluding enable-sessions.json).
if ! command -v aws >/dev/null 2>&1; then
  echo "[09] aws CLI not found — install awscli v2 before running this deploy (required for durable sync)." >&2
  exit 1
fi

REMOTE_BASE="s3://${BUCKET}/${PREFIX}"
echo "[09] Syncing durable dirs from ${REMOTE_BASE}/ …"

DIRS=(
  statements budgets obligations debts deadlines net-worth
  autonize-it clients working-days reserves invoices
)

for d in "${DIRS[@]}"; do
  mkdir -p "${DEST_ROOT}/${d}"
  aws s3 sync "${REMOTE_BASE}/${d}/" "${DEST_ROOT}/${d}/" --region "${AWS_REGION}" --delete
done

mkdir -p "${DEST_ROOT}/data"
aws s3 sync "${REMOTE_BASE}/data/" "${DEST_ROOT}/data/" --region "${AWS_REGION}" --delete \
  --exclude 'enable-sessions.json' \
  --exclude 'truelayer-tokens.local.json' \
  --exclude 'transactions.db*'

rm -f \
  "${DEST_ROOT}/data/transactions.db" \
  "${DEST_ROOT}/data/transactions.db-wal" \
  "${DEST_ROOT}/data/transactions.db-shm"

# :latest can move on ECR while the S3 sync above runs. Re-resolve the tag so we never
# start `bank` from a manifest that was correct at the start of this script but stale now.
# Drop the local tag so Docker cannot reuse a stale local resolution without hitting the registry again.
echo "[09] Untagging local ${BANK_APP_IMAGE} (safe after bank was removed above) …"
docker image rm -f "${BANK_APP_IMAGE}" 2>/dev/null || true

echo "[09] Final pull ${BANK_APP_IMAGE} (after S3 sync) …"
docker pull "${BANK_APP_IMAGE}"
print_image_digest

if [[ -n "${BANK_EXPECT_SOURCE_SHA256:-}" ]]; then
  echo '[09] Verifying BANK_EXPECT_SOURCE_SHA256 against /app/dist/source-hash.json …'
  ACTUAL_HEX="$(docker run --rm "${BANK_APP_IMAGE}" node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync("/app/dist/source-hash.json","utf8")).value);')"
  if [[ "${ACTUAL_HEX}" != "${BANK_EXPECT_SOURCE_SHA256}" ]]; then
    echo "[09] FATAL: expected sourceSha256 ${BANK_EXPECT_SOURCE_SHA256}; image contains ${ACTUAL_HEX}." >&2
    exit 1
  fi
  echo "[09] sourceSha256 matches BANK_EXPECT_SOURCE_SHA256."
fi

echo "[09] Starting container…"

docker run -d --name bank --restart unless-stopped --pull=always \
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
  -v /opt/bank-app/secrets:/opt/bank-app/secrets:ro \
  -e NODE_ENV \
  -e "ENABLE_BANKING_APP_ID=${ENABLE_BANKING_APP_ID:-}" \
  -e "ENABLE_BANKING_REDIRECT_URL=${ENABLE_BANKING_REDIRECT_URL:-}" \
  -e "ENABLE_BANKING_PRIVATE_KEY_PATH=/opt/bank-app/secrets/enable-banking-private.pem" \
  -e "TRUELAYER_CLIENT_ID=${TRUELAYER_CLIENT_ID:-}" \
  -e "TRUELAYER_CLIENT_SECRET=${TRUELAYER_CLIENT_SECRET:-}" \
  -e "TRUELAYER_REDIRECT_URL=${TRUELAYER_REDIRECT_URL:-}" \
  -e "TRUELAYER_AUTH_BASE=${TRUELAYER_AUTH_BASE:-}" \
  -e "TRUELAYER_API_BASE=${TRUELAYER_API_BASE:-}" \
  -e "TRUELAYER_END_USER_EMAIL=${TRUELAYER_END_USER_EMAIL:-}" \
  -e "AWS_REGION=${AWS_REGION}" \
  -e "AWS_DEFAULT_REGION=${AWS_REGION}" \
  -e "BANK_S3_DURABLE_BUCKET=${BUCKET}" \
  -e "BANK_S3_DURABLE_PREFIX=${PREFIX}" \
  -e "BANK_S3_DURABLE_SSE_KMS_KEY_ID=${BANK_S3_DURABLE_SSE_KMS_KEY_ID:-}" \
  -e BANK_STATEMENTS_SKIP_INIT_WHEN_MANIFEST_UNCHANGED=0 \
  -e "BANK_SITE_ACCESS_SECRET=${BANK_SITE_ACCESS_SECRET:-}" \
  -e "BANK_SITE_LOGIN_PASSWORD=${BANK_SITE_LOGIN_PASSWORD:-}" \
  "$BANK_APP_IMAGE"

echo "App listens on 127.0.0.1:3000 — Caddy serves https://${BANK_APP_PUBLIC_HOSTNAME}"
