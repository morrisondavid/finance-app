#!/usr/bin/env bash
# Run on the Hostinger VPS after Docker works. Creates host dirs for bind mounts.
set -euo pipefail

BASE=(
  data statements invoices secrets
  budgets obligations debts deadlines net-worth
  autonize-it clients working-days reserves debt-strategy
)

paths=()
for d in "${BASE[@]}"; do
  paths+=("/opt/bank-app/${d}")
done

sudo mkdir -p "${paths[@]}"
sudo mkdir -p /opt/bank-app/data/truelayer-feed-cache
sudo chown -R "${USER}:${USER}" /opt/bank-app
echo "Created durable bind-mount dirs under /opt/bank-app"
