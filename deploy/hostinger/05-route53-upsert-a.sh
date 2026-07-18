#!/usr/bin/env bash
# Run on your LAPTOP — point finances.traxiproducts.com at the Hostinger VPS public IP.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/config.sh"

if [[ -n "${1:-}" ]]; then
  HOSTINGER_PUBLIC_IP="$1"
fi

if [[ -z "${HOSTINGER_PUBLIC_IP:-}" ]]; then
  echo "[05-dns] FATAL: HOSTINGER_PUBLIC_IP unset (config.sh or first arg)" >&2
  exit 1
fi

DNS_NAME="${BANK_APP_DNS_NAME:-finances.traxiproducts.com}"
PARENT_ZONE="${BANK_APP_ROUTE53_PARENT_ZONE:-traxiproducts.com}"

if [[ -z "${BANK_APP_HOSTED_ZONE_ID:-}" ]]; then
  HZ="$(aws route53 list-hosted-zones-by-name \
    --dns-name "${PARENT_ZONE}." \
    --query 'HostedZones[0].Id' --output text)"
  if [[ -z "${HZ}" || "${HZ}" == "None" ]]; then
    echo "[05-dns] Could not find Route53 zone for ${PARENT_ZONE}. Set BANK_APP_HOSTED_ZONE_ID in config.sh." >&2
    exit 1
  fi
  BANK_APP_HOSTED_ZONE_ID="${HZ#/hostedzone/}"
  echo "[05-dns] Using hosted zone ${BANK_APP_HOSTED_ZONE_ID} (${PARENT_ZONE})"
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

cat >"${TMP}" <<EOF
{
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "${DNS_NAME}.",
      "Type": "A",
      "TTL": 300,
      "ResourceRecords": [{ "Value": "${HOSTINGER_PUBLIC_IP}" }]
    }
  }]
}
EOF

aws route53 change-resource-record-sets \
  --hosted-zone-id "${BANK_APP_HOSTED_ZONE_ID}" \
  --change-batch "file://${TMP}"

echo "[05-dns] UPSERT A ${DNS_NAME} -> ${HOSTINGER_PUBLIC_IP} (TTL 300)"
