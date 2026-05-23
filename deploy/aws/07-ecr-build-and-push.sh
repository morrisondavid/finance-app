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

GIT_SHA="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

docker build \
  --build-arg "BANK_APP_BUILD_GIT_COMMIT=${GIT_SHA}" \
  --build-arg "BANK_APP_IMAGE_BUILT_AT=${BUILT_AT}" \
  -t "$IMAGE_LOCAL" \
  "${REPO_ROOT}"

aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker tag "$IMAGE_LOCAL" "$IMAGE_REMOTE"
docker push "$IMAGE_REMOTE"

echo "Pushed: $IMAGE_REMOTE (git=${GIT_SHA} built=${BUILT_AT})"
echo "Verify on host: curl -fsS https://<your-domain>/api/version"
echo "On server: cd ~/bank-deploy-aws && ./09-docker-run-production.sh  (pull + S3 sync + docker run — or run copy-deploy-to-ec2.sh first if scripts changed)"
