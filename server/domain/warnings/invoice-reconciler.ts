/**
 * Invoice reconciler warnings (§1.3 Phase 4).
 *
 * Two pure derivations sit here:
 *
 *   1. {@link deriveInvoiceRowWarnings} — invoice-row-only checks that
 *      don't need a match plan: stale `payment_reference`, overdue
 *      issued/partial invoices, nonsensical `period_*`.
 *   2. {@link deriveUnmatchedDepositWarnings} — surfaces deposits the
 *      reconciler could not pair, including precise reference-cited
 *      mismatches from {@link ReconciliationPlan.referenceCitedIssues}.
 *
 * Both reuse the existing `EntityFoundationWarning` envelope so the
 * Warnings tab consumes them via the same `/api/warnings/entity-foundation`
 * endpoint without a new schema or route. Pure w.r.t. inputs — the
 * route layer or a thin caller hands in invoices, contracts, and the
 * plan; this module never touches the DB or the registry.
 */

import type {
  AccountName,
  EntityFoundationWarning,
  EntityId,
  Invoice,
} from '../../../shared/api-contracts.js';
import { daysBetween } from '../../../shared/iso-date.js';
import { vatApplicableAccounts } from '../accounts/queries.js';
import type { ReconciliationPlan } from '../invoices/reconcile-payments.js';

export interface DeriveInvoiceRowWarningsInput {
  readonly invoices: readonly Invoice[];
  readonly todayIso: string;
}

export function deriveInvoiceRowWarnings(
  input: DeriveInvoiceRowWarningsInput,
): readonly EntityFoundationWarning[] {
  const out: EntityFoundationWarning[] = [];
  for (const inv of input.invoices) {
    appendStalePaymentReferenceWarning(inv, out);
    appendInvoiceOverdueWarning(inv, input.todayIso, out);
    appendPeriodInvalidWarning(inv, out);
  }
  return out;
}

export interface DeriveUnmatchedDepositWarningsInput {
  readonly plan: ReconciliationPlan;
  /**
   * When set, only deposits on VAT-applicable accounts for this entity are
   * surfaced (reduces noise from non-VAT business accounts).
   */
  readonly entityId?: EntityId;
}

function vatApplicableAccountSet(entityId?: EntityId): ReadonlySet<AccountName> {
  const accounts = entityId === undefined
    ? vatApplicableAccounts()
    : vatApplicableAccounts({ entityId });
  return new Set(accounts);
}

function appendReferenceCitedWarning(
  issue: ReconciliationPlan['referenceCitedIssues'][number],
  out: EntityFoundationWarning[],
): void {
  const tx = issue.transaction;
  const code =
    issue.code === 'reference-ambiguous'
      ? 'invoice-reference-ambiguous'
      : 'invoice-reference-amount-mismatch';
  const title =
    issue.code === 'reference-ambiguous'
      ? `Deposit on ${tx.date} cites ambiguous invoice references`
      : `Deposit on ${tx.date} cites invoices but amount does not reconcile`;

  out.push({
    id: `invoice-reconciler.${code}.${tx.account}.${tx.date}.${tx.id}`,
    code,
    severity: 'warn',
    entityId: tx.entityId,
    title,
    detail: `${tx.currency} ${tx.amount.toFixed(2)} in ${tx.account} on ${tx.date} ("${tx.description}"): ${issue.detail}`,
    recommended_action:
      issue.code === 'reference-ambiguous'
        ? 'Inspect the bank narrative and invoice payment_reference values; reconcile manually or correct ambiguous references in invoices.csv.'
        : 'Confirm which invoices this batch payment settles and record payments manually, or correct invoice totals / references.',
    sources: [
      `transaction:${tx.account}:${tx.date}:${tx.id}`,
      `entity:${tx.entityId}`,
      ...issue.citedInvoiceIds.map(id => `invoice:${id}`),
    ],
    context: {
      entityId: tx.entityId,
      account: tx.account,
      depositDate: tx.date,
      amount: tx.amount,
      currency: tx.currency,
      transactionId: tx.id,
      citedInvoiceIds: issue.citedInvoiceIds.join(','),
    },
  });
}

