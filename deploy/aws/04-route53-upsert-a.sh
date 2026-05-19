#!/usr/bin/env bash
# UPSERT A record for finances.traxiproducts.com
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/config.sh"

ELASTIC_IP="${ELASTIC_IP:-}"
if [[ -z "$ELASTIC_IP" ]] && [[ -f "${ROOT}/.elastic-ip" ]]; then
  ELASTIC_IP=$(tr -d ' \n\r' <"${ROOT}/.elastic-ip")
fi
: "${ELASTIC_IP:?Run 03-ec2-provision.sh first (writes deploy/aws/.elastic-ip) or export ELASTIC_IP=...}"

if [[ -z "${BANK_APP_HOSTED_ZONE_ID:-}" ]]; then
  HZ=$(aws route53 list-hosted-zones-by-name \
    --dns-name "${BANK_APP_ROUTE53_PARENT_ZONE}." \
    --query 'HostedZones[0].Id' --output text)
  if [[ -z "$HZ" || "$HZ" == "None" ]]; then
    echo "Could not find Route53 hosted zone for ${BANK_APP_ROUTE53_PARENT_ZONE}. Set BANK_APP_HOSTED_ZONE_ID in deploy/aws/config.sh." >&2
    exit 1
  fi
  BANK_APP_HOSTED_ZONE_ID="${HZ#/hostedzone/}"
  echo "Using hosted zone ${BANK_APP_HOSTED_ZONE_ID} (${BANK_APP_ROUTE53_PARENT_ZONE})"
fi

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

cat >"$TMP" <<EOF
{
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "${BANK_APP_DNS_NAME}.",
      "Type": "A",
      "TTL": 300,
      "ResourceRecords": [{ "Value": "${ELASTIC_IP}" }]
    }
  }]
}
EOF

aws route53 change-resource-record-sets --hosted-zone-id "$BANK_APP_HOSTED_ZONE_ID" \
  --change-batch "file://${TMP}"
echo "UPSERT A ${BANK_APP_DNS_NAME} -> ${ELASTIC_IP}"
