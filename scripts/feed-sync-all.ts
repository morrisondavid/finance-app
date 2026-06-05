/**
 * Scheduled bank feed sync for all linked accounts (cron via docker exec).
 *
 * Usage: tsx scripts/feed-sync-all.ts
 * Env: FEED_SYNC_LOOKBACK_DAYS (1–14, default 3)
 */

import { loadEnvLocal } from '../server/load-env-local.js';
import { initDatabase } from '../server/db/index.js';
import { autoReconcileHighConfidence } from '../server/domain/invoices/auto-reconcile.js';
import { runScheduledFeedSyncAll } from '../server/ingestion/feeds/run-scheduled-feed-sync-all.js';

loadEnvLocal();

async function main(): Promise<void> {
  await initDatabase();

  const { status, hadLinkedFailure, syncedCount, skippedUnlinkedCount } =
    await runScheduledFeedSyncAll();

  console.log(
    `[feed:sync-all] ${status.lastRunAt} lookback=${status.lookbackDays} ` +
      `synced=${syncedCount} skipped_unlinked=${skippedUnlinkedCount} ` +
      `results=${status.accounts.length}`,
  );

  for (const row of status.accounts) {
    if (row.status === 'ok') {
      console.log(
        `  ${row.account}: ok rows=${row.rowsFetched} skipped=${row.skipped}`,
      );
    } else if (row.status === 'failed') {
      console.error(`  ${row.account}: failed ${row.code ?? ''} ${row.error}`);
    }
  }

  for (const entityId of ['autonize-it-ltd', 'autonize-it-fzco'] as const) {
    try {
      const auto = autoReconcileHighConfidence({ entityId });
      if (auto.persisted.length > 0) {
        console.log(
          `[feed:sync-all] auto-reconcile ${entityId}: persisted=${auto.persisted.length} `
            + `status_updates=${auto.statusUpdates.length}`,
        );
      }
    } catch (err) {
      console.error(`[feed:sync-all] auto-reconcile ${entityId} failed:`, err);
    }
  }

  if (hadLinkedFailure) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('[feed:sync-all] fatal:', err);
  process.exitCode = 1;
});
