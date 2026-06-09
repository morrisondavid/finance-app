/**
 * Re-run the canonical CSV ingest pipeline for every file in
 * `statements/<account>/csv/_originals/`.
 *
 * Upload saves originals first, then normalises + partitions into the active
 * `csv/` directory (what readiness and SQLite use). Files left only in
 * `_originals` were never promoted — this script fixes that.
 *
 * Usage:
 *   npx tsx scripts/process-csv-originals.ts
 *   npx tsx scripts/process-csv-originals.ts barclays-current
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ACCOUNTS, type AccountName } from '../server/types.js';
import { ingestCsvFile } from '../server/ingestion/ingest-csv-file.js';
import { initDatabase } from '../server/db/index.js';
import { recomputeAndPersistDataManifest } from '../server/data-manifest.js';
import { isNormalizedMonthlyFilename } from '../server/utils/csv-partitioner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATEMENTS_DIR = path.resolve(__dirname, '../statements');

const accountFilter = process.argv[2];

/** Remove stray `feed_*` / `data (N).csv` working copies from the active csv/ directory. */
function removeNonNormalizedCsvFiles(csvDir: string): string[] {
  if (!fs.existsSync(csvDir)) return [];
  const removed: string[] = [];
  for (const name of fs.readdirSync(csvDir)) {
    if (!name.endsWith('.csv') || name.startsWith('.')) continue;
    if (isNormalizedMonthlyFilename(name)) continue;
    fs.unlinkSync(path.join(csvDir, name));
    removed.push(name);
  }
  return removed;
}

function accountsToProcess(): AccountName[] {
  if (accountFilter) {
    if (!ACCOUNTS.includes(accountFilter as AccountName)) {
      throw new Error(`Unknown account: ${accountFilter}`);
    }
    return [accountFilter as AccountName];
  }
  return [...ACCOUNTS];
}

async function main(): Promise<void> {
  let ingested = 0;
  let failed = 0;
  let skipped = 0;

  for (const account of accountsToProcess()) {
    const csvDir = path.join(STATEMENTS_DIR, account, 'csv');
    const removed = removeNonNormalizedCsvFiles(csvDir);
    if (removed.length > 0) {
      console.log(`\n🧹 ${account}: removed ${removed.length} non-normalized file(s) from csv/: ${removed.join(', ')}`);
    }

    const originalsDir = path.join(csvDir, '_originals');
    if (!fs.existsSync(originalsDir)) {
      continue;
    }

    const files = fs
      .readdirSync(originalsDir)
      .filter(f => f.endsWith('.csv') && !f.startsWith('.'))
      .sort();

    if (files.length === 0) {
      continue;
    }

    console.log(`\n📁 ${account}: ${files.length} original(s)`);

    for (const name of files) {
      const filePath = path.join(originalsDir, name);
      const result = ingestCsvFile(account, filePath, name, { overwrite: true });

      if (result.ok) {
        const detail =
          result.partition.filesCreated.length > 0
            ? `merged → ${result.partition.filesCreated.join(', ')}`
            : `active → ${result.normalizedFilename}`;
        console.log(`   ✅ ${name} (${detail})`);
        ingested += 1;
      } else if (result.outcome === 'invalid') {
        console.log(`   ❌ ${name}: ${result.errors.join('; ')}`);
        failed += 1;
      } else {
        console.log(`   ⏭️  ${name}: duplicate (unexpected with overwrite)`);
        skipped += 1;
      }
    }
  }

  console.log(`\n📊 Ingest summary: ${ingested} ok, ${failed} failed, ${skipped} skipped`);

  if (ingested > 0) {
    console.log('\n🔄 Rebuilding SQLite from statements…');
    await initDatabase();
    recomputeAndPersistDataManifest();
    console.log('✅ Database reload complete.');
  } else {
    console.log('\n⏭️  No files ingested — database left unchanged.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
