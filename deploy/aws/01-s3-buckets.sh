#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/config.sh"

create_one() {
  local b="$1"
  if aws s3api head-bucket --bucket "$b" 2>/dev/null; then
    echo "Bucket exists: $b"
    return
  fi
  echo "Creating bucket: $b"
  if [[ "$AWS_REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$b"
  else
    aws s3api create-bucket --bucket "$b" \
      --create-bucket-configuration "LocationConstraint=${AWS_REGION}"
  fi
  aws s3api put-public-access-block --bucket "$b" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-versioning --bucket "$b" --versioning-configuration Status=Enabled
  aws s3api put-bucket-encryption --bucket "$b" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
}

create_one "$BUCKET_DATA"
create_one "$BUCKET_STMT"
echo "Done. Data: s3://${BUCKET_DATA}/ | Statements: s3://${BUCKET_STMT}/"
