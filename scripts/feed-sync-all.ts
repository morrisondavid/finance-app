/**
 * Scheduled bank feed sync for all linked accounts.
 *
 * Usage: tsx scripts/feed-sync-all.ts
 * Env: FEED_SYNC_LOOKBACK_DAYS (1–14, default 3)
 */

import { loadEnvLocal } from '../server/load-env-local.js';
import { initDatabase } from '../server/db/index.js';
import { autoReconcileHighConfidence } from '../server/domain/invoices/auto-reconcile.js';
import { runFeedSyncAllGuarded } from '../server/ingestion/feeds/feed-sync-guard.js';

loadEnvLocal();

async function main(): Promise<void> {
  await initDatabase();

  const result = await runFeedSyncAllGuarded({ trigger: 'scheduled' });

  if (result.state === 'in-progress') {
    console.log(`[feed:sync-all] already in progress since ${result.startedAt}`);
    process.exitCode = 2;
    return;
  }

  if (result.state === 'started') {
    return;
  }

  if (result.state === 'deduped') {
    console.log(
      `[feed:sync-all] deduped — last run ${result.run.finishedAt} outcome=${result.run.outcome}`,
    );
    process.exitCode = 0;
    return;
  }

  const { run } = result;
  console.log(
    `[feed:sync-all] ${run.finishedAt} lookback=${String(run.lookbackDays)} ` +
      `outcome=${run.outcome} accounts=${String(run.accounts.length)}`,
  );

  for (const row of run.accounts) {
    if (row.status === 'ingested') {
      console.log(
        `  ${row.account}: ingested rows=${String(row.rowsFetched)}`,
      );
    } else if (row.status === 'unchanged') {
      console.log(`  ${row.account}: unchanged ${row.reason} rows=${String(row.rowsFetched)}`);
    } else if (row.status === 'skipped') {
      console.log(`  ${row.account}: skipped ${row.reason}`);
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

  if (run.outcome === 'partial' || run.outcome === 'failed') {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('[feed:sync-all] fatal:', err);
  process.exitCode = 1;
});
