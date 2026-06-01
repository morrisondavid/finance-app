/**
 * One-shot: La Fosse self-bill contract fixes, batch ingest, and payment reconcile.
 *
 * Usage:
 *   tsx scripts/ingest-la-fosse-self-bills.ts [pdf-dir]
 *
 * Defaults pdf-dir to /tmp/lf-invoices (extract documents.zip there first).
 */

import fs from 'fs';
import path from 'path';
import { initDatabase } from '../server/db/index.js';
import { getDb } from '../server/db/connection.js';
import { todayIsoLocal } from '../shared/iso-date.js';
import type { Contract, EntityId } from '../shared/api-contracts.js';
import { upsertContract } from '../server/domain/contracts/queries.js';
import { syncContractRenewalDeadlines } from '../server/domain/contracts/deadline-seeder.js';
import { persistIngestedSelfBillFromBuffer } from '../server/domain/invoices/ingest-persist.js';
import {
  allInvoicePayments,
  allInvoices,
  listInvoicesByStatus,
  updateInvoice,
  extractLaFosseSupplierRefs,
  laFosseDepositAmountForMatch,
  loadLaFosseReconcileTransactions,
  planReconciliation,
  recordInvoicePayments,
  type Invoice,
  type InvoicePayment,
  type ReconcileTransaction,
} from '../server/domain/invoices/index.js';
import { normaliseForMatch } from '../server/domain/clients/narrative-match.js';
import { allClients } from '../server/domain/clients/queries.js';
import { CurrencyCodeSchema } from '../shared/api-contracts.js';

const PDF_DIR = process.argv[2] ?? '/tmp/lf-invoices';
const TODAY = todayIsoLocal();

function contractBase(partial: Pick<Contract, 'id' | 'placement_ref' | 'issuing_entity_id' | 'start_date' | 'end_date' | 'day_rate' | 'reference'>): Contract {
  return {
    client_id: 'la-fosse',
    master_id: null,
    works_monday: true,
    works_tuesday: true,
    works_wednesday: true,
    works_thursday: true,
    works_friday: true,
    works_saturday: false,
    works_sunday: false,
    day_rate_currency: 'GBP',
    invoice_currency: 'GBP',
    invoice_cadence: 'weekly',
    invoice_mechanism: 'self-bill',
    payment_terms_days: 30,
    company_notice_weeks: 2,
    supplier_notice_weeks: 2,
    renewal_warning_days: 30,
    job_title: 'Full Stack Engineer',
    job_description: null,
    work_location: 'Remote with occasional office visits (London, Sheffield or Newcastle)',
    conduct_regs: partial.issuing_entity_id === 'autonize-it-ltd' ? 'opted-out' : null,
    engagement_tax_status: partial.issuing_entity_id === 'autonize-it-ltd' ? 'outside-ir35' : null,
    jurisdiction: 'England',
    signed_at: partial.start_date,
    docusign_envelope: null,
    updated_at: TODAY,
    ...partial,
  };
}

function upsertLaFosseContracts(): void {
  const rows: Contract[] = [
    contractBase({
      id: 'lf-bh25537',
      reference: 'La Fosse · 18 Feb 2025–28 Sep 2025',
      placement_ref: 'BH-25537',
      issuing_entity_id: 'autonize-it-ltd',
      start_date: '2025-02-18',
      end_date: '2025-09-28',
      day_rate: 600,
    }),
    contractBase({
      id: 'lf-bh28240',
      reference: 'La Fosse · 29 Sep 2025–01 Mar 2026',
      placement_ref: 'BH-28240',
      issuing_entity_id: 'autonize-it-ltd',
      start_date: '2025-09-29',
      end_date: '2026-03-01',
      day_rate: 600,
    }),
    contractBase({
      id: 'lf-2026-apr',
      reference: 'La Fosse · 02 Mar 2026–30 Apr 2026',
      placement_ref: 'BH-29723',
      issuing_entity_id: 'autonize-it-fzco',
      start_date: '2026-03-02',
      end_date: '2026-04-30',
      day_rate: 500,
    }),
    contractBase({
      id: 'lf-2026-may',
      reference: 'La Fosse · 01 May 2026–31 May 2026',
      placement_ref: 'BH-30484',
      issuing_entity_id: 'autonize-it-fzco',
      start_date: '2026-05-01',
      end_date: '2026-05-31',
      day_rate: 500,
    }),
  ];

  for (const row of rows) {
    upsertContract({ contract: row });
  }
}

async function ingestPdfDirectory(dir: string): Promise<{ ingested: number; failed: { file: string; code: string }[] }> {
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
  let ingested = 0;
  const failed: { file: string; code: string }[] = [];

  for (const file of files) {
    const buffer = fs.readFileSync(path.join(dir, file));
    const result = await persistIngestedSelfBillFromBuffer(buffer, TODAY);
    if (result.ok) {
      ingested += 1;
      continue;
    }
    failed.push({ file, code: result.code });
  }
  return { ingested, failed };
}

