import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InvoicePayment } from '../../../shared/api-contracts.js';
import type { ReconciliationPlan, ReconcileTransaction } from './reconcile-payments.js';

const buildReconciliationPlanMock = vi.fn<(input: unknown) => ReconciliationPlan>();
const recordInvoicePaymentsMock = vi.fn<(input: unknown) => unknown>();
const applyInvoiceStatusAfterPaymentsMock = vi.fn<
  (payments: readonly InvoicePayment[]) => readonly { invoiceId: string; status: 'paid' | 'partial' }[]
>();

vi.mock('./build-reconciliation-plan.js', () => ({
  RECONCILE_LOOKBACK_DAYS: 180,
  buildReconciliationPlan: (input: unknown) => buildReconciliationPlanMock(input),
}));

vi.mock('./mutations.js', () => ({
  recordInvoicePayments: (input: unknown) => recordInvoicePaymentsMock(input),
}));

vi.mock('./auto-reconcile.js', () => ({
  applyInvoiceStatusAfterPayments: (payments: readonly InvoicePayment[]) =>
    applyInvoiceStatusAfterPaymentsMock(payments),
}));

const { reconcileInvoicesPersist, summariseReconciliationPlan } = await import('./reconcile-invoices.js');

const PAYMENT: InvoicePayment = {
  id: 'ip-DC-011-tx-1',
  invoice_id: 'DC-011',
  bank_transaction_id: 'tx-1',
  payment_date: '2026-06-01',
  amount_paid: 13200,
  deposit_currency: 'GBP',
  fx_rate_at_payment: null,
  amount_in_invoice_currency: 13200,
  fx_gain_loss: 0,
  residual: 0,
  created_at: '2026-06-02',
  updated_at: null,
};

const OTHER_PAYMENT: InvoicePayment = {
  ...PAYMENT,
  id: 'ip-DC-010-tx-2',
  invoice_id: 'DC-010',
  bank_transaction_id: 'tx-2',
};

function makePlan(
  proposed: readonly InvoicePayment[],
  unmatchedTransactions: readonly ReconcileTransaction[] = [],
): ReconciliationPlan {
  return {
    proposedPayments: [...proposed],
    paymentConfidence: new Map(proposed.map(p => [p.id, 'reference-exact' as const])),
    referenceCitedIssues: [],
    unmatchedInvoices: [],
    unmatchedTransactions: [...unmatchedTransactions],
    notes: [],
  };
}

beforeEach(() => {
  buildReconciliationPlanMock.mockReset();
  recordInvoicePaymentsMock.mockReset();
  applyInvoiceStatusAfterPaymentsMock.mockReset();
});

describe('summariseReconciliationPlan', () => {
  it('counts scoped payments and unmatched deposits from the plan', () => {
    const plan = makePlan([PAYMENT, OTHER_PAYMENT], [{
      account: 'barclays-current',
      date: '2026-06-01',
      id: 'tx-orphan',
      amount: 50,
      currency: 'GBP',
      description: 'misc',
      entityId: 'autonize-it-ltd',
    }]);
    const summary = summariseReconciliationPlan(plan, [PAYMENT]);
    expect(summary).toEqual({
      matchedCount: 1,
      invoiceIds: ['DC-011'],
      unmatchedDepositCount: 1,
    });
  });
});

describe('reconcileInvoicesPersist', () => {
  it('persists all proposed payments when invoiceId is omitted', () => {
    const plan = makePlan([PAYMENT, OTHER_PAYMENT]);
    buildReconciliationPlanMock.mockReturnValue(plan);
    recordInvoicePaymentsMock.mockReturnValue({
      ok: true,
      payments: [PAYMENT, OTHER_PAYMENT],
    });
    applyInvoiceStatusAfterPaymentsMock.mockReturnValue([
      { invoiceId: 'DC-011', status: 'paid' },
      { invoiceId: 'DC-010', status: 'paid' },
    ]);

    const result = reconcileInvoicesPersist({ now: '2026-06-02' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(recordInvoicePaymentsMock).toHaveBeenCalledWith({
      payments: [PAYMENT, OTHER_PAYMENT],
    });
    expect(result.persisted).toHaveLength(2);
    expect(result.summary.matchedCount).toBe(2);
    expect(result.summary.invoiceIds).toEqual(['DC-011', 'DC-010']);
  });

  it('scopes persistence to a single invoice when invoiceId is set', () => {
    const plan = makePlan([PAYMENT, OTHER_PAYMENT]);
    buildReconciliationPlanMock.mockReturnValue(plan);
    recordInvoicePaymentsMock.mockReturnValue({
      ok: true,
      payments: [PAYMENT],
    });
    applyInvoiceStatusAfterPaymentsMock.mockReturnValue([
      { invoiceId: 'DC-011', status: 'paid' },
    ]);

    const result = reconcileInvoicesPersist({ invoiceId: 'DC-011', now: '2026-06-02' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(recordInvoicePaymentsMock).toHaveBeenCalledWith({ payments: [PAYMENT] });
    expect(result.summary.invoiceIds).toEqual(['DC-011']);
  });

  it('returns the plan and failure when persistence rejects a duplicate bank tx', () => {
    const plan = makePlan([PAYMENT]);
    buildReconciliationPlanMock.mockReturnValue(plan);
    recordInvoicePaymentsMock.mockReturnValue({
      ok: false,
      code: 'duplicate-bank-tx',
      bankTransactionId: 'tx-1',
    });

    const result = reconcileInvoicesPersist({ invoiceId: 'DC-011', now: '2026-06-02' });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.code).toBe('duplicate-bank-tx');
    expect(applyInvoiceStatusAfterPaymentsMock).not.toHaveBeenCalled();
  });
});
