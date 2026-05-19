#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/config.sh"

KEY_PATH="${ROOT}/${BANK_APP_LS_KEY_NAME}.pem"

if aws lightsail get-key-pair --key-pair-name "$BANK_APP_LS_KEY_NAME" &>/dev/null; then
  echo "Lightsail key pair already exists: $BANK_APP_LS_KEY_NAME"
else
  aws lightsail create-key-pair --key-pair-name "$BANK_APP_LS_KEY_NAME" \
    --query privateKeyBase64 --output text | (base64 -d 2>/dev/null || base64 -D) >"$KEY_PATH"
  chmod 600 "$KEY_PATH"
  echo "Saved private key: $KEY_PATH"
fi

INSTANCE_NAME="traxiproducts-finances-bank-$(date +%s)"
aws lightsail create-instances --instance-names "$INSTANCE_NAME" \
  --availability-zone "$BANK_APP_LS_AZ" \
  --blueprint-id amazon_linux_2023 \
  --bundle-id "$BANK_APP_LS_BUNDLE" \
  --key-pair-name "$BANK_APP_LS_KEY_NAME"

echo "Waiting for instance to be running..."
while true; do
  STATE=$(aws lightsail get-instance --instance-name "$INSTANCE_NAME" \
    --query state.name --output text 2>/dev/null || echo "pending")
  [[ "$STATE" == "running" ]] && break
  sleep 5
done

aws lightsail open-instance-public-ports --instance-name "$INSTANCE_NAME" \
  --port-info fromPort=22,toPort=22,protocol=tcp \
  --port-info fromPort=80,toPort=80,protocol=tcp \
  --port-info fromPort=443,toPort=443,protocol=tcp

STATIC_IP_NAME="traxiproducts-finances-ip-$(date +%s)"
aws lightsail allocate-static-ip --static-ip-name "$STATIC_IP_NAME"
aws lightsail attach-static-ip --static-ip-name "$STATIC_IP_NAME" --instance-name "$INSTANCE_NAME"

PUBLIC_IP=$(aws lightsail get-static-ip --static-ip-name "$STATIC_IP_NAME" \
  --query staticIp.ipAddress --output text)

echo "$PUBLIC_IP" >"${ROOT}/.elastic-ip"
echo "Wrote ${ROOT}/.elastic-ip"

echo "instance_name=$INSTANCE_NAME"
echo "static_ip_name=$STATIC_IP_NAME"
echo "public_ip=$PUBLIC_IP"
echo "Next: ./04-route53-upsert-a.sh"
