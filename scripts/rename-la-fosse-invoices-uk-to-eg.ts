/**
 * One-shot: rename La Fosse self-bill invoices UK-#### → EG-####.
 *
 * Usage:
 *   tsx scripts/rename-la-fosse-invoices-uk-to-eg.ts              # dry-run
 *   tsx scripts/rename-la-fosse-invoices-uk-to-eg.ts --apply      # local only
 *   tsx scripts/rename-la-fosse-invoices-uk-to-eg.ts --apply --s3 # local + S3 mv
 *
 * If local CSV/PDFs are already EG-####, `--s3` alone still renames objects on
 * S3 (pairs inferred as UK-#### → EG-#### from la-fosse EG rows).
 *
 * Requires `source deploy/aws/config.sh` when using --s3.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVOICES_CSV = path.join(REPO_ROOT, 'invoices', 'invoices.csv');
const PAYMENTS_CSV = path.join(REPO_ROOT, 'invoices', 'invoice_payments.csv');
const INGESTED_DIR = path.join(REPO_ROOT, 'invoices', 'ingested');

const UK_LA_FOSSE_PATTERN = /^UK-(\d{4})$/;
const EG_LA_FOSSE_PATTERN = /^EG-(\d{4})$/;

interface RenamePair {
  readonly from: string;
  readonly to: string;
}

type PairSource = 'uk-csv' | 'eg-inferred';

function parseArgs(argv: string[]): { apply: boolean; s3: boolean } {
  return {
    apply: argv.includes('--apply'),
    s3: argv.includes('--s3'),
  };
}

function discoverRenamePairs(): { pairs: RenamePair[]; source: PairSource } {
  const text = fs.readFileSync(INVOICES_CSV, 'utf8');
  const lines = text.split('\n');
  const ukPairs: RenamePair[] = [];
  const egPairs: RenamePair[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split(',');
    const id = cols[0];
    const clientId = cols[2];
    if (clientId !== 'la-fosse') continue;

    const uk = UK_LA_FOSSE_PATTERN.exec(id);
    if (uk !== null) {
      ukPairs.push({ from: id, to: `EG-${uk[1]}` });
      continue;
    }

    const eg = EG_LA_FOSSE_PATTERN.exec(id);
    if (eg !== null) {
      egPairs.push({ from: `UK-${eg[1]}`, to: id });
    }
  }

  if (ukPairs.length > 0) {
    ukPairs.sort((a, b) => a.from.localeCompare(b.from));
    return { pairs: ukPairs, source: 'uk-csv' };
  }

  egPairs.sort((a, b) => a.to.localeCompare(b.to));
  return { pairs: egPairs, source: 'eg-inferred' };
}

function replaceUkWithEg(content: string, pairs: readonly RenamePair[]): string {
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
  if (apply) {
    fs.renameSync(fromPath, toPath);
  }
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

function s3ObjectExists(
  bucket: string,
  key: string,
  region: string,
): boolean {
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
  if (destExists) {
    throw new Error(`S3 destination already exists: ${toUri}`);
  }

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

function verifyNoUkLaFosseRows(): void {
  const text = fs.readFileSync(INVOICES_CSV, 'utf8');
  const bad = text
    .split('\n')
    .slice(1)
    .filter(line => line.includes('la-fosse') && /,UK-\d{4},/.test(line));
  if (bad.length > 0) {
    throw new Error(`Still have la-fosse rows with UK- ids:\n${bad.join('\n')}`);
  }
}

function main(): void {
  const { apply, s3 } = parseArgs(process.argv.slice(2));
  const { pairs, source } = discoverRenamePairs();

  if (pairs.length === 0) {
    console.log('No la-fosse invoice rows found in invoices.csv.');
    return;
  }

  const localAlreadyMigrated = source === 'eg-inferred';
  if (localAlreadyMigrated && !s3) {
    console.log(
      'Local data is already EG-#### (no UK- rows). Re-run with --s3 to rename PDFs on S3 and upload CSVs.',
    );
    verifyNoUkLaFosseRows();
    return;
  }

  const modeLabel = localAlreadyMigrated
    ? 'S3-only (local already EG-####)'
    : 'local UK → EG';
  console.log(
    `${apply ? 'Applying' : 'Dry-run'}: ${pairs.length} invoice id renames (${modeLabel})`,
  );
  for (const { from, to } of pairs) {
    console.log(`  ${from} → ${to}`);
  }

  if (!localAlreadyMigrated) {
    for (const { from, to } of pairs) {
      renameLocalPdf(from, to, apply);
    }

    const invoicesBefore = fs.readFileSync(INVOICES_CSV, 'utf8');
    const paymentsBefore = fs.readFileSync(PAYMENTS_CSV, 'utf8');
    const invoicesAfter = replaceUkWithEg(invoicesBefore, pairs);
    const paymentsAfter = replaceUkWithEg(paymentsBefore, pairs);

    if (apply) {
      fs.writeFileSync(INVOICES_CSV, invoicesAfter);
      fs.writeFileSync(PAYMENTS_CSV, paymentsAfter);
      verifyNoUkLaFosseRows();
      console.log('Updated invoices.csv and invoice_payments.csv');
    } else {
      console.log('Would update invoices.csv and invoice_payments.csv');
    }
  } else {
    verifyNoUkLaFosseRows();
    console.log('Skipping local PDF/CSV steps (already migrated).');
  }

  if (s3) {
    const cfg = loadS3Config();
    console.log(`S3 bucket=${cfg.bucket} prefix=${cfg.prefix}`);
    for (const { from, to } of pairs) {
      mvS3Pdf(from, to, cfg, apply);
    }
    if (apply) {
      uploadCsvToS3(INVOICES_CSV, 'invoices.csv', cfg, true);
      uploadCsvToS3(PAYMENTS_CSV, 'invoice_payments.csv', cfg, true);
    } else {
      uploadCsvToS3(INVOICES_CSV, 'invoices.csv', cfg, false);
      uploadCsvToS3(PAYMENTS_CSV, 'invoice_payments.csv', cfg, false);
    }
  }

  console.log('Done.');
}

main();
