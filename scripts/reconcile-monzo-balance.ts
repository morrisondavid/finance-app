/**
 * Diagnose Monzo joint balance drift — sum by type/period, duplicates, CSV-only vs combined.
 *
 * Usage:
 *   npm run reconcile:monzo
 *   ACCOUNT=monzo-joint npm run reconcile:monzo
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { initDatabase } from '../server/db/index.js';
import { STATEMENTS_DIR } from '../server/db/connection.js';
import { getAccountBalance } from '../server/db/repositories/balance.js';
import { deriveMonzoOpeningAnchorFromCsvContent } from '../server/parsers/monzo-opening-balance.js';
import { parseMonzoSignedAmount, getMonzoColumnValue } from '../server/parsers/monzo.js';
import type { CSVRow } from '../server/types.js';

const account = (process.env.ACCOUNT ?? 'monzo-joint').trim();
const KNOWN_APP_BALANCE = process.env.KNOWN_BALANCE !== undefined
  ? parseFloat(process.env.KNOWN_BALANCE)
  : 3.43;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumCsvFiles(dir: string, filter?: (name: string) => boolean): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.csv')) continue;
    if (filter !== undefined && !filter(name)) continue;
    const content = fs.readFileSync(path.join(dir, name), 'utf-8');
    const rows = parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true }) as CSVRow[];
    for (const row of rows) {
      total += parseMonzoSignedAmount(row);
    }
  }
  return total;
}

function main(): void {
  void (async () => {
    await initDatabase();
    const { getDb } = await import('../server/db/connection.js');
    const db = getDb();
  const balance = getAccountBalance(account as Parameters<typeof getAccountBalance>[0]);

  console.log(`\n=== Monzo balance reconciliation: ${account} ===\n`);
  console.log('Balance panel (DB):');
  console.log(`  opening:     £${balance.openingBalance.toFixed(2)}${balance.openingBalanceDate ? ` (as of ${balance.openingBalanceDate})` : ' (not set)'}`);
  console.log(`  tx total:    £${balance.transactionTotal.toFixed(2)} (${balance.transactionCount} rows)`);
  console.log(`  current:     £${balance.currentBalance.toFixed(2)}`);
  console.log(`  known app:   £${KNOWN_APP_BALANCE.toFixed(2)}`);
  console.log(`  drift:       £${round2(balance.currentBalance - KNOWN_APP_BALANCE).toFixed(2)}\n`);

  const byType = db.prepare(`
    SELECT type, COUNT(*) AS n, ROUND(SUM(amount), 2) AS total
    FROM transactions WHERE account = ?
    GROUP BY type ORDER BY type
  `).all(account) as Array<{ type: string; n: number; total: number }>;
  console.log('Sum by type:');
  for (const row of byType) {
    console.log(`  ${row.type}: ${row.n} rows, £${row.total}`);
  }

  const byPeriod = db.prepare(`
    SELECT CASE WHEN date < '2026-04-01' THEN 'before_Apr_2026' ELSE 'Apr_2026_onwards' END AS period,
           COUNT(*) AS n, ROUND(SUM(amount), 2) AS total
    FROM transactions WHERE account = ?
    GROUP BY period
  `).all(account) as Array<{ period: string; n: number; total: number }>;
  console.log('\nSum by period:');
  for (const row of byPeriod) {
    console.log(`  ${row.period}: ${row.n} rows, £${row.total}`);
  }

  const dupes = db.prepare(`
    SELECT date, amount, COUNT(*) AS n, GROUP_CONCAT(description, ' | ') AS descs
    FROM transactions WHERE account = ?
    GROUP BY date, amount HAVING n > 1
    ORDER BY date DESC
    LIMIT 20
  `).all(account) as Array<{ date: string; amount: number; n: number; descs: string }>;
  console.log(`\nDuplicate groups (date+amount, top ${dupes.length}):`);
  if (dupes.length === 0) {
    console.log('  (none)');
  } else {
    for (const d of dupes) {
      console.log(`  ${d.date} £${d.amount}: ${d.n}x — ${d.descs}`);
    }
  }

  const csvDir = path.join(STATEMENTS_DIR, account, 'csv');
  const feedOnly = sumCsvFiles(csvDir, name => name.startsWith('feed_'));
  const nonFeed = sumCsvFiles(csvDir, name => !name.startsWith('feed_') && !name.startsWith('_'));
  const combined = sumCsvFiles(csvDir, name => !name.startsWith('_'));
  console.log('\nCSV on disk (parsed amounts, no dedup):');
  console.log(`  feed-only sum:    £${round2(feedOnly).toFixed(2)}`);
  console.log(`  export-only sum:  £${round2(nonFeed).toFixed(2)}`);
  console.log(`  combined sum:     £${round2(combined).toFixed(2)}`);
  console.log(`  implied opening (known - combined): £${round2(KNOWN_APP_BALANCE - combined).toFixed(2)}`);

  const originalsDir = path.join(csvDir, '_originals');
  if (fs.existsSync(originalsDir)) {
    const originals = fs.readdirSync(originalsDir).filter(f => f.endsWith('.csv'));
    for (const name of originals) {
      const content = fs.readFileSync(path.join(originalsDir, name), 'utf-8');
      const anchor = deriveMonzoOpeningAnchorFromCsvContent(content);
      if (anchor !== null) {
        console.log(`\nBalance column in _originals/${name}:`);
        console.log(`  implied opening: £${anchor.openingBalance.toFixed(2)} as of ${anchor.openingBalanceDate}`);
        console.log(`  last balance:    £${anchor.lastBalance.toFixed(2)} on ${anchor.lastBalanceDate}`);
      }
    }
  }

  console.log('');
  })().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

main();
