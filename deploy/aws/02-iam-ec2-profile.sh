#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/config.sh"

TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

if ! aws iam get-role --role-name "$BANK_APP_ROLE_NAME" &>/dev/null; then
  aws iam create-role --role-name "$BANK_APP_ROLE_NAME" --assume-role-policy-document "$TRUST"
  echo "Created role: $BANK_APP_ROLE_NAME"
else
  echo "Role already exists: $BANK_APP_ROLE_NAME"
fi

aws iam attach-role-policy --role-name "$BANK_APP_ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

if ! aws iam get-instance-profile --instance-profile-name "$BANK_APP_INSTANCE_PROFILE" &>/dev/null; then
  aws iam create-instance-profile --instance-profile-name "$BANK_APP_INSTANCE_PROFILE"
  echo "Created instance profile: $BANK_APP_INSTANCE_PROFILE"
else
  echo "Instance profile already exists: $BANK_APP_INSTANCE_PROFILE"
fi

ROLES=$(aws iam get-instance-profile --instance-profile-name "$BANK_APP_INSTANCE_PROFILE" \
  --query 'InstanceProfile.Roles[*].RoleName' --output text || true)
if [[ " $ROLES " != *" $BANK_APP_ROLE_NAME "* ]]; then
  aws iam add-role-to-instance-profile --instance-profile-name "$BANK_APP_INSTANCE_PROFILE" \
    --role-name "$BANK_APP_ROLE_NAME"
  echo "Attached role to instance profile."
else
  echo "Role already on instance profile."
fi

echo "Waiting for instance profile to propagate (IAM eventual consistency)..."
for _ in $(seq 1 30); do
  aws iam get-instance-profile --instance-profile-name "$BANK_APP_INSTANCE_PROFILE" \
    --query InstanceProfile.Arn --output text &>/dev/null && break
  sleep 2
done
echo "Ready: instance profile $BANK_APP_INSTANCE_PROFILE"
