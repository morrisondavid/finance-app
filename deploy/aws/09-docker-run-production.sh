#!/usr/bin/env bash
# Run on the server (clone repo or copy deploy/aws/ + config.sh).
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

export NODE_ENV=production

docker rm -f bank 2>/dev/null || true

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
  -v /opt/bank-app/secrets:/opt/bank-app/secrets:ro \
  -e NODE_ENV \
  -e ENABLE_BANKING_APP_ID \
  -e ENABLE_BANKING_REDIRECT_URL \
  -e "ENABLE_BANKING_PRIVATE_KEY_PATH=/opt/bank-app/secrets/enable-banking-private.pem" \
  -e AWS_REGION \
  -e "AWS_DEFAULT_REGION=${AWS_REGION}" \
  -e "BANK_S3_DURABLE_SYNC=${BANK_S3_DURABLE_SYNC:-0}" \
  -e BANK_S3_DURABLE_BUCKET \
  -e BANK_S3_DURABLE_PREFIX \
  -e "BANK_S3_DURABLE_SSE_KMS_KEY_ID=${BANK_S3_DURABLE_SSE_KMS_KEY_ID:-}" \
  -e "BANK_S3_DURABLE_PUSH_INTERVAL_MS=${BANK_S3_DURABLE_PUSH_INTERVAL_MS:-1800000}" \
  -e "BANK_SITE_ACCESS_SECRET=${BANK_SITE_ACCESS_SECRET:-}" \
  -e "BANK_SITE_LOGIN_PASSWORD=${BANK_SITE_LOGIN_PASSWORD:-}" \
  "$BANK_APP_IMAGE"

echo "App listens on 127.0.0.1:3000 — Caddy serves https://${BANK_APP_PUBLIC_HOSTNAME}"
