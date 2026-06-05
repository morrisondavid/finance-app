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
import { todayIsoLocal } from '../shared/iso-date.js';
import type { Contract, EntityId } from '../shared/api-contracts.js';
import { upsertContract } from '../server/domain/contracts/queries.js';
import { syncContractRenewalDeadlines } from '../server/domain/contracts/deadline-seeder.js';
import { persistIngestedSelfBillFromBuffer } from '../server/domain/invoices/ingest-persist.js';
import {
  allInvoices,
  autoReconcileHighConfidence,
} from '../server/domain/invoices/index.js';

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

function reconcileEntity(entityId: EntityId): {
  referenceMatched: number;
  amountOnlyProposed: number;
  unmatchedInvoices: number;
  unmatchedTransactions: number;
} {
  const auto = autoReconcileHighConfidence({
    entityId,
    windowStart: '2025-01-01',
    windowEnd: TODAY,
    now: TODAY,
  });

  const amountOnlyProposed = auto.plan.proposedPayments.filter(
    payment => auto.plan.paymentConfidence.get(payment.id) === 'amount-only',
  ).length;

  return {
    referenceMatched: auto.persisted.length,
    amountOnlyProposed,
    unmatchedInvoices: auto.plan.unmatchedInvoices.length,
    unmatchedTransactions: auto.plan.unmatchedTransactions.length,
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
