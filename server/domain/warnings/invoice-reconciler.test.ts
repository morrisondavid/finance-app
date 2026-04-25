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
import type {
  Contract,
  Invoice,
} from '../../../shared/api-contracts.js';
import { parseContractRow } from '../contracts/csv-io.js';
import { dcSowRow } from '../contracts/test-helpers.js';
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

const dcContract: Contract = parseContractRow(dcSowRow);
const contractsById = new Map<string, Contract>([[dcContract.id, dcContract]]);

function makeInvoice(overrides: Partial<Invoice>): Invoice {
  return { ...parseInvoiceRow(dcInvoice001), ...overrides };
}

describe('deriveInvoiceRowWarnings', () => {
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
      contractsById,
    });

    expect(warnings.map(w => w.code)).toContain('invoice-stale-payment-reference');
    const stale = warnings.find(w => w.code === 'invoice-stale-payment-reference');
    expect(stale?.detail).toContain('DC-005');
    expect(stale?.detail).toContain('DC-004');
  });

  it('flags due_date implausibility when due precedes invoice_date', () => {
    const inv = makeInvoice({
      id: 'DC-006',
      invoice_number: 'DC-006',
      payment_reference: 'DC-006',
      invoice_date: '2025-12-05',
      due_date: '2025-01-05',
      contract_id: 'dc-sow-2026',
    });

    const warnings = deriveInvoiceRowWarnings({
      invoices: [inv],
      contractsById,
    });

    expect(warnings.map(w => w.code)).toContain('invoice-due-date-implausible');
  });

  it('flags due_date drift beyond the contract terms tolerance', () => {
    const inv = makeInvoice({
      id: 'DC-010',
      invoice_number: 'DC-010',
      payment_reference: 'DC-010',
      invoice_date: '2026-04-01',
      due_date: '2031-05-01',
      contract_id: 'dc-sow-2026',
    });

    const warnings = deriveInvoiceRowWarnings({
      invoices: [inv],
      contractsById,
    });

    expect(warnings.map(w => w.code)).toContain('invoice-due-date-implausible');
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
      contractsById,
    });

    expect(warnings.map(w => w.code)).toContain('invoice-period-invalid');
  });

  it('emits no warnings on a clean invoice row', () => {
    const inv = makeInvoice({});
    const warnings = deriveInvoiceRowWarnings({
      invoices: [inv],
      contractsById,
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
    const plan: ReconciliationPlan = {
      proposedPayments: [],
      unmatchedInvoices: [],
      unmatchedTransactions: [tx],
      notes: [],
    };

    const warnings = deriveUnmatchedDepositWarnings({ plan });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('invoice-unmatched-deposit');
    expect(warnings[0].detail).toContain('barclays-current');
    expect(warnings[0].sources.some(s => s.startsWith('transaction:'))).toBe(true);
  });

  it('emits no warnings when the plan has no leftovers', () => {
    const plan: ReconciliationPlan = {
      proposedPayments: [],
      unmatchedInvoices: [],
      unmatchedTransactions: [],
      notes: [],
    };
    expect(deriveUnmatchedDepositWarnings({ plan })).toEqual([]);
  });
});
