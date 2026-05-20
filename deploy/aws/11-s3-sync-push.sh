#!/usr/bin/env bash
# Optional: run from EC2 with instance profile or configured AWS CLI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/config.sh"

aws s3 sync /opt/bank-app/data/ "s3://${BUCKET_DATA}/" \
  --exclude 'enable-sessions.json' \
  --exclude 'transactions.db*'
aws s3 sync /opt/bank-app/statements/ "s3://${BUCKET_STMT}/"
echo "Synced to s3://${BUCKET_DATA}/ and s3://${BUCKET_STMT}/"
