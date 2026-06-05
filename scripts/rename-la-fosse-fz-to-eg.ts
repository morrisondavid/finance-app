/**
 * Renumber la-fosse FZ-#### self-bills as EG-#### continuation after
 * the existing EG series (chronological by invoice_date).
 *
 * Usage:
 *   npx tsx scripts/rename-la-fosse-fz-to-eg.ts              # dry-run
 *   npx tsx scripts/rename-la-fosse-fz-to-eg.ts --apply     # local
 *   npx tsx scripts/rename-la-fosse-fz-to-eg.ts --apply --s3
 *
 * If local CSV is already EG-####, `--s3` still renames FZ PDF keys on S3
 * using the saved map (or payment_reference → former FZ id).
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVOICES_CSV = path.join(REPO_ROOT, 'invoices', 'invoices.csv');
const PAYMENTS_CSV = path.join(REPO_ROOT, 'invoices', 'invoice_payments.csv');
const INGESTED_DIR = path.join(REPO_ROOT, 'invoices', 'ingested');
const MAP_JSON = path.join(REPO_ROOT, 'invoices', '.fz-eg-rename-map.json');

const FZ_LA_FOSSE_PATTERN = /^FZ-(\d{4})$/;
const EG_PATTERN = /^EG-(\d{4})$/;

interface RenamePair {
  readonly from: string;
  readonly to: string;
}

interface CsvInvoiceRow {
  readonly id: string;
  readonly clientId: string;
  readonly paymentReference: string;
  readonly invoiceDate: string;
  readonly periodStart: string;
}

/** Former FZ-#### ids keyed by La Fosse SB payment_reference. */
const FZ_ID_BY_PAYMENT_REFERENCE: Readonly<Record<string, string>> = {
  'SB-293519': 'FZ-0001',
  'SB-293520': 'FZ-0002',
  'SB-293521': 'FZ-0003',
  'SB-293522': 'FZ-0004',
  'SB-294878': 'FZ-0006',
  'SB-294877': 'FZ-0005',
  'SB-298462': 'FZ-0010',
  'SB-298461': 'FZ-0009',
  'SB-298460': 'FZ-0008',
  'SB-298459': 'FZ-0007',
  'SB-298464': 'FZ-0012',
  'SB-298463': 'FZ-0011',
};

function parseArgs(argv: string[]): { apply: boolean; s3: boolean } {
  return {
    apply: argv.includes('--apply'),
    s3: argv.includes('--s3'),
  };
}

function readLaFosseRows(): CsvInvoiceRow[] {
  const text = fs.readFileSync(INVOICES_CSV, 'utf8');
  const rows: CsvInvoiceRow[] = [];
  for (const line of text.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split(',');
    if (cols[2] !== 'la-fosse') continue;
    rows.push({
      id: cols[0],
      clientId: cols[2],
      paymentReference: cols[5],
      invoiceDate: cols[6],
      periodStart: cols[7],
    });
  }
  return rows;
}

