/**
 * One-shot migration: re-point `invoice_payments.csv` `bank_transaction_id`
 * from the volatile autoincrement `transactions.id` to the stable content
 * `transactions.hash`.
 *
 * Why: a feed re-sync reassigns autoincrement ids, so payment rows captured
 * against an older DB now point at unrelated transactions. The matcher keys
 * on the stable hash (see `ReconcileTransaction.id`), so existing rows must be
 * migrated to the hash too — otherwise settled deposits look "unmatched".
 *
 * Each payment group (rows sharing one stale `bank_transaction_id`) is matched
 * back to the real deposit by (payment_date + summed amount + SB reference in
 * the narrative). Rewrites `bank_transaction_id` to the hash and regenerates
 * the row `id` as `ip-<invoice_id>-<hash>` to match the reconciler convention.
 *
 * Usage:
 *   tsx scripts/repoint-invoice-payments-to-hash.ts          # dry-run
 *   tsx scripts/repoint-invoice-payments-to-hash.ts --apply  # rewrite CSV
 */

import path from 'path';
import { fileURLToPath } from 'url';

import type { InvoicePayment } from '../shared/api-contracts.js';
import { initConnection, getDb } from '../server/db/connection.js';
import { getAccountConfig } from '../server/domain/accounts/queries.js';
import { extractLaFosseSupplierRefs } from '../server/domain/invoices/la-fosse-reconcile-accounts.js';
import {
  getInvoicesCsvPath,
  getInvoicePaymentsCsvPath,
  readInvoicesCsvFile,
  readInvoicePaymentsCsvFile,
  writeInvoicePaymentsCsvFile,
} from '../server/domain/invoices/csv-io.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVOICES_DIR = path.join(REPO_ROOT, 'invoices');

