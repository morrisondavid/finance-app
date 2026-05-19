# deploy/aws/config.sh — hardcoded deployment values for finances.traxiproducts.com
# Edit ENABLE_BANKING_APP_ID (one line) and BANK_APP_KEY_NAME if needed, then run scripts.

export AWS_PAGER=""
export AWS_REGION="eu-west-2"

# S3 backup buckets (names must be globally unique)
export BUCKET_DATA="traxiproducts-finances-bank-app-data-eu-west-2"
export BUCKET_STMT="traxiproducts-finances-bank-app-statements-eu-west-2"

# Optional S3 durable sync (see README): defaults align seed script + EC2 container env
export BANK_S3_DURABLE_BUCKET="${BANK_S3_DURABLE_BUCKET:-$BUCKET_DATA}"
export BANK_S3_DURABLE_PREFIX="${BANK_S3_DURABLE_PREFIX:-bank-state/prod}"

# IAM instance profile (02 → 03)
export BANK_APP_ROLE_NAME="bank-app-ec2-s3-sync"
export BANK_APP_INSTANCE_PROFILE="bank-app-ec2-profile"

# EC2 (03) — must match an existing key pair name in eu-west-2
export BANK_APP_KEY_NAME="traxiproducts-finances-bank-app-eu-west-2"
export BANK_APP_INSTANCE_TYPE="t4g.small"
export BANK_APP_SG_NAME="traxiproducts-finances-bank-app-sg"

# Route53 / public host
export BANK_APP_DNS_NAME="finances.traxiproducts.com"
export BANK_APP_ROUTE53_PARENT_ZONE="traxiproducts.com"
export BANK_APP_HOSTED_ZONE_ID=""

# Lightsail (05) — only if you use 05 instead of 03
export BANK_APP_LS_KEY_NAME="traxiproducts-finances-ls-key"
export BANK_APP_LS_BUNDLE="nano_3_0"
export BANK_APP_LS_AZ="eu-west-2a"

# ECR (07)
export BANK_APP_ECR_REPO_NAME="traxiproducts-finances-bank-app"

# Docker on server (09) — leave empty to build image URI from `aws sts` + repo name on the machine
export BANK_APP_IMAGE=""
export BANK_APP_PUBLIC_HOSTNAME="finances.traxiproducts.com"

# Enable Banking (same as .env.local ENABLE_BANKING_APP_ID)
export ENABLE_BANKING_APP_ID="5f5d8128-de16-4729-a5e0-0dd846b8f836"
export ENABLE_BANKING_REDIRECT_URL="https://finances.traxiproducts.com/api/feed/enable/callback"