export function deriveUnmatchedDepositWarnings(
  input: DeriveUnmatchedDepositWarningsInput,
): readonly EntityFoundationWarning[] {
  const vatAccounts = vatApplicableAccountSet(input.entityId);
  const scopeToVat = input.entityId !== undefined;

  const out: EntityFoundationWarning[] = [];
  const preciselyWarnedTxIds = new Set<string>();

  for (const issue of input.plan.referenceCitedIssues) {
    const tx = issue.transaction;
    if (tx.amount <= 0) continue;
    if (scopeToVat && !vatAccounts.has(tx.account as AccountName)) continue;
    if (input.entityId !== undefined && tx.entityId !== input.entityId) continue;
    appendReferenceCitedWarning(issue, out);
    preciselyWarnedTxIds.add(tx.id);
  }

  for (const tx of input.plan.unmatchedTransactions) {
    if (tx.amount <= 0) continue;
    if (scopeToVat && !vatAccounts.has(tx.account as AccountName)) continue;
    if (input.entityId !== undefined && tx.entityId !== input.entityId) continue;
    if (preciselyWarnedTxIds.has(tx.id)) continue;

    out.push({
      id: `invoice-reconciler.invoice-unmatched-deposit.${tx.account}.${tx.date}.${tx.id}`,
      code: 'invoice-unmatched-deposit',
      severity: 'warn',
      entityId: tx.entityId,
      title: `Deposit on ${tx.date} did not match any invoice`,
      detail: `${tx.currency} ${tx.amount.toFixed(2)} arrived in ${tx.account} on ${tx.date} ("${tx.description}") but the reconciler could not pair it with any issued invoice for ${tx.entityId}.`,
      recommended_action:
        `Check whether the deposit settles a missing invoice (issue one if so) or belongs to a non-invoice income source; otherwise widen the matcher tolerances.`,
      sources: [
        `transaction:${tx.account}:${tx.date}:${tx.id}`,
        `entity:${tx.entityId}`,
      ],
      context: {
        entityId: tx.entityId,
        account: tx.account,
        depositDate: tx.date,
        amount: tx.amount,
        currency: tx.currency,
        transactionId: tx.id,
      },
    });
  }
  return out;
}

// ─── Row-only checks ────────────────────────────────────────────────────────

function appendStalePaymentReferenceWarning(
  inv: Invoice,
  out: EntityFoundationWarning[],
): void {
  if (inv.mechanism === 'self-bill') return;
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

function appendInvoiceOverdueWarning(
  inv: Invoice,
  todayIso: string,
  out: EntityFoundationWarning[],
): void {
  if (inv.status !== 'issued' && inv.status !== 'partial') return;
  if (inv.due_date >= todayIso) return;
  const daysOverdue = daysBetween(todayIso, inv.due_date);
  out.push({
    id: `invoice-reconciler.invoice-overdue.${inv.id}`,
    code: 'invoice-overdue',
    severity: 'warn',
    entityId: inv.issuing_entity_id,
    title: `Invoice ${inv.id} is overdue`,
    detail: `Invoice ${inv.id} (${inv.invoice_number}) was due ${inv.due_date} and is ${daysOverdue} ${daysOverdue === 1 ? 'day' : 'days'} overdue (${inv.currency} ${inv.total.toFixed(2)} outstanding).`,
    recommended_action:
      'Chase payment from the client or reconcile a bank deposit against this invoice.',
    sources: [`invoice:${inv.id}`],
    context: {
      invoiceId: inv.id,
      dueDate: inv.due_date,
      daysOverdue,
      total: inv.total,
      currency: inv.currency,
    },
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
