#!/usr/bin/env bash
# Push authoritative invoices/ tree from the laptop repo to the durable S3 prefix.
# Use when ingested PDFs were renamed (UK→EG) but invoices.csv / invoice_payments.csv
# were not yet uploaded — 09 on EC2 will keep pulling UK rows until these CSVs are on S3.
#
#   cd bank-statements-app && ./deploy/aws/push-invoices-to-s3.sh
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
PREFIX="${PREFIX#/}"
PREFIX="${PREFIX%/}"
DEST="s3://${BUCKET_DATA}/${PREFIX}/invoices"

SRC="${REPO}/invoices"
if [[ ! -d "${SRC}" ]]; then
  echo "Missing ${SRC}" >&2
  exit 1
fi

echo "Pushing ${SRC}/ → ${DEST}/"
aws s3 sync "${SRC}/" "${DEST}/" --region "${AWS_REGION}"

echo ""
echo "Verify la-fosse id prefix on S3:"
aws s3 cp "${DEST}/invoices.csv" - --region "${AWS_REGION}" \
  | grep ',la-fosse,' | head -1 | cut -d, -f1

echo ""
echo "On EC2: cd ~/bank-deploy-aws && ./09-docker-run-production.sh"
