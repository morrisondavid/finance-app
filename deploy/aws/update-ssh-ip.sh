#!/usr/bin/env bash
# Open TCP 22 on the finances EC2 security group for your current public IPv4.
# Run from your laptop when SSH times out after your ISP changes your home IP.
#
#   ./deploy/aws/update-ssh-ip.sh
#
# Requires: AWS CLI + credentials for the account that owns the instance;
#           deploy/aws/config.sh (copy from config.example.sh).
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CONFIG="${ROOT}/config.sh"
if [[ ! -f "${CONFIG}" ]]; then
  echo "Missing ${CONFIG} — copy config.example.sh to config.sh and edit." >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${CONFIG}"

if [[ -z "${BANK_APP_SG_NAME:-}" ]]; then
  echo "BANK_APP_SG_NAME is not set in config.sh" >&2
  exit 1
fi

MY_IP="$(curl -sSf https://checkip.amazonaws.com | tr -d '[:space:]')"
if [[ -z "${MY_IP}" ]]; then
  echo "Could not resolve current public IPv4 (checkip.amazonaws.com)." >&2
  exit 1
fi
MY_CIDR="${MY_IP}/32"

VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text)"
if [[ -z "${VPC_ID}" || "${VPC_ID}" == "None" ]]; then
  echo "No default VPC in ${AWS_REGION:-eu-west-2}. Set AWS_REGION in config.sh." >&2
  exit 1
fi

SG_ID="$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${BANK_APP_SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
  --query 'SecurityGroups[0].GroupId' --output text)"
if [[ -z "${SG_ID}" || "${SG_ID}" == "None" ]]; then
  echo "Security group ${BANK_APP_SG_NAME} not found in VPC ${VPC_ID}." >&2
  exit 1
fi

EXISTING="$(aws ec2 describe-security-groups --group-ids "${SG_ID}" \
  --query "SecurityGroups[0].IpPermissions[?FromPort==\`22\` && ToPort==\`22\`].IpRanges[].CidrIp" \
  --output text | tr '\t' '\n' | grep -Fx "${MY_CIDR}" || true)"

echo "[update-ssh-ip] Region: ${AWS_REGION}"
echo "[update-ssh-ip] Security group: ${BANK_APP_SG_NAME} (${SG_ID})"
echo "[update-ssh-ip] Your public IPv4: ${MY_IP}"

if [[ -n "${EXISTING}" ]]; then
  echo "[update-ssh-ip] ${MY_CIDR} is already allowed on port 22."
else
  if aws ec2 authorize-security-group-ingress --group-id "${SG_ID}" \
    --protocol tcp --port 22 --cidr "${MY_CIDR}" >/dev/null 2>&1; then
    echo "[update-ssh-ip] Opened TCP 22 for ${MY_CIDR}."
  else
    echo "[update-ssh-ip] Could not add ${MY_CIDR} (duplicate or IAM denied). Check Console inbound rules." >&2
    exit 1
  fi
fi

IP_FILE="${ROOT}/.elastic-ip"
KEY_NAME="${BANK_APP_KEY_NAME:-traxiproducts-finances-bank-app-eu-west-2}"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/${KEY_NAME}.pem}"
if [[ -f "${IP_FILE}" ]]; then
  HOST="$(tr -d '[:space:]' < "${IP_FILE}")"
  if [[ -n "${HOST}" && -f "${SSH_KEY}" ]]; then
    echo "[update-ssh-ip] Try: ssh -i ${SSH_KEY} ec2-user@${HOST}"
  elif [[ -n "${HOST}" ]]; then
    echo "[update-ssh-ip] Try: ssh -i ~/.ssh/${KEY_NAME}.pem ec2-user@${HOST}"
  fi
fi
