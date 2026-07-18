#!/usr/bin/env bash
# Idempotent AWS CLI v2 install for Ubuntu/Debian VPS (amd64 / arm64).
install_aws_cli() {
  if command -v aws >/dev/null 2>&1; then
    echo "[aws-cli] already installed: $(aws --version 2>&1 | head -1)"
    return 0
  fi

  local arch
  arch="$(uname -m)"
  case "${arch}" in
    x86_64|amd64) arch="x86_64" ;;
    aarch64|arm64) arch="aarch64" ;;
    *)
      echo "[aws-cli] FATAL: unsupported architecture: ${arch}" >&2
      return 1
      ;;
  esac

  echo "[aws-cli] installing AWS CLI v2 (${arch}) …"
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp}"' RETURN

  if ! command -v unzip >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y unzip curl
  fi

  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${arch}.zip" -o "${tmp}/awscliv2.zip"
  unzip -q "${tmp}/awscliv2.zip" -d "${tmp}"
  sudo "${tmp}/aws/install" --update
  echo "[aws-cli] installed: $(aws --version 2>&1 | head -1)"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail
  install_aws_cli
fi
