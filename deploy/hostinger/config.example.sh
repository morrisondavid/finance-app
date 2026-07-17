# Copy to `config.sh` (gitignored) on the Hostinger VPS:
#   cp config.example.sh config.sh
# Edit bucket names, hostname, and local Docker image tag.

export AWS_PAGER=""
export AWS_REGION="eu-west-2"

# S3 durable (same bucket as EC2 deploy — Hostinger uses IAM user keys, not instance profile)
export BUCKET_DATA="traxiproducts-finances-bank-app-data-eu-west-2"
export BANK_S3_DURABLE_BUCKET="${BANK_S3_DURABLE_BUCKET:-$BUCKET_DATA}"
export BANK_S3_DURABLE_PREFIX="${BANK_S3_DURABLE_PREFIX:-bank-state/prod}"

# Docker image on this host (operator loads via OPERATOR-image-transfer.md)
export BANK_APP_IMAGE="${BANK_APP_IMAGE:-bank-app:latest}"

# Public host (Route53 A record → this VPS)
export BANK_APP_PUBLIC_HOSTNAME="finances.traxiproducts.com"

# Optional: force laptop build platform when CPU differs (linux/amd64 or linux/arm64)
export BANK_APP_DOCKER_PLATFORM="${BANK_APP_DOCKER_PLATFORM:-}"

# Enable Banking redirect (whitelist in Enable console)
export ENABLE_BANKING_REDIRECT_URL="https://finances.traxiproducts.com/api/feed/enable/callback"

# TrueLayer — set in production-env.local.sh on the VPS
# export TRUELAYER_CLIENT_ID=""
# export TRUELAYER_CLIENT_SECRET=""
# export TRUELAYER_REDIRECT_URL="https://finances.traxiproducts.com/api/feed/truelayer/callback"