interface TxRow {
  readonly id: number;
  readonly hash: string;
  readonly date: string;
  readonly amount: number;
  readonly description: string;
  readonly account: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Absolute tolerance (in deposit currency units) when matching a deposit
 * total to a bank row. Covers sub-cent rounding when an FX deposit is split
 * across several invoices (e.g. AED 45760.66 summed vs 45760.65 on the row).
 */
const AMOUNT_TOLERANCE = 0.05;

function amountsMatch(candidate: number, total: number): boolean {
  return Math.abs(round2(candidate) - total) <= AMOUNT_TOLERANCE;
}

function isBusinessAccount(account: string): boolean {
  try {
    return getAccountConfig(account as Parameters<typeof getAccountConfig>[0]).category === 'business';
  } catch {
    return false;
  }
}

function descriptionCitesRef(description: string, ref: string): boolean {
  const refs = extractLaFosseSupplierRefs(description);
  if (refs.includes(ref)) return true;
  // Fall back to a loose contains for non-SB references.
  return description.replace(/\s+/g, '').includes(ref.replace(/\s+/g, ''));
}

interface GroupResolution {
  readonly staleId: string;
  readonly hash: string | null;
  readonly chosen: TxRow | null;
  readonly leftoverLegs: readonly TxRow[];
  readonly invoiceIds: readonly string[];
  readonly date: string;
  readonly currency: string;
  readonly total: number;
}

function resolveGroup(
  staleId: string,
  rows: readonly InvoicePayment[],
  refByInvoiceId: ReadonlyMap<string, string>,
  candidatesByDate: (date: string) => readonly TxRow[],
): GroupResolution {
  const date = rows[0]!.payment_date;
  const currency = rows[0]!.deposit_currency;
  const total = round2(rows.reduce((sum, r) => sum + r.amount_paid, 0));
  const invoiceIds = rows.map(r => r.invoice_id);
  const refs = new Set(
    invoiceIds
      .map(id => refByInvoiceId.get(id))
      .filter((r): r is string => r !== undefined && r.length > 0),
  );

  const candidates = candidatesByDate(date).filter(
    c => isBusinessAccount(c.account) && amountsMatch(c.amount, total),
  );

  const base = { staleId, invoiceIds, date, currency, total };

  if (candidates.length === 0) {
    return { ...base, hash: null, chosen: null, leftoverLegs: [] };
  }

  let pool = candidates;
  if (candidates.length > 1 && refs.size > 0) {
    const byRef = candidates.filter(c =>
      [...refs].some(ref => descriptionCitesRef(c.description, ref)),
    );
    if (byRef.length > 0) pool = byRef;
  }

  const sorted = [...pool].sort((a, b) => a.id - b.id);
  const chosen = sorted[0]!;
  const leftoverLegs = sorted.slice(1);
  return { ...base, hash: chosen.hash, chosen, leftoverLegs };
}

function main(): void {
  const apply = process.argv.includes('--apply');
  initConnection();

  const invoices = readInvoicesCsvFile(getInvoicesCsvPath(INVOICES_DIR));
  const refByInvoiceId = new Map(invoices.map(i => [i.id, i.payment_reference]));

  const paymentsPath = getInvoicePaymentsCsvPath(INVOICES_DIR);
  const payments = readInvoicePaymentsCsvFile(paymentsPath);

  const groups = new Map<string, InvoicePayment[]>();
  for (const p of payments) {
    const bucket = groups.get(p.bank_transaction_id);
    if (bucket === undefined) groups.set(p.bank_transaction_id, [p]);
    else bucket.push(p);
  }

  const db = getDb();
  const stmt = db.prepare(
    `SELECT id, hash, date, amount, description, account
       FROM transactions
       WHERE date = ? AND type = 'income'`,
  );
  const candidatesByDate = (date: string): readonly TxRow[] =>
    stmt.all(date) as TxRow[];

  const remap = new Map<string, string>();
  const unresolved: GroupResolution[] = [];
  const duplicateLegs: GroupResolution[] = [];

  const sortedGroupKeys = [...groups.keys()].sort();
  console.log(`${apply ? 'Applying' : 'Dry-run'}: ${groups.size} payment groups\n`);

  for (const staleId of sortedGroupKeys) {
    const rows = groups.get(staleId)!;
    const res = resolveGroup(staleId, rows, refByInvoiceId, candidatesByDate);
    const label = `[${res.invoiceIds.join(',')}] ${res.date} ${res.currency} ${res.total.toFixed(2)}`;

    if (res.hash === null) {
      unresolved.push(res);
      console.log(`UNRESOLVED  bank_tx=${staleId}  ${label}  (no income tx matches date+total)`);
      continue;
    }

    const already = staleId === res.hash;
    remap.set(staleId, res.hash);
    console.log(
      `${already ? 'OK (hash)  ' : 'REMAP      '}bank_tx=${staleId} -> ${res.hash}  tx#${res.chosen!.id}  ${label}`,
    );
    if (res.leftoverLegs.length > 0) {
      duplicateLegs.push(res);
      for (const leg of res.leftoverLegs) {
        console.log(
          `   leftover duplicate leg: tx#${leg.id} ${leg.date} ${leg.amount.toFixed(2)} "${leg.description.replace(/\s+/g, ' ').trim()}"`,
        );
      }
    }
  }

  const next: InvoicePayment[] = payments.map(p => {
    const hash = remap.get(p.bank_transaction_id);
    if (hash === undefined || hash === p.bank_transaction_id) return p;
    return { ...p, bank_transaction_id: hash, id: `ip-${p.invoice_id}-${hash}` };
  });

  const changed = next.filter((p, i) => p.id !== payments[i]!.id).length;

  console.log(
    `\nSummary: ${changed} rows would change, ${unresolved.length} unresolved groups, ${duplicateLegs.length} groups with duplicate bank legs.`,
  );

  if (!apply) {
    console.log('\nDry-run only. Re-run with --apply to write invoice_payments.csv.');
    return;
  }

  writeInvoicePaymentsCsvFile(paymentsPath, next);
  console.log(`\nWrote ${next.length} rows to ${paymentsPath}`);
  if (unresolved.length > 0) {
    console.log('NOTE: unresolved groups were left unchanged — inspect them manually.');
  }
}

main();
