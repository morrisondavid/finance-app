#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/config.sh"

VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text)
if [[ "$VPC_ID" == "None" || -z "$VPC_ID" ]]; then
  echo "No default VPC found in ${AWS_REGION}. Create a VPC or set filters in this script."
  exit 1
fi

SUBNET_ID=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=${VPC_ID}" \
  --query 'Subnets[0].SubnetId' --output text)

SG_ID=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${BANK_APP_SG_NAME}" \
  "Name=vpc-id,Values=${VPC_ID}" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)
if [[ -z "$SG_ID" || "$SG_ID" == "None" ]]; then
  SG_ID=$(aws ec2 create-security-group --group-name "$BANK_APP_SG_NAME" \
    --description "bank-statements-app finances.traxiproducts.com" --vpc-id "$VPC_ID" --query 'GroupId' --output text)
  echo "Created security group: $SG_ID"
fi

MY_IP=$(curl -sSf https://checkip.amazonaws.com)
authorize() {
  local port="$1"
  local cidr="$2"
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --protocol tcp --port "$port" --cidr "$cidr" 2>/dev/null && echo "Opened TCP $port for $cidr" || true
}
authorize 22 "${MY_IP}/32"
authorize 80 0.0.0.0/0
authorize 443 0.0.0.0/0

if [[ -n "${BANK_APP_AMI_ID:-}" ]]; then
  AMI_ID="$BANK_APP_AMI_ID"
else
  AMI_ID=$(aws ec2 describe-images --owners amazon \
    --filters "Name=name,Values=al2023-ami-*-kernel-*-arm64" \
    --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text)
fi
echo "AMI: $AMI_ID"

IAM_ARGS=()
if [[ -n "${BANK_APP_INSTANCE_PROFILE:-}" ]]; then
  IAM_ARGS=(--iam-instance-profile "Name=${BANK_APP_INSTANCE_PROFILE}")
fi

USER_DATA_FILE="${ROOT}/user-data/al2023-docker.sh"
USER_DATA_ARG=()
if [[ -f "$USER_DATA_FILE" ]]; then
  USER_DATA_ARG=(--user-data "file://${USER_DATA_FILE}")
fi

INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$BANK_APP_INSTANCE_TYPE" \
  --key-name "$BANK_APP_KEY_NAME" \
  --subnet-id "$SUBNET_ID" \
  --security-group-ids "$SG_ID" \
  "${IAM_ARGS[@]:-}" \
  "${USER_DATA_ARG[@]:-}" \
  --associate-public-ip-address \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=traxiproducts-finances-bank-app}]' \
  --query 'Instances[0].InstanceId' --output text)

aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
ALLOC_ID=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID"
ELASTIC_IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" \
  --query 'Addresses[0].PublicIp' --output text)

echo "$ELASTIC_IP" >"${ROOT}/.elastic-ip"
echo "Wrote ${ROOT}/.elastic-ip"

echo "instance_id=$INSTANCE_ID"
echo "elastic_ip=$ELASTIC_IP"
echo "Next: ./04-route53-upsert-a.sh"
echo "ssh -i ~/.ssh/${BANK_APP_KEY_NAME}.pem ec2-user@${ELASTIC_IP}"
