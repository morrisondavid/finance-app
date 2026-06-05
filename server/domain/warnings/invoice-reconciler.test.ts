/**
 * Unit tests for the invoice reconciler warnings.
 *
 * Two derivations:
 *   - {@link deriveInvoiceRowWarnings} — invoice-row-only checks
 *     against hand-built bad rows.
 *   - {@link deriveUnmatchedDepositWarnings} — fed a synthetic
 *     {@link ReconciliationPlan} so the test stays decoupled from the
 *     pure matcher's internal scoring.
 */

import { describe, it, expect } from 'vitest';
import type { Invoice } from '../../../shared/api-contracts.js';
import { parseInvoiceRow } from '../invoices/csv-io.js';
import { dcInvoice001 } from '../invoices/test-helpers.js';
import type {
  ReconcileTransaction,
  ReconciliationPlan,
} from '../invoices/reconcile-payments.js';
import {
  deriveInvoiceRowWarnings,
  deriveUnmatchedDepositWarnings,
} from './invoice-reconciler.js';

const TODAY = '2026-06-06';

function emptyPlan(
  overrides: Partial<ReconciliationPlan> = {},
): ReconciliationPlan {
  return {
    proposedPayments: [],
    paymentConfidence: new Map(),
    referenceCitedIssues: [],
    unmatchedInvoices: [],
    unmatchedTransactions: [],
    notes: [],
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<Invoice>): Invoice {
  return { ...parseInvoiceRow(dcInvoice001), ...overrides };
}

describe('deriveInvoiceRowWarnings', () => {
  it('does not flag self-bill rows when payment_reference is the supplier SB number', () => {
    const inv = makeInvoice({
      id: 'EG-0001',
      invoice_number: 'EG-0001',
      payment_reference: 'SB-250016',
      mechanism: 'self-bill',
      client_id: 'la-fosse',
      contract_id: 'lf-bh25537',
    });

    const warnings = deriveInvoiceRowWarnings({
      invoices: [inv],
      todayIso: TODAY,
    });

    expect(warnings.map(w => w.code)).not.toContain('invoice-stale-payment-reference');
  });

  it('flags stale payment_reference when it differs from invoice_number', () => {
    const inv = makeInvoice({
      id: 'DC-005',
      invoice_number: 'DC-005',
      payment_reference: 'DC-004',
      due_date: '2026-04-30',
      invoice_date: '2026-03-31',
      contract_id: 'dc-sow-2026',
    });

    const warnings = deriveInvoiceRowWarnings({
      invoices: [inv],
      todayIso: TODAY,
    });

    expect(warnings.map(w => w.code)).toContain('invoice-stale-payment-reference');
    const stale = warnings.find(w => w.code === 'invoice-stale-payment-reference');
    expect(stale?.detail).toContain('DC-005');
    expect(stale?.detail).toContain('DC-004');
  });

  it('flags issued invoices past due_date as overdue', () => {
    const inv = makeInvoice({
      id: 'DC-010',
      invoice_number: 'DC-010',
      payment_reference: 'DC-010',
      status: 'issued',
      invoice_date: '2026-04-01',
      due_date: '2026-05-01',
      contract_id: 'dc-sow-2026',
    });

    const warnings = deriveInvoiceRowWarnings({
      invoices: [inv],
      todayIso: TODAY,
    });

    expect(warnings.map(w => w.code)).toContain('invoice-overdue');
    const overdue = warnings.find(w => w.code === 'invoice-overdue');
    expect(overdue?.detail).toContain('36 days overdue');
  });

  it('does not flag paid invoices even when due_date is in the past', () => {
    const inv = makeInvoice({
      id: 'DC-003',
      invoice_number: 'DC-003',
      payment_reference: 'DC-003',
      status: 'paid',
      invoice_date: '2025-09-24',
      due_date: '2025-10-01',
      contract_id: 'dc-sow-2025-jun',
    });

    const warnings = deriveInvoiceRowWarnings({
      invoices: [inv],
      todayIso: TODAY,
    });

    expect(warnings.map(w => w.code)).not.toContain('invoice-overdue');
  });

  it('does not flag issued invoices that are not yet due', () => {
    const inv = makeInvoice({
      id: 'DC-011',
      invoice_number: 'DC-011',
      payment_reference: 'DC-011',
      status: 'issued',
      invoice_date: '2026-06-01',
      due_date: '2026-07-01',
      contract_id: 'dc-sow-jun-2026',
    });

    const warnings = deriveInvoiceRowWarnings({
      invoices: [inv],
      todayIso: TODAY,
    });

    expect(warnings.map(w => w.code)).not.toContain('invoice-overdue');
  });

  it('flags period_end before period_start', () => {
    const inv = makeInvoice({
      id: 'DC-008',
      invoice_number: 'DC-008',
      payment_reference: 'DC-008',
      period_start: '2026-01-05',
      period_end: '2025-12-30',
      invoice_date: '2026-02-08',
      due_date: '2026-03-10',
      contract_id: 'dc-sow-2026',
    });

    const warnings = deriveInvoiceRowWarnings({
      invoices: [inv],
      todayIso: TODAY,
    });

    expect(warnings.map(w => w.code)).toContain('invoice-period-invalid');
  });

  it('emits no warnings on a clean invoice row', () => {
    const inv = makeInvoice({});
    const warnings = deriveInvoiceRowWarnings({
      invoices: [inv],
      todayIso: TODAY,
    });
    expect(warnings).toEqual([]);
  });
});

describe('deriveUnmatchedDepositWarnings', () => {
  it('emits one warning per unmatched transaction in the plan', () => {
    const tx: ReconcileTransaction = {
      id: 'tx-99',
      date: '2026-04-15',
      amount: 13200,
      currency: 'GBP',
      account: 'barclays-current',
      description: 'DELTA CAPITA - INVOICE PAYMENT',
      entityId: 'autonize-it-ltd',
    };
    const warnings = deriveUnmatchedDepositWarnings({
      plan: emptyPlan({ unmatchedTransactions: [tx] }),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('invoice-unmatched-deposit');
    expect(warnings[0].detail).toContain('barclays-current');
    expect(warnings[0].sources.some(s => s.startsWith('transaction:'))).toBe(true);
  });

  it('emits no warnings when the plan has no leftovers', () => {
    expect(deriveUnmatchedDepositWarnings({ plan: emptyPlan() })).toEqual([]);
  });

  it('skips non-positive amounts and non-VAT-applicable accounts when entity scoped', () => {
    const warnings = deriveUnmatchedDepositWarnings({
      plan: emptyPlan({
        unmatchedTransactions: [
          {
            id: 'tx-refund',
            date: '2026-04-07',
            amount: -50,
            currency: 'GBP',
            account: 'barclays-current',
            description: 'REFUND',
            entityId: 'autonize-it-ltd',
          },
          {
            id: 'tx-savings',
            date: '2026-04-08',
            amount: 500,
            currency: 'GBP',
            account: 'barclays-savings',
            description: 'TRANSFER IN',
            entityId: 'autonize-it-ltd',
          },
          {
            id: 'tx-vat',
            date: '2026-04-15',
            amount: 13200,
            currency: 'GBP',
            account: 'barclays-current',
            description: 'DELTA CAPITA',
            entityId: 'autonize-it-ltd',
          },
        ],
      }),
      entityId: 'autonize-it-ltd',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('invoice-unmatched-deposit');
    expect(warnings[0].entityId).toBe('autonize-it-ltd');
    expect(warnings[0].context?.amount).toBe(13200);
    expect(warnings[0].context?.account).toBe('barclays-current');
  });

  it('emits a precise reference-amount-mismatch warning instead of generic unmatched', () => {
    const tx: ReconcileTransaction = {
      id: 'tx-mismatch',
      date: '2025-12-24',
      amount: 5000,
      currency: 'GBP',
      account: 'barclays-current',
      description: 'LA FOSSE LTD SB-280052',
      entityId: 'autonize-it-ltd',
    };

    const warnings = deriveUnmatchedDepositWarnings({
      plan: emptyPlan({
        unmatchedTransactions: [tx],
        referenceCitedIssues: [{
          transaction: tx,
          code: 'reference-amount-mismatch',
          citedInvoiceIds: ['EG-0038'],
          detail: 'Deposit cites SB-280052 but residual sum 1800.00 does not match deposit 5000.00.',
        }],
      }),
      entityId: 'autonize-it-ltd',
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('invoice-reference-amount-mismatch');
    expect(warnings[0].detail).toContain('SB-280052');
    expect(warnings[0].sources).toContain('invoice:EG-0038');
  });
});
