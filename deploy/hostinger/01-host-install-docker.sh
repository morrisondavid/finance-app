#!/usr/bin/env bash
# Run on the Hostinger VPS (Ubuntu/Debian) once — Docker + AWS CLI v2 for S3 durable sync.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/lib/install-aws-cli.sh"

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    echo "[01] Docker already installed: $(docker --version)"
    return 0
  fi

  echo "[01] Installing Docker …"
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  # shellcheck source=/dev/null
  . /etc/os-release
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    ${VERSION_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
  sudo systemctl enable --now docker
  sudo usermod -aG docker "${USER}"
  echo "[01] Docker installed. Log out and back in for docker group, or: newgrp docker"
}

install_docker
install_aws_cli
