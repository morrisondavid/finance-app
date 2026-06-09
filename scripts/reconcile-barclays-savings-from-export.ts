/**
 * One-off reconcile: ingest Barclays Savings bank export (`data.csv`) through the
 * canonical upload pipeline and ensure `csv/` holds only normalized monthly files.
 *
 * Usage:
 *   npx tsx scripts/reconcile-barclays-savings-from-export.ts [/path/to/data.csv]
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { ingestCsvFile } from '../server/ingestion/ingest-csv-file.js';
import { initDatabase, getAccountBalance } from '../server/db/index.js';
import { isNormalizedMonthlyFilename } from '../server/utils/csv-partitioner.js';
import { recomputeAndPersistDataManifest } from '../server/data-manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const account = 'barclays-savings' as const;
const bankExport = process.argv[2] ?? path.join(os.homedir(), 'Downloads', 'data.csv');
const csvDir = path.join(REPO_ROOT, 'statements', account, 'csv');
const originalsDir = path.join(csvDir, '_originals');

function removeNonNormalizedFromActiveCsv(): string[] {
  const removed: string[] = [];
  for (const name of fs.readdirSync(csvDir)) {
    if (!name.endsWith('.csv') || name.startsWith('.')) continue;
    if (isNormalizedMonthlyFilename(name)) continue;
    fs.unlinkSync(path.join(csvDir, name));
    removed.push(name);
  }
  return removed;
}

function removeMonthlyInRange(fromYm: string, toYm: string): string[] {
  const removed: string[] = [];
  for (const name of fs.readdirSync(csvDir)) {
    if (!isNormalizedMonthlyFilename(name)) continue;
    const ym = name.slice(0, 7);
    if (ym >= fromYm && ym <= toYm) {
      fs.unlinkSync(path.join(csvDir, name));
      removed.push(name);
    }
  }
  return removed;
}

async function main(): Promise<void> {
  if (!fs.existsSync(bankExport)) {
    throw new Error(`Bank export not found: ${bankExport}`);
  }

  fs.mkdirSync(originalsDir, { recursive: true });

  const stray = removeNonNormalizedFromActiveCsv();
  console.log(`Removed non-normalized from csv/: ${stray.join(', ') || '(none)'}`);

  // Only replace months the export actually covers — keep Jan–Oct 2024 history
  // (a partial Barclays download from Oct 2024 omits earlier movements).
  const replaced = removeMonthlyInRange('2024-11', '2026-06');
  console.log(`Removed monthly files for export rebuild (${replaced.length}): ${replaced.join(', ')}`);

  const tmp = path.join(os.tmpdir(), `barclays-savings-data-${String(process.pid)}.csv`);
  fs.copyFileSync(bankExport, tmp);

  const result = ingestCsvFile(account, tmp, 'data.csv', { overwrite: true });
  if (!result.ok) {
    console.error('Ingest failed:', result);
    process.exit(1);
  }

  console.log(
    `Ingest ok: ${result.normalizedFilename} → ${result.partition.filesCreated.join(', ')}`,
  );

  const active = fs
    .readdirSync(csvDir)
    .filter(n => n.endsWith('.csv') && !n.startsWith('.'));
  const nonNormalized = active.filter(n => !isNormalizedMonthlyFilename(n));
  const normalized = active.filter(n => isNormalizedMonthlyFilename(n)).sort();

  console.log(`\nActive csv/: ${String(normalized.length)} normalized, ${String(nonNormalized.length)} non-normalized`);
  if (nonNormalized.length > 0) {
    throw new Error(`Unexpected non-normalized still present: ${nonNormalized.join(', ')}`);
  }
  for (const name of normalized) {
    console.log(`  ${name}`);
  }

  process.env.BANK_STATEMENTS_SKIP_INIT_WHEN_MANIFEST_UNCHANGED = '0';
  await initDatabase();
  const balance = getAccountBalance(account);
  console.log('\nBalance:', JSON.stringify(balance, null, 2));
  recomputeAndPersistDataManifest();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
