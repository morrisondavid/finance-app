/**
 * One-shot: persist Delta Capita invoice ↔ bank payment links.
 *
 * DC invoices are marked paid but had no rows in invoice_payments.csv.
 * The default 180-day reconcile window misses older deposits (DC-001..005);
 * this script uses a window from contract start and auto-persists
 * reference-exact matches only.
 *
 * Usage:
 *   tsx scripts/reconcile-delta-capita-payments.ts          # dry-run
 *   tsx scripts/reconcile-delta-capita-payments.ts --apply  # persist CSV
 */

import { initDatabase } from '../server/db/index.js';
import {
  autoReconcileHighConfidence,
  buildEntityReconciliationPlan,
} from '../server/domain/invoices/index.js';
import { deriveUnmatchedDepositWarnings } from '../server/domain/warnings/invoice-reconciler.js';
import { todayIsoLocal } from '../shared/iso-date.js';

const DC_WINDOW_START = '2025-06-01';
const ENTITY_ID = 'autonize-it-ltd' as const;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await initDatabase();
  const today = todayIsoLocal();

  const plan = buildEntityReconciliationPlan({
    entityId: ENTITY_ID,
    windowStart: DC_WINDOW_START,
    windowEnd: today,
  });

  const dcProposed = plan.proposedPayments.filter(
    p => p.invoice_id.startsWith('DC-')
      && plan.paymentConfidence.get(p.id) === 'reference-exact',
  );

  console.log(`${apply ? 'Applying' : 'Dry-run'}: ${dcProposed.length} reference-exact DC payment(s)`);
  for (const p of dcProposed) {
    console.log(`  ${p.invoice_id}  ${p.payment_date}  £${p.amount_paid}  hash=${p.bank_transaction_id}`);
  }

  if (!apply) {
    console.log('\nRe-run with --apply to write invoice_payments.csv.');
    return;
  }

  const result = autoReconcileHighConfidence({
    entityId: ENTITY_ID,
    windowStart: DC_WINDOW_START,
    windowEnd: today,
  });

  const persistedDc = result.persisted.filter(p => p.invoice_id.startsWith('DC-'));
  console.log(`\nPersisted ${persistedDc.length} DC payment row(s).`);

  const verifyPlan = buildEntityReconciliationPlan({
    entityId: ENTITY_ID,
    windowStart: DC_WINDOW_START,
    windowEnd: today,
  });
  const warnings = deriveUnmatchedDepositWarnings({
    plan: verifyPlan,
    entityId: ENTITY_ID,
  });
  const deltaWarnings = warnings.filter(
    w => w.code === 'invoice-unmatched-deposit'
      && w.detail.toUpperCase().includes('DELTA'),
  );
  console.log(`Delta Capita unmatched-deposit warnings after persist: ${deltaWarnings.length}`);
  for (const w of deltaWarnings) {
    console.log(`  ${w.context?.depositDate} £${w.context?.amount} tx=${w.context?.transactionId}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
