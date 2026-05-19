#!/usr/bin/env bash
# Run on the server after Docker works. Creates host dirs for bind mounts.
set -euo pipefail

BASE=(
  data statements invoices secrets
  budgets obligations debts deadlines net-worth
  autonize-it clients working-days reserves
)

paths=()
for d in "${BASE[@]}"; do
  paths+=("/opt/bank-app/${d}")
done

sudo mkdir -p "${paths[@]}"
sudo chown -R "${USER}:${USER}" /opt/bank-app
echo "Created durable bind-mount dirs under /opt/bank-app"