function maxEgIndex(rows: readonly CsvInvoiceRow[]): number {
  let max = 0;
  for (const row of rows) {
    const m = EG_PATTERN.exec(row.id);
    if (m === null) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function sortChronologically(rows: readonly CsvInvoiceRow[]): CsvInvoiceRow[] {
  return [...rows].sort((a, b) => {
    if (a.invoiceDate !== b.invoiceDate) {
      return a.invoiceDate < b.invoiceDate ? -1 : 1;
    }
    if (a.periodStart !== b.periodStart) {
      return a.periodStart < b.periodStart ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function discoverRenamePairsFromFzRows(rows: readonly CsvInvoiceRow[]): RenamePair[] {
  const fzRows = rows.filter(r => FZ_LA_FOSSE_PATTERN.test(r.id));
  if (fzRows.length === 0) return [];

  const start = maxEgIndex(rows) + 1;
  const sorted = sortChronologically(fzRows);

  return sorted.map((row, i) => {
    const n = start + i;
    return { from: row.id, to: `EG-${String(n).padStart(4, '0')}` };
  });
}

function loadSavedMap(): RenamePair[] | null {
  if (!fs.existsSync(MAP_JSON)) return null;
  const raw: unknown = JSON.parse(fs.readFileSync(MAP_JSON, 'utf8'));
  if (!Array.isArray(raw)) return null;
  const pairs: RenamePair[] = [];
  for (const item of raw) {
    if (
      typeof item === 'object'
      && item !== null
      && typeof (item as RenamePair).from === 'string'
      && typeof (item as RenamePair).to === 'string'
    ) {
      pairs.push(item as RenamePair);
    }
  }
  return pairs.length > 0 ? pairs : null;
}

function discoverRenamePairsFromMigratedEg(rows: readonly CsvInvoiceRow[]): RenamePair[] {
  const saved = loadSavedMap();
  if (saved !== null) return saved;

  const pairs: RenamePair[] = [];
  for (const row of rows) {
    const fzId = FZ_ID_BY_PAYMENT_REFERENCE[row.paymentReference];
    if (fzId === undefined) continue;
    if (!EG_PATTERN.test(row.id)) continue;
    pairs.push({ from: fzId, to: row.id });
  }
  pairs.sort((a, b) => a.from.localeCompare(b.from));
  return pairs;
}

function discoverRenamePairs(): { pairs: RenamePair[]; source: 'fz-csv' | 'eg-inferred' } {
  const rows = readLaFosseRows();
  const fzPairs = discoverRenamePairsFromFzRows(rows);
  if (fzPairs.length > 0) {
    return { pairs: fzPairs, source: 'fz-csv' };
  }
  return { pairs: discoverRenamePairsFromMigratedEg(rows), source: 'eg-inferred' };
}

function saveMap(pairs: readonly RenamePair[]): void {
  fs.writeFileSync(MAP_JSON, `${JSON.stringify(pairs, null, 2)}\n`);
}

function replaceIds(content: string, pairs: readonly RenamePair[]): string {
  let out = content;
  for (const { from, to } of pairs) {
    out = out.split(from).join(to);
  }
  return out;
}

function renameLocalPdf(fromId: string, toId: string, apply: boolean): void {
  const fromPath = path.join(INGESTED_DIR, `${fromId}.pdf`);
  const toPath = path.join(INGESTED_DIR, `${toId}.pdf`);

  if (fs.existsSync(toPath) && !fs.existsSync(fromPath)) {
    console.log(`  pdf skip (already renamed): ${fromId}.pdf → ${toId}.pdf`);
    return;
  }
  if (!fs.existsSync(fromPath)) {
    console.warn(`  pdf missing: ${fromPath}`);
    return;
  }
  if (fs.existsSync(toPath)) {
    throw new Error(`Cannot rename ${fromId}.pdf: ${toId}.pdf already exists`);
  }
  console.log(`  pdf ${apply ? 'rename' : 'would rename'}: ${fromId}.pdf → ${toId}.pdf`);
  if (apply) fs.renameSync(fromPath, toPath);
}

function loadS3Config(): { bucket: string; prefix: string; region: string } {
  const bucket = process.env.BUCKET_DATA ?? process.env.BANK_S3_DURABLE_BUCKET;
  const prefix = process.env.BANK_S3_DURABLE_PREFIX ?? 'bank-state/prod';
  const region = process.env.AWS_REGION ?? 'eu-west-2';
  if (!bucket) {
    throw new Error(
      'BUCKET_DATA or BANK_S3_DURABLE_BUCKET must be set (source deploy/aws/config.sh)',
    );
  }
  return { bucket, prefix, region };
}

function s3ObjectExists(bucket: string, key: string, region: string): boolean {
  try {
    execSync(
      `aws s3api head-object --bucket "${bucket}" --key "${key}" --region "${region}"`,
      { stdio: 'pipe' },
    );
    return true;
  } catch {
    return false;
  }
}

function mvS3Pdf(
  fromId: string,
  toId: string,
  cfg: { bucket: string; prefix: string; region: string },
  apply: boolean,
): void {
  const fromKey = `${cfg.prefix}/invoices/ingested/${fromId}.pdf`;
  const toKey = `${cfg.prefix}/invoices/ingested/${toId}.pdf`;
  const fromUri = `s3://${cfg.bucket}/${fromKey}`;
  const toUri = `s3://${cfg.bucket}/${toKey}`;

  const destExists = s3ObjectExists(cfg.bucket, toKey, cfg.region);
  const srcExists = s3ObjectExists(cfg.bucket, fromKey, cfg.region);

  if (destExists && !srcExists) {
    console.log(`  s3 skip (already renamed): ${fromUri} → ${toUri}`);
    return;
  }
  if (!srcExists) {
    console.warn(`  s3 source missing: ${fromUri}`);
    return;
  }
  if (destExists) throw new Error(`S3 destination already exists: ${toUri}`);

  console.log(`  s3 ${apply ? 'mv' : 'would mv'}: ${fromUri} → ${toUri}`);
  if (apply) {
    execSync(
      `aws s3 mv "${fromUri}" "${toUri}" --region "${cfg.region}"`,
      { stdio: 'inherit' },
    );
  }
}

function uploadCsvToS3(
  localPath: string,
  s3Name: string,
  cfg: { bucket: string; prefix: string; region: string },
  apply: boolean,
): void {
  const dest = `s3://${cfg.bucket}/${cfg.prefix}/invoices/${s3Name}`;
  console.log(`  s3 ${apply ? 'cp' : 'would cp'}: ${localPath} → ${dest}`);
  if (apply) {
    execSync(
      `aws s3 cp "${localPath}" "${dest}" --region "${cfg.region}"`,
      { stdio: 'inherit' },
    );
  }
}

function main(): void {
  const { apply, s3 } = parseArgs(process.argv.slice(2));
  const { pairs, source } = discoverRenamePairs();

  if (pairs.length === 0) {
    console.log('No la-fosse FZ → EG rename pairs found.');
    return;
  }

  const localAlreadyMigrated = source === 'eg-inferred';
  if (localAlreadyMigrated && !s3) {
    console.log(
      'Local data is already EG-#### (no FZ- rows). Re-run with --s3 to rename PDFs on S3 and upload CSVs.',
    );
    return;
  }

  const modeLabel = localAlreadyMigrated
    ? 'S3-only (local already EG-####)'
    : 'local FZ → EG';
  console.log(
    `${apply ? 'Applying' : 'Dry-run'}: ${pairs.length} FZ → EG renumbers (${modeLabel})`,
  );
  for (const { from, to } of pairs) {
    console.log(`  ${from} → ${to}`);
  }

  if (!localAlreadyMigrated) {
    for (const { from, to } of pairs) {
      renameLocalPdf(from, to, apply);
    }

    const invoicesAfter = replaceIds(fs.readFileSync(INVOICES_CSV, 'utf8'), pairs);
    const paymentsAfter = replaceIds(fs.readFileSync(PAYMENTS_CSV, 'utf8'), pairs);

    if (apply) {
      fs.writeFileSync(INVOICES_CSV, invoicesAfter);
      fs.writeFileSync(PAYMENTS_CSV, paymentsAfter);
      saveMap(pairs);
      console.log('Updated invoices.csv, invoice_payments.csv, and .fz-eg-rename-map.json');
    } else {
      console.log('Would update invoices.csv and invoice_payments.csv');
    }
  } else {
    console.log('Skipping local PDF/CSV steps (already migrated).');
  }

  if (s3) {
    const cfg = loadS3Config();
    console.log(`S3 bucket=${cfg.bucket} prefix=${cfg.prefix}`);
    for (const { from, to } of pairs) {
      mvS3Pdf(from, to, cfg, apply);
    }
    uploadCsvToS3(INVOICES_CSV, 'invoices.csv', cfg, apply);
    uploadCsvToS3(PAYMENTS_CSV, 'invoice_payments.csv', cfg, apply);
  }

  console.log('Done.');
}

main();