function loadLaFosseIncomeTransactions(
  invoiceEntityId: EntityId,
  windowStart: string,
  windowEnd: string,
): readonly ReconcileTransaction[] {
  return loadLaFosseReconcileTransactions({
    invoiceEntityId,
    windowStart,
    windowEnd,
    queryRows: (accounts, start, end) =>
      getDb()
        .prepare(
          `SELECT id, date, description, amount, account
             FROM transactions
             WHERE type = 'income'
               AND account IN (${accounts.map(() => '?').join(', ')})
               AND date >= ? AND date <= ?
             ORDER BY date ASC`,
        )
        .all(...accounts, start, end) as readonly {
        id: number;
        date: string;
        description: string;
        amount: number;
        account: string;
      }[],
  });
}

function compactSupplierRef(raw: string): string {
  return normaliseForMatch(raw).replace(/\s+/g, '');
}

function extractSupplierRefs(description: string): readonly string[] {
  return extractLaFosseSupplierRefs(description);
}

function supplierRefMatchesInvoice(ref: string, paymentReference: string): boolean {
  const r = compactSupplierRef(ref);
  const p = compactSupplierRef(paymentReference);
  if (r.length === 0 || p.length === 0) return false;
  if (p.startsWith(r) || r.startsWith(p)) return true;

  const refDigits = r.replace(/^SB/i, '');
  const payDigits = p.replace(/^SB/i, '');
  if (refDigits.length >= 4 && payDigits.length >= refDigits.length) {
    return payDigits.startsWith(refDigits);
  }
  return false;
}

