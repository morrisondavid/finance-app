#!/bin/bash
# Amazon Linux 2023 — install Docker on first boot (EC2 user data).

set -euxo pipefail
dnf install -y docker
systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user || true
