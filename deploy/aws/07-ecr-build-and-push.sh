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

docker build -t "$IMAGE_LOCAL" "${REPO_ROOT}"

SOURCE_SHA_HEX="$(
  docker run --rm "$IMAGE_LOCAL" node -e '
    const fs = require("node:fs");
    const j = JSON.parse(fs.readFileSync("/app/dist/source-hash.json", "utf8"));
    console.log(j.value);
  '
)"
TAG_SHORT="${SOURCE_SHA_HEX:0:12}"
IMAGE_REMOTE_SRC="${REGISTRY}/${BANK_APP_ECR_REPO_NAME}:src-${TAG_SHORT}"

aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker tag "$IMAGE_LOCAL" "$IMAGE_REMOTE"
docker tag "$IMAGE_LOCAL" "$IMAGE_REMOTE_SRC"

docker push "$IMAGE_REMOTE"
docker push "$IMAGE_REMOTE_SRC"

echo "Pushed:"
echo "  $IMAGE_REMOTE"
echo "  $IMAGE_REMOTE_SRC  (immutable tag from dist/source-hash.json)"
echo ""
echo "  sourceSha256 (full hex): ${SOURCE_SHA_HEX}"
echo ""
echo "Verify on host:"
HOST="${BANK_APP_PUBLIC_HOSTNAME:-<your-domain>}"
echo "  curl -fsS https://${HOST}/api/version"
echo ''
echo 'On EC2 matching this image:'
echo "[09] BANK_APP_IMAGE=\"${IMAGE_REMOTE_SRC}\" ./09-docker-run-production.sh"
echo "  or keep :latest and compare JSON sourceSha256 to the hex printed above."
