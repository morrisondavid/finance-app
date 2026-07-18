# Copy to `config.sh` (gitignored) on the Hostinger VPS:
#   cp config.example.sh config.sh
# Edit bucket names, hostname, and local Docker image tag.

export AWS_PAGER=""
export AWS_REGION="eu-west-2"

# S3 durable — reuse the existing bucket (already holds all app data).
# Hostinger uses an IAM user with exact S3 actions on this bucket only (05-create-iam-user.sh).
# No new bucket needed; the IAM policy is scoped to BUCKET_DATA, so isolation is by policy.
export BUCKET_DATA="traxiproducts-finances-bank-app-data-eu-west-2"
export BANK_S3_DURABLE_BUCKET="${BANK_S3_DURABLE_BUCKET:-$BUCKET_DATA}"
export BANK_S3_DURABLE_PREFIX="${BANK_S3_DURABLE_PREFIX:-bank-state/prod}"

# Docker image on this host (operator loads via OPERATOR-image-transfer.md)
export BANK_APP_IMAGE="${BANK_APP_IMAGE:-bank-app:latest}"

# Public host (Route53 A record → this VPS)
export BANK_APP_PUBLIC_HOSTNAME="finances.traxiproducts.com"
export BANK_APP_DNS_NAME="${BANK_APP_DNS_NAME:-finances.traxiproducts.com}"
export BANK_APP_ROUTE53_PARENT_ZONE="${BANK_APP_ROUTE53_PARENT_ZONE:-traxiproducts.com}"
export BANK_APP_HOSTED_ZONE_ID="${BANK_APP_HOSTED_ZONE_ID:-}"

# Hostinger VPS public IPv4 — required for 05-route53-upsert-a.sh (laptop)
export HOSTINGER_PUBLIC_IP="${HOSTINGER_PUBLIC_IP:-}"

# IAM user for S3 (created by 05-create-iam-user.sh on laptop)
export BANK_APP_HOSTINGER_IAM_USER="${BANK_APP_HOSTINGER_IAM_USER:-bank-app-hostinger-s3}"
export BANK_APP_HOSTINGER_IAM_POLICY="${BANK_APP_HOSTINGER_IAM_POLICY:-bank-app-hostinger-s3-policy}"

# Optional: force laptop build platform when CPU differs (linux/amd64 or linux/arm64)
export BANK_APP_DOCKER_PLATFORM="${BANK_APP_DOCKER_PLATFORM:-}"

# Enable Banking redirect (whitelist in Enable console)
export ENABLE_BANKING_REDIRECT_URL="https://finances.traxiproducts.com/api/feed/enable/callback"

# TrueLayer — set in production-env.local.sh on the VPS
# export TRUELAYER_CLIENT_ID=""
# export TRUELAYER_CLIENT_SECRET=""
# export TRUELAYER_REDIRECT_URL="https://finances.traxiproducts.com/api/feed/truelayer/callback"
