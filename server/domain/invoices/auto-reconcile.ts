/**
 * Auto-persist high-confidence reference-anchored reconciliation matches.
 */

import type { EntityId, InvoicePayment } from '../../../shared/api-contracts.js';
import { todayIsoLocal, shiftIsoDate } from '../../../shared/iso-date.js';
import {
  buildReconciliationPlan,
  RECONCILE_LOOKBACK_DAYS,
  type BuildReconciliationPlanInput,
} from './build-reconciliation-plan.js';
import { recordInvoicePayments, updateInvoice } from './mutations.js';
import { buildInvoiceRegistry, getInvoiceRegistry } from './registry.js';
import type {
  MatchConfidence,
  ReconciliationPlan,
} from './reconcile-payments.js';

export interface AutoReconcileHighConfidenceInput {
  readonly entityId?: EntityId;
  readonly windowStart?: string;
  readonly windowEnd?: string;
  readonly now?: string;
}

export interface AutoReconcileHighConfidenceResult {
  readonly plan: ReconciliationPlan;
  readonly persisted: readonly InvoicePayment[];
  readonly statusUpdates: readonly { readonly invoiceId: string; readonly status: 'paid' | 'partial' }[];
}

function paymentsWithConfidence(
  plan: ReconciliationPlan,
  confidence: MatchConfidence,
): readonly InvoicePayment[] {
  return plan.proposedPayments.filter(
    payment => plan.paymentConfidence.get(payment.id) === confidence,
  );
}

export function applyInvoiceStatusAfterPayments(
  payments: readonly InvoicePayment[],
  invoicesDir?: string,
): readonly { invoiceId: string; status: 'paid' | 'partial' }[] {
  const registry = invoicesDir === undefined
    ? getInvoiceRegistry()
    : buildInvoiceRegistry(invoicesDir);
  const updates: { invoiceId: string; status: 'paid' | 'partial' }[] = [];
  for (const payment of payments) {
    const invoice = registry.indexes.byId.get(payment.invoice_id);
    if (invoice === undefined) continue;
    const nextStatus = payment.residual <= 0.01 ? 'paid' : 'partial';
    if (invoice.status === nextStatus) continue;
    updateInvoice({
      invoiceId: invoice.id,
      patch: { status: nextStatus },
      invoicesDir,
    });
    updates.push({ invoiceId: invoice.id, status: nextStatus });
  }
  return updates;
}

export function autoReconcileHighConfidence(
  input: AutoReconcileHighConfidenceInput = {},
): AutoReconcileHighConfidenceResult {
  const today = input.now ?? todayIsoLocal();
  const planInput: BuildReconciliationPlanInput = {
    entityId: input.entityId,
    windowStart: input.windowStart ?? shiftIsoDate(today, -RECONCILE_LOOKBACK_DAYS),
    windowEnd: input.windowEnd ?? today,
    now: today,
  };

  const plan = buildReconciliationPlan(planInput);
  const toPersist = paymentsWithConfidence(plan, 'reference-exact');

  if (toPersist.length === 0) {
    return { plan, persisted: [], statusUpdates: [] };
  }

  const result = recordInvoicePayments({ payments: toPersist });
  if (!result.ok) {
    throw new Error(`autoReconcileHighConfidence: persist failed (${result.code})`);
  }

  const statusUpdates = applyInvoiceStatusAfterPayments(result.payments);
  return { plan, persisted: result.payments, statusUpdates };
}
