#!/usr/bin/env bash
# Run on your LAPTOP with admin AWS credentials.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/config.sh"

: "${BUCKET_DATA:?Set BUCKET_DATA in config.sh (globally unique bucket name)}"

if aws s3api head-bucket --bucket "${BUCKET_DATA}" 2>/dev/null; then
  echo "[05-bucket] Bucket already exists: ${BUCKET_DATA}"
  exit 0
fi

echo "[05-bucket] Creating bucket: ${BUCKET_DATA} (${AWS_REGION})"
if [[ "${AWS_REGION}" == "us-east-1" ]]; then
  aws s3api create-bucket --bucket "${BUCKET_DATA}"
else
  aws s3api create-bucket --bucket "${BUCKET_DATA}" \
    --create-bucket-configuration "LocationConstraint=${AWS_REGION}"
fi

aws s3api put-public-access-block --bucket "${BUCKET_DATA}" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-versioning --bucket "${BUCKET_DATA}" \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption --bucket "${BUCKET_DATA}" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

echo "[05-bucket] Done: s3://${BUCKET_DATA}/"
