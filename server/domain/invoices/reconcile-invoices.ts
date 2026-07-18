/**
 * One-shot "self-heal" reconcile: build a plan over the standard
 * look-back window, optionally scope to a single invoice, persist the
 * proposed payments, and flip invoice statuses.
 *
 * Shared by POST `/api/invoices/reconcile` (persist modes), the MCP
 * `invoices_reconcile` tool, and post-issue hooks so every caller gets
 * the same window, persistence, and summary semantics.
 */

import type { EntityId, InvoicePayment } from '../../../shared/api-contracts.js';
import { shiftIsoDate, todayIsoLocal } from '../../../shared/iso-date.js';
import {
  applyInvoiceStatusAfterPayments,
} from './auto-reconcile.js';
import {
  buildReconciliationPlan,
  RECONCILE_LOOKBACK_DAYS,
} from './build-reconciliation-plan.js';
import { recordInvoicePayments, type RecordInvoicePaymentsResult } from './mutations.js';
import type { ReconciliationPlan } from './reconcile-payments.js';

/** Compact result block for UI banners and MCP agents. */
export interface ReconcileSummary {
  /** Payment rows in scope (proposed on dry-run, persisted on persist). */
  readonly matchedCount: number;
  /** Distinct invoice ids those payments settle. */
  readonly invoiceIds: readonly string[];
  /** Income deposits the matcher could not pair with any invoice. */
  readonly unmatchedDepositCount: number;
}

/** Derive the summary from a plan plus the payments actually in scope. */
export function summariseReconciliationPlan(
  plan: ReconciliationPlan,
  payments: readonly InvoicePayment[],
): ReconcileSummary {
  return {
    matchedCount: payments.length,
    invoiceIds: [...new Set(payments.map(p => p.invoice_id))],
    unmatchedDepositCount: plan.unmatchedTransactions.length,
  };
}

export interface ReconcileInvoicesPersistInput {
  /** Optional scope to one issuing entity (Ltd vs FZCO). */
  readonly entityId?: EntityId;
  /** Optional scope: persist only payments settling this invoice. */
  readonly invoiceId?: string;
  /** Clock override for tests. Defaults to `todayIsoLocal()`. */
  readonly now?: string;
}

export type ReconcileInvoicesPersistResult =
  | {
      readonly ok: true;
      readonly plan: ReconciliationPlan;
      readonly persisted: readonly InvoicePayment[];
      readonly statusUpdates: readonly { readonly invoiceId: string; readonly status: 'paid' | 'partial' }[];
      readonly summary: ReconcileSummary;
    }
  | {
      readonly ok: false;
      readonly plan: ReconciliationPlan;
      readonly failure: Exclude<RecordInvoicePaymentsResult, { ok: true }>;
    };

/**
 * Build a reconciliation plan over the standard `RECONCILE_LOOKBACK_DAYS`
 * window and persist the proposed payments (all of them, or just those
 * for `invoiceId` when given).
 */
export function reconcileInvoicesPersist(
  input: ReconcileInvoicesPersistInput = {},
): ReconcileInvoicesPersistResult {
  const today = input.now ?? todayIsoLocal();
  const plan = buildReconciliationPlan({
    entityId: input.entityId,
    windowStart: shiftIsoDate(today, -RECONCILE_LOOKBACK_DAYS),
    windowEnd: today,
    now: today,
  });

  const toPersist =
    input.invoiceId === undefined
      ? plan.proposedPayments
      : plan.proposedPayments.filter(p => p.invoice_id === input.invoiceId);

  const result = recordInvoicePayments({ payments: toPersist });
  if (!result.ok) {
    return { ok: false, plan, failure: result };
  }

  const statusUpdates = applyInvoiceStatusAfterPayments(result.payments);
  return {
    ok: true,
    plan,
    persisted: result.payments,
    statusUpdates,
    summary: summariseReconciliationPlan(plan, result.payments),
  };
}
