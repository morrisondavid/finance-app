/**
 * Production repair helper after TrueLayer mapping fixes.
 *
 * 1. Backfill feed sync for an account over a date window (requires live TL tokens).
 * 2. Optionally strip stale TrueLayer-hash Transaction IDs from Monzo monthly CSVs.
 *
 * Usage:
 *   tsx scripts/repair-truelayer-feed.ts monzo-joint --date-from 2026-04-01 --sync
 *   tsx scripts/repair-truelayer-feed.ts monzo-joint --strip-tl-hash-ids --dry-run
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { loadEnvLocal } from '../server/load-env-local.js';
import type { AccountName } from '../shared/api-contracts.js';
import { runFeedSync } from '../server/ingestion/feeds/sync.js';
import { PARSERS } from '../server/parsers/index.js';
import { STATEMENTS_DIR } from '../server/db/connection.js';
import { rowsToCSV } from '../server/utils/csv-partitioner.js';

loadEnvLocal();

const TL_HASH_ID = /^[a-f0-9]{32}$/;

function parseArgs(argv: readonly string[]): {
  account: AccountName;
  dateFrom: string;
  dateTo: string;
  sync: boolean;
  stripHashIds: boolean;
  dryRun: boolean;
} {
  const account = argv[2];
  if (account === undefined || account === '') {
    throw new Error('Usage: tsx scripts/repair-truelayer-feed.ts <account> [options]');
  }
  let dateFrom = '2026-04-01';
  let dateTo = new Date().toISOString().slice(0, 10);
  let sync = false;
  let stripHashIds = false;
  let dryRun = false;
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sync') sync = true;
    else if (a === '--strip-tl-hash-ids') stripHashIds = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--date-from') {
      dateFrom = argv[++i] ?? dateFrom;
    } else if (a === '--date-to') {
      dateTo = argv[++i] ?? dateTo;
    }
  }
  return {
    account: account as AccountName,
    dateFrom,
    dateTo,
    sync,
    stripHashIds,
    dryRun,
  };
}

function stripMonzoTrueLayerHashRows(account: AccountName, dryRun: boolean): number {
  const parser = PARSERS[account];
  if (parser?.externalIdColumn !== 'Transaction ID') {
    throw new Error(`${account}: strip only supported for Monzo-style Transaction ID column`);
  }
  const csvDir = path.join(STATEMENTS_DIR, account, 'csv');
  if (!fs.existsSync(csvDir)) return 0;

  let removed = 0;
  for (const file of fs.readdirSync(csvDir).filter(f => /^\d{4}-\d{2}_transactions_/.test(f))) {
    const filePath = path.join(csvDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const rows = parse(parser.preprocess(content), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[];
    const kept = rows.filter(row => {
      const id = (row['Transaction ID'] ?? '').trim();
      if (TL_HASH_ID.test(id)) {
        removed++;
        return false;
      }
      return true;
    });
    if (kept.length !== rows.length && !dryRun) {
      fs.writeFileSync(filePath, rowsToCSV([...parser.headers], kept), 'utf-8');
    }
  }
  return removed;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  console.log(`Account: ${opts.account}`);
  console.log(`Window: ${opts.dateFrom} → ${opts.dateTo}`);

  if (opts.sync) {
    console.log('\nRunning feed sync (force re-ingest)…');
    const result = await runFeedSync(opts.account, {
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      force: true,
    });
    console.log(JSON.stringify(result, null, 2));
  }

  if (opts.stripHashIds) {
    console.log(`\nStripping 32-char TrueLayer hash Transaction IDs (dryRun=${String(opts.dryRun)})…`);
    const n = stripMonzoTrueLayerHashRows(opts.account, opts.dryRun);
    console.log(`Rows ${opts.dryRun ? 'would remove' : 'removed'}: ${String(n)}`);
  }

  if (!opts.sync && !opts.stripHashIds) {
    console.log('\nNo action selected. Pass --sync and/or --strip-tl-hash-ids');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
