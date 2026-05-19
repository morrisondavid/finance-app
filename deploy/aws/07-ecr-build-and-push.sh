#!/usr/bin/env bash
# From your laptop: build locally, create ECR repo if needed, tag, push.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/config.sh"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_LOCAL="${IMAGE_LOCAL:-bank-app:latest}"
IMAGE_REMOTE="${REGISTRY}/${BANK_APP_ECR_REPO_NAME}:latest"

if ! aws ecr describe-repositories --repository-names "$BANK_APP_ECR_REPO_NAME" &>/dev/null; then
  aws ecr create-repository --repository-name "$BANK_APP_ECR_REPO_NAME"
fi

docker build -t "$IMAGE_LOCAL" "$REPO_ROOT"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker tag "$IMAGE_LOCAL" "$IMAGE_REMOTE"
docker push "$IMAGE_REMOTE"

echo "Pushed: $IMAGE_REMOTE"
echo "On server: aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${REGISTRY} && docker pull ${IMAGE_REMOTE}"
