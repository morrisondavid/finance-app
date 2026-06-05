#!/usr/bin/env bash
# Run scheduled bank feed sync inside the production `bank` container.
# Invoked by host crontab at 16:00 and 23:00 Europe/London (see install-feed-sync-cron.sh).
set -euo pipefail

CONTAINER_NAME="${BANK_FEED_SYNC_CONTAINER:-bank}"
LOG_FILE="${BANK_FEED_SYNC_LOG:-/var/log/bank-feed-sync.log}"

timestamp() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
  echo "$(timestamp) [feed-sync-all] container ${CONTAINER_NAME} is not running — skip" >> "${LOG_FILE}"
  exit 1
fi

echo "$(timestamp) [feed-sync-all] starting docker exec ${CONTAINER_NAME}" >> "${LOG_FILE}"
set +e
docker exec "${CONTAINER_NAME}" npx tsx /app/scripts/feed-sync-all.ts >> "${LOG_FILE}" 2>&1
exit_code=$?
set -e
echo "$(timestamp) [feed-sync-all] finished exit=${exit_code}" >> "${LOG_FILE}"
exit "${exit_code}"
