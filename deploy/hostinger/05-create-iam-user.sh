#!/usr/bin/env bash
# Run on your LAPTOP with admin AWS credentials (not on the VPS).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/config.sh"

: "${BUCKET_DATA:?Set BUCKET_DATA in config.sh}"

IAM_USER_NAME="${BANK_APP_HOSTINGER_IAM_USER:-bank-app-hostinger-s3}"
POLICY_NAME="${BANK_APP_HOSTINGER_IAM_POLICY:-bank-app-hostinger-s3-policy}"

TMP_POLICY="$(mktemp)"
trap 'rm -f "$TMP_POLICY"' EXIT

cat >"${TMP_POLICY}" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListFinanceAppBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::${BUCKET_DATA}"
    },
    {
      "Sid": "ReadWriteFinanceAppObjects",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:HeadObject",
        "s3:PutObject",
        "s3:CreateMultipartUpload",
        "s3:UploadPart",
        "s3:CompleteMultipartUpload",
        "s3:AbortMultipartUpload"
      ],
      "Resource": "arn:aws:s3:::${BUCKET_DATA}/*"
    }
  ]
}
EOF

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"

if aws iam get-user --user-name "${IAM_USER_NAME}" &>/dev/null; then
  echo "[05] IAM user already exists: ${IAM_USER_NAME}"
else
  aws iam create-user --user-name "${IAM_USER_NAME}"
  echo "[05] Created IAM user: ${IAM_USER_NAME}"
fi

if aws iam get-policy --policy-arn "${POLICY_ARN}" &>/dev/null; then
  echo "[05] Updating policy to match BUCKET_DATA=${BUCKET_DATA} …"
  aws iam create-policy-version \
    --policy-arn "${POLICY_ARN}" \
    --policy-document "file://${TMP_POLICY}" \
    --set-as-default
else
  aws iam create-policy \
    --policy-name "${POLICY_NAME}" \
    --policy-document "file://${TMP_POLICY}" \
    --description "Exact S3 actions for finance app on bucket ${BUCKET_DATA} only"
  echo "[05] Created policy: ${POLICY_ARN}"
fi

ATTACHED="$(aws iam list-attached-user-policies --user-name "${IAM_USER_NAME}" \
  --query "AttachedPolicies[?PolicyArn=='${POLICY_ARN}'].PolicyArn" --output text)"
if [[ -z "${ATTACHED}" || "${ATTACHED}" == "None" ]]; then
  aws iam attach-user-policy --user-name "${IAM_USER_NAME}" --policy-arn "${POLICY_ARN}"
  echo "[05] Attached policy to user."
else
  echo "[05] Policy already attached."
fi

KEY_COUNT="$(aws iam list-access-keys --user-name "${IAM_USER_NAME}" --query 'length(AccessKeyMetadata)' --output text)"
if [[ "${KEY_COUNT}" != "0" ]]; then
  echo "[05] User already has ${KEY_COUNT} access key(s). Create a new one manually if needed:"
  echo "    aws iam create-access-key --user-name ${IAM_USER_NAME}"
  exit 0
fi

read -r ACCESS_KEY_ID SECRET_ACCESS_KEY <<< "$(aws iam create-access-key --user-name "${IAM_USER_NAME}" \
  --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)"

echo ""
echo "export AWS_ACCESS_KEY_ID='${ACCESS_KEY_ID}'"
echo "export AWS_SECRET_ACCESS_KEY='${SECRET_ACCESS_KEY}'"
echo ""
echo "Never commit these values. Rotate via IAM if leaked."