function expandCandidatesForDeposit(
  seed: readonly Invoice[],
  pool: readonly Invoice[],
  depositAmount: number,
): readonly Invoice[] {
  if (seed.length === 0) return seed;
  const chosen = new Map(seed.map(inv => [inv.id, inv] as const));
  let total = [...chosen.values()].reduce((sum, inv) => sum + inv.total, 0);
  if (Math.abs(total - depositAmount) / depositAmount <= 0.02) {
    return [...chosen.values()];
  }

  const remaining = pool
    .filter(inv => !chosen.has(inv.id))
    .sort((a, b) => a.period_start.localeCompare(b.period_start));

  for (const inv of remaining) {
    const nextTotal = total + inv.total;
    if (nextTotal - depositAmount > depositAmount * 0.02) continue;
    chosen.set(inv.id, inv);
    total = nextTotal;
    if (Math.abs(total - depositAmount) / depositAmount <= 0.02) {
      return [...chosen.values()];
    }
  }

  return seed;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildSbPayment(
  invoice: Invoice,
  tx: ReconcileTransaction,
  amountInInvoiceCurrency: number,
  amountPaid: number,
  createdAt: string,
): InvoicePayment {
  return {
    id: `ip-${invoice.id}-${tx.id}`,
    invoice_id: invoice.id,
    bank_transaction_id: tx.id,
    payment_date: tx.date,
    amount_paid: round2(amountPaid),
    deposit_currency: CurrencyCodeSchema.parse(tx.currency),
    fx_rate_at_payment: null,
    amount_in_invoice_currency: round2(amountInInvoiceCurrency),
    fx_gain_loss: 0,
    residual: round2(invoice.total - amountInInvoiceCurrency),
    created_at: createdAt,
    updated_at: null,
  };
}

/** La Fosse often batches several SB numbers on one deposit — match by narrative first. */
function reconcileBySupplierReference(
  entityId: EntityId,
  windowStart: string,
  windowEnd: string,
): number {
  const issued = listInvoicesByStatus('issued').filter(inv => inv.issuing_entity_id === entityId);
  if (issued.length === 0) return 0;

  const paidInvoiceIds = new Set(allInvoicePayments().map(p => p.invoice_id));
  const unpaid = issued.filter(inv => !paidInvoiceIds.has(inv.id));
  if (unpaid.length === 0) return 0;

  const transactions = loadLaFosseIncomeTransactions(entityId, windowStart, windowEnd);
  const proposed: InvoicePayment[] = [];
  const claimedInvoiceIds = new Set<string>();

  for (const tx of transactions) {
    const refs = extractSupplierRefs(tx.description);
    if (refs.length === 0) continue;

    let candidates = unpaid.filter(
      inv =>
        !claimedInvoiceIds.has(inv.id)
        && refs.some(ref => supplierRefMatchesInvoice(ref, inv.payment_reference)),
    );
    if (candidates.length === 0) continue;

    const depositAmount = laFosseDepositAmountForMatch(tx);
    candidates = expandCandidatesForDeposit(candidates, unpaid, depositAmount);
    if (candidates.length === 0) continue;

    const groupTotal = candidates.reduce((sum, inv) => sum + inv.total, 0);
    const amountDelta = Math.abs(depositAmount - groupTotal) / groupTotal;
    if (amountDelta > 0.02) continue;

    for (const inv of candidates) {
      const share = inv.total / groupTotal;
      const amountPaid = tx.currency === inv.currency
        ? depositAmount * share
        : tx.amount * share;
      proposed.push(
        buildSbPayment(inv, tx, inv.total, amountPaid, TODAY),
      );
      claimedInvoiceIds.add(inv.id);
    }
  }

  if (proposed.length === 0) return 0;

  const persisted = recordInvoicePayments({ payments: proposed });
  if (!persisted.ok) {
    throw new Error(`SB reconcile persist failed: ${persisted.code}`);
  }

  for (const payment of proposed) {
    if (payment.residual > 0.01) continue;
    updateInvoice({ invoiceId: payment.invoice_id, patch: { status: 'paid' } });
  }

  return proposed.length;
}

function reconcileEntity(entityId: EntityId): {
  sbMatched: number;
  amountMatched: number;
  unmatchedInvoices: number;
  unmatchedTransactions: number;
} {
  const issued = listInvoicesByStatus('issued').filter(inv => inv.issuing_entity_id === entityId);
  if (issued.length === 0) {
    return { sbMatched: 0, amountMatched: 0, unmatchedInvoices: 0, unmatchedTransactions: 0 };
  }

  const earliestDue = issued.reduce((min, inv) => (inv.due_date < min ? inv.due_date : min), issued[0]!.due_date);
  const windowStart = earliestDue < '2025-01-01' ? '2025-01-01' : earliestDue;
  const windowEnd = TODAY;

  const sbMatched = reconcileBySupplierReference(entityId, '2025-01-01', windowEnd);

  const issuedAfterSb = listInvoicesByStatus('issued').filter(inv => inv.issuing_entity_id === entityId);
  if (issuedAfterSb.length === 0) {
    return { sbMatched, amountMatched: 0, unmatchedInvoices: 0, unmatchedTransactions: 0 };
  }

  const transactions = loadLaFosseIncomeTransactions(entityId, windowStart, windowEnd);
  const clientsById = new Map(allClients().map(c => [c.id, c] as const));

  const plan = planReconciliation({
    invoices: issuedAfterSb,
    transactions,
    clientsById,
    existingPayments: allInvoicePayments(),
    options: {
      now: TODAY,
      maxProximityDays: 120,
      amountTolerance: 0.02,
    },
  });

  if (plan.proposedPayments.length > 0) {
    const persisted = recordInvoicePayments({ payments: plan.proposedPayments });
    if (!persisted.ok) {
      throw new Error(`recordInvoicePayments failed: ${persisted.code}`);
    }

    for (const payment of plan.proposedPayments) {
      const inv = issued.find(i => i.id === payment.invoice_id);
      if (inv === undefined) continue;
      if (payment.residual > 0.01) continue;
      updateInvoice({
        invoiceId: inv.id,
        patch: { status: 'paid' },
      });
    }
  }

  return {
    sbMatched,
    amountMatched: plan.proposedPayments.length,
    unmatchedInvoices: plan.unmatchedInvoices.length,
    unmatchedTransactions: plan.unmatchedTransactions.length,
  };
}

async function main(): Promise<void> {
  const reconcileOnly = process.argv.includes('--reconcile-only');

  if (!reconcileOnly) {
    if (!fs.existsSync(PDF_DIR)) {
      console.error(`PDF directory not found: ${PDF_DIR}`);
      process.exit(1);
    }

    console.log('[1/4] Updating La Fosse contracts (clients/contracts.csv)...');
    upsertLaFosseContracts();

    console.log(`[2/4] Ingesting PDFs from ${PDF_DIR}...`);
    const ingest = await ingestPdfDirectory(PDF_DIR);
    console.log(`  ingested: ${ingest.ingested}, failed: ${ingest.failed.length}`);
    if (ingest.failed.length > 0) {
      for (const f of ingest.failed) {
        console.error(`  FAIL ${f.file}: ${f.code}`);
      }
      process.exit(1);
    }
  } else {
    console.log('[skip] Ingest — reconcile-only mode');
  }

  console.log('[3/4] Initialising database...');
  await initDatabase();
  if (!reconcileOnly) {
    syncContractRenewalDeadlines();
  }

  console.log('[4/4] Reconciling payments (Ltd then FZCO)...');
  const ltd = reconcileEntity('autonize-it-ltd');
  const fzco = reconcileEntity('autonize-it-fzco');
  console.log('  autonize-it-ltd:', ltd);
  console.log('  autonize-it-fzco:', fzco);

  const laFosse = allInvoices().filter(i => i.client_id === 'la-fosse');
  const paid = laFosse.filter(i => i.status === 'paid').length;
  const issued = laFosse.filter(i => i.status === 'issued').length;
  console.log(`Done. La Fosse invoices: ${laFosse.length} total, ${paid} paid, ${issued} issued.`);
  console.log('CSV files updated: clients/contracts.csv, invoices/invoices.csv, invoices/invoice_payments.csv');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
