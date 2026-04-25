/**
 * Invoice reconciler warnings (§1.3 Phase 4).
 *
 * Two pure derivations sit here:
 *
 *   1. {@link deriveInvoiceRowWarnings} — invoice-row-only checks that
 *      don't need a match plan: stale `payment_reference`, implausible
 *      `due_date` relative to `invoice_date` + contract terms,
 *      nonsensical `period_*`. These are the seven seeded DC anomalies
 *      the §1.3 roadmap calls out.
 *   2. {@link deriveUnmatchedDepositWarnings} — surfaces "this deposit
 *      from a known payer didn't land on any invoice" cases from a
 *      {@link ReconciliationPlan}, complementing the existing
 *      `payment-outside-contract-window` warnings (which fire on the
 *      transaction side; this fires on the invoice side).
 *
 * Both reuse the existing `EntityFoundationWarning` envelope so the
 * Warnings tab consumes them via the same `/api/warnings/entity-foundation`
 * endpoint without a new schema or route. Pure w.r.t. inputs — the
 * route layer or a thin caller hands in invoices, contracts, and the
 * plan; this module never touches the DB or the registry.
 */

import type {
  Contract,
  EntityFoundationWarning,
  Invoice,
} from '../../../shared/api-contracts.js';
import { daysBetween } from '../../../shared/iso-date.js';
import type { ReconciliationPlan } from '../invoices/reconcile-payments.js';

/**
 * Acceptable drift between `invoice.invoice_date + payment_terms` and
 * `invoice.due_date`. Anything beyond this is flagged. ±3 days covers
 * end-of-month / weekend rollover without false positives on the seven
 * deliberately-bad DC seed rows.
 */
const DUE_DATE_DRIFT_DAYS = 3;

export interface DeriveInvoiceRowWarningsInput {
  readonly invoices: readonly Invoice[];
  readonly contractsById: ReadonlyMap<string, Contract>;
}

export function deriveInvoiceRowWarnings(
  input: DeriveInvoiceRowWarningsInput,
): readonly EntityFoundationWarning[] {
  const out: EntityFoundationWarning[] = [];
  for (const inv of input.invoices) {
    appendStalePaymentReferenceWarning(inv, out);
    appendDueDateWarnings(inv, input.contractsById.get(inv.contract_id) ?? null, out);
    appendPeriodInvalidWarning(inv, out);
  }
  return out;
}

export interface DeriveUnmatchedDepositWarningsInput {
  readonly plan: ReconciliationPlan;
}

export function deriveUnmatchedDepositWarnings(
  input: DeriveUnmatchedDepositWarningsInput,
): readonly EntityFoundationWarning[] {
  const out: EntityFoundationWarning[] = [];
  for (const tx of input.plan.unmatchedTransactions) {
    out.push({
      id: `invoice-reconciler.invoice-unmatched-deposit.${tx.account}.${tx.date}.${tx.id}`,
      code: 'invoice-unmatched-deposit',
      severity: 'warn',
      title: `Deposit on ${tx.date} did not match any invoice`,
      detail: `${tx.currency} ${tx.amount.toFixed(2)} arrived in ${tx.account} on ${tx.date} ("${tx.description}") but the reconciler could not pair it with any issued invoice for ${tx.entityId}.`,
      recommended_action:
        `Check whether the deposit settles a missing invoice (issue one if so) or belongs to a non-invoice income source; otherwise widen the matcher tolerances.`,
      sources: [
        `transaction:${tx.account}:${tx.date}:${tx.id}`,
        `entity:${tx.entityId}`,
      ],
    });
  }
  return out;
}

// ─── Row-only checks ────────────────────────────────────────────────────────

function appendStalePaymentReferenceWarning(
  inv: Invoice,
  out: EntityFoundationWarning[],
): void {
  if (inv.payment_reference === inv.invoice_number) return;
  out.push({
    id: `invoice-reconciler.invoice-stale-payment-reference.${inv.id}`,
    code: 'invoice-stale-payment-reference',
    severity: 'warn',
    title: `Invoice ${inv.id} cites a stale payment reference`,
    detail: `Invoice ${inv.id} (number ${inv.invoice_number}) lists payment_reference '${inv.payment_reference}'. A stale reference makes the bank-side reconciler fall back to amount/date heuristics on every payment for this invoice.`,
    recommended_action: `Update payment_reference to '${inv.invoice_number}' in invoices/invoices.csv (or via the issuing flow).`,
    sources: [`invoice:${inv.id}`],
  });
}

function appendDueDateWarnings(
  inv: Invoice,
  contract: Contract | null,
  out: EntityFoundationWarning[],
): void {
  if (inv.due_date < inv.invoice_date) {
    out.push({
      id: `invoice-reconciler.invoice-due-date-implausible.${inv.id}`,
      code: 'invoice-due-date-implausible',
      severity: 'warn',
      title: `Invoice ${inv.id} has a due_date before its invoice_date`,
      detail: `due_date ${inv.due_date} precedes invoice_date ${inv.invoice_date}; almost certainly a year typo on the row.`,
      recommended_action: `Fix the due_date in invoices/invoices.csv to invoice_date + payment_terms_days.`,
      sources: [`invoice:${inv.id}`],
    });
    return;
  }
  if (contract === null) return;
  const expected = daysBetween(inv.due_date, inv.invoice_date);
  const drift = Math.abs(expected - contract.payment_terms_days);
  if (drift <= DUE_DATE_DRIFT_DAYS) return;
  out.push({
    id: `invoice-reconciler.invoice-due-date-implausible.${inv.id}`,
    code: 'invoice-due-date-implausible',
    severity: 'warn',
    title: `Invoice ${inv.id} due_date drifts from contract terms`,
    detail: `Invoice ${inv.id}: due_date ${inv.due_date} is ${expected} days after invoice_date ${inv.invoice_date}; contract ${contract.id} has ${contract.payment_terms_days}-day terms.`,
    recommended_action: `Fix the due_date in invoices/invoices.csv to invoice_date + ${contract.payment_terms_days} days.`,
    sources: [`invoice:${inv.id}`, `contract:${contract.id}`],
  });
}

function appendPeriodInvalidWarning(
  inv: Invoice,
  out: EntityFoundationWarning[],
): void {
  if (inv.period_end >= inv.period_start) return;
  out.push({
    id: `invoice-reconciler.invoice-period-invalid.${inv.id}`,
    code: 'invoice-period-invalid',
    severity: 'warn',
    title: `Invoice ${inv.id} has period_end before period_start`,
    detail: `Invoice ${inv.id}: period ${inv.period_start} → ${inv.period_end} is reversed or otherwise nonsensical.`,
    recommended_action: `Inspect the invoice row and correct the period_start / period_end pair.`,
    sources: [`invoice:${inv.id}`],
  });
}
