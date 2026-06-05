#!/usr/bin/env bash
# Run on the EC2 / Lightsail host (Amazon Linux 2023) if Docker was not installed via user data.
set -euxo pipefail
sudo dnf install -y docker cronie
sudo systemctl enable --now crond
sudo systemctl enable --now docker
sudo usermod -aG docker "${USER}"
echo "Log out and back in for docker group, or: newgrp docker"
