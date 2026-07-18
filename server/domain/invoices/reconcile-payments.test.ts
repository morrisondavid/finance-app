/**
 * Unit tests for the pure invoice ↔ deposit matcher.
 *
 * Every input is a plain object — the matcher is DB-free + clock-free,
 * so these tests directly assert plan shapes against fixed `today`
 * values and known invoice/transaction inputs.
 */

import { describe, it, expect } from 'vitest';

import type {
  Client,
  ClientId,
  InvoicePayment,
} from '../../../shared/api-contracts.js';
import { parseClientRow } from '../clients/csv-io.js';
import {
  directRow as directClientRow,
  agencyRow as agencyClientRow,
} from '../clients/test-helpers.js';
import { parseInvoiceRow } from './csv-io.js';
import {
  dcInvoice001,
  dcInvoice002,
  fzcoInvoice001,
  rowFromHeaders,
} from './test-helpers.js';
import { laFosseDepositAmountForMatch } from './la-fosse-reconcile-accounts.js';
import {
  planReconciliation,
  type ReconcileTransaction,
} from './reconcile-payments.js';

const TODAY = '2026-04-25';

function clientsByIdFromRows(...rows: readonly Record<string, string>[]): ReadonlyMap<ClientId, Client> {
  const map = new Map<ClientId, Client>();
  for (const r of rows) {
    const c = parseClientRow(r);
    map.set(c.id, c);
  }
  return map;
}

const dcClientsById = clientsByIdFromRows(directClientRow);
const laFosseClientsById = clientsByIdFromRows(agencyClientRow);

function laFosseEgInvoice(
  id: string,
  paymentReference: string,
  total: string,
  periodStart: string,
): ReturnType<typeof parseInvoiceRow> {
  const totalNum = Number(total);
  const subtotal = totalNum / 1.2;
  const vat = totalNum - subtotal;
  return parseInvoiceRow(
    rowFromHeaders({
      id,
      contract_id: 'lf-bh28240',
      client_id: 'la-fosse',
      issuing_entity_id: 'autonize-it-ltd',
      invoice_number: id,
      payment_reference: paymentReference,
      invoice_date: '2025-11-26',
      period_start: periodStart,
      period_end: periodStart,
      days_billed: '3',
      description: 'David Morrison - Consultant Services, Full Stack Engineer',
      currency: 'GBP',
      subtotal: String(subtotal),
      vat_rate: '0.2',
      vat_amount: String(vat),
      total,
      mechanism: 'self-bill',
      status: 'issued',
      due_date: '2025-12-26',
      created_at: '2025-11-26',
      updated_at: '2025-11-26',
    }),
  );
}

function laFosseFzInvoice(
  id: string,
  paymentReference: string,
  total: string,
  periodStart: string,
  status: 'issued' | 'paid' = 'issued',
): ReturnType<typeof parseInvoiceRow> {
  return parseInvoiceRow(
    rowFromHeaders({
      id,
      contract_id: 'lf-2026-may',
      client_id: 'la-fosse',
      issuing_entity_id: 'autonize-it-fzco',
      invoice_number: id,
      payment_reference: paymentReference,
      invoice_date: '2026-05-28',
      period_start: periodStart,
      period_end: periodStart,
      days_billed: '4',
      description: 'David Morrison - Consultant Services, Full Stack Engineer',
      currency: 'GBP',
      subtotal: total,
      vat_rate: '0',
      vat_amount: '0',
      total,
      mechanism: 'self-bill',
      status,
      due_date: '2026-06-27',
      created_at: '2026-06-02',
      updated_at: '2026-06-02',
    }),
  );
}

function tx(overrides: Partial<ReconcileTransaction>): ReconcileTransaction {
  return {
    id: 'tx-default',
    date: '2025-08-09',
    amount: 3960,
    currency: 'GBP',
    account: 'barclays-current',
    description: 'DELTA CAPITA — INVOICE PAYMENT',
    entityId: 'autonize-it-ltd',
    ...overrides,
  };
}

describe('planReconciliation — same-currency happy path', () => {
  it('matches a single deposit to a single invoice on the due date', () => {
    const invoice = parseInvoiceRow(dcInvoice001);
    const deposit = tx({ id: 'tx-1', date: '2025-08-09', amount: 3960 });

    const plan = planReconciliation({
      invoices: [invoice],
      transactions: [deposit],
      clientsById: dcClientsById,
      existingPayments: [],
      options: { now: TODAY },
    });

    expect(plan.proposedPayments).toHaveLength(1);
    const payment = plan.proposedPayments[0];
    expect(payment.invoice_id).toBe('DC-001');
    expect(payment.bank_transaction_id).toBe('tx-1');
    expect(payment.payment_date).toBe('2025-08-09');
    expect(payment.amount_paid).toBe(3960);
    expect(payment.deposit_currency).toBe('GBP');
    expect(payment.fx_rate_at_payment).toBeNull();
    expect(payment.amount_in_invoice_currency).toBe(3960);
    expect(payment.fx_gain_loss).toBe(0);
    expect(payment.residual).toBe(0);
    expect(payment.created_at).toBe(TODAY);
    expect(plan.unmatchedInvoices).toHaveLength(0);
    expect(plan.unmatchedTransactions).toHaveLength(0);
  });

  it('breaks ties between two equal-amount invoices using payment date proximity then narrative', () => {
    const dc1 = parseInvoiceRow(dcInvoice001);
    const dc2 = parseInvoiceRow({
      ...dcInvoice001,
      id: 'DC-100',
      payment_reference: 'DC-100',
      invoice_number: 'DC-100',
      due_date: '2025-08-15',
    });

    const t = tx({ id: 'tx-1', date: '2025-08-15', amount: 3960 });

    const plan = planReconciliation({
      invoices: [dc1, dc2],
      transactions: [t],
      clientsById: dcClientsById,
      existingPayments: [],
      options: { now: TODAY },
    });

    expect(plan.proposedPayments).toHaveLength(1);
    expect(plan.proposedPayments[0].invoice_id).toBe('DC-100');
    expect(plan.unmatchedInvoices.map(i => i.id)).toEqual(['DC-001']);
  });

  it('does not double-claim a transaction already linked to an existing payment', () => {
    const invoice = parseInvoiceRow(dcInvoice001);
    const deposit = tx({ id: 'tx-1' });
    const existing: InvoicePayment = {
      id: 'ip-DC-001-tx-1',
      invoice_id: 'DC-001',
      bank_transaction_id: 'tx-1',
      payment_date: '2025-08-09',
      amount_paid: 3960,
      deposit_currency: 'GBP',
      fx_rate_at_payment: null,
      amount_in_invoice_currency: 3960,
      fx_gain_loss: 0,
      residual: 0,
      created_at: TODAY,
      updated_at: null,
    };

    const plan = planReconciliation({
      invoices: [invoice],
      transactions: [deposit],
      clientsById: dcClientsById,
      existingPayments: [existing],
      options: { now: TODAY },
    });

    expect(plan.proposedPayments).toHaveLength(0);
    expect(plan.unmatchedInvoices).toHaveLength(0);
    expect(plan.unmatchedTransactions).toHaveLength(0);
  });

  it('excludes settled bank txs from unmatchedTransactions when invoices are out of scope', () => {
    const settledDeposit = tx({
      id: '211',
      date: '2025-12-24',
      amount: 7800,
      description: 'LA FOSSE LTD SB-280052 SB-28005 BG',
    });
    const existing: InvoicePayment = {
      id: 'ip-EG-0038-211',
      invoice_id: 'EG-0038',
      bank_transaction_id: '211',
      payment_date: '2025-12-24',
      amount_paid: 1800,
      deposit_currency: 'GBP',
      fx_rate_at_payment: null,
      amount_in_invoice_currency: 1800,
      fx_gain_loss: 0,
      residual: 0,
      created_at: TODAY,
      updated_at: null,
    };

    const plan = planReconciliation({
      invoices: [],
      transactions: [settledDeposit],
      clientsById: laFosseClientsById,
      existingPayments: [existing],
      options: { now: TODAY },
    });

    expect(plan.proposedPayments).toHaveLength(0);
    expect(plan.unmatchedTransactions).toHaveLength(0);
  });

  it('excludes positive REFUND narratives from unmatchedTransactions', () => {
    const refundDeposit = tx({
      id: 'tx-refund',
      date: '2026-03-09',
      amount: 48.3,
      description: 'EMIRATES 000220634 ON 07 MAR REFUND',
    });

    const plan = planReconciliation({
      invoices: [],
      transactions: [refundDeposit],
      clientsById: dcClientsById,
      existingPayments: [],
      options: { now: TODAY },
    });

    expect(plan.proposedPayments).toHaveLength(0);
    expect(plan.unmatchedTransactions).toHaveLength(0);
  });

  it('ignores non-client deposits (e.g. Airbnb rental payouts) for invoice matching', () => {
    const airbnbDeposit = tx({
      id: 'tx-airbnb',
      date: '2026-05-05',
      amount: 98.07,
      description: 'AIRBNB * HMRCH3NEK ON 03 MAY BDC',
    });

    const plan = planReconciliation({
      invoices: [],
      transactions: [airbnbDeposit],
      clientsById: dcClientsById,
      existingPayments: [],
      options: { now: TODAY },
    });

    expect(plan.proposedPayments).toHaveLength(0);
    expect(plan.unmatchedTransactions).toHaveLength(0);
  });

  it('ignores interest and other non-client credits without unmatched-deposit noise', () => {
    const interest = tx({
      id: 'tx-interest',
      date: '2026-05-01',
      amount: 12.34,
      description: 'INTEREST PAID GROSS',
    });

    const plan = planReconciliation({
      invoices: [parseInvoiceRow(dcInvoice001)],
      transactions: [interest],
      clientsById: dcClientsById,
      existingPayments: [],
      options: { now: TODAY },
    });

    expect(plan.proposedPayments).toHaveLength(0);
    expect(plan.unmatchedTransactions).toHaveLength(0);
  });

  it('pairs a Delta Capita TFR deposit to a paid invoice when narrative names the payer', () => {
    const invoice = parseInvoiceRow(rowFromHeaders({
      ...dcInvoice002,
      id: 'DC-009',
      invoice_number: 'DC-009',
      payment_reference: 'DC-009',
      contract_id: 'dc-sow-2026',
      invoice_date: '2026-03-01',
      period_start: '2026-02-01',
      period_end: '2026-02-28',
      days_billed: '20',
      subtotal: '11000',
      vat_amount: '2200',
      total: '13200',
      due_date: '2026-04-01',
      created_at: '2026-03-01',
      updated_at: '2026-03-01',
      status: 'paid',
    }));
    const deposit = tx({
      id: 'c7ea7307288f56eb60e093353802cc44',
      date: '2026-04-01',
      amount: 13200,
      description: 'DELTA CAPITA LIM *    \tTFR',
    });

    const plan = planReconciliation({
      invoices: [invoice],
      transactions: [deposit],
      clientsById: dcClientsById,
      existingPayments: [],
      options: { now: '2026-04-25' },
    });

    expect(plan.proposedPayments).toHaveLength(1);
    expect(plan.proposedPayments[0]?.invoice_id).toBe('DC-009');
    expect(plan.proposedPayments[0]?.bank_transaction_id).toBe(deposit.id);
    expect(plan.unmatchedTransactions).toHaveLength(0);
  });

  it('excludes duplicate Barclays remittance leg when sibling is already settled', () => {
    const settledTfr = tx({
      id: 'hash-tfr-settled',
      date: '2026-02-18',
      amount: 6000,
      description: 'LA FOSSE LTD SB-285350 SB-28535 TFR',
    });
    const duplicateBg = tx({
      id: 'hash-bg-duplicate',
      date: '2026-02-18',
      amount: 6000,
      description: 'LA FOSSE LTD SB-285350 SB-28535 BG',
    });
    const existing: InvoicePayment = {
      id: 'ip-EG-0045-hash-tfr-settled',
      invoice_id: 'EG-0045',
      bank_transaction_id: 'hash-tfr-settled',
      payment_date: '2026-02-18',
      amount_paid: 3000,
      deposit_currency: 'GBP',
      fx_rate_at_payment: null,
      amount_in_invoice_currency: 3000,
      fx_gain_loss: 0,
      residual: 0,
      created_at: TODAY,
      updated_at: null,
    };

    const plan = planReconciliation({
      invoices: [],
      transactions: [settledTfr, duplicateBg],
      clientsById: laFosseClientsById,
      existingPayments: [existing],
      options: { now: TODAY },
    });

    expect(plan.unmatchedTransactions).toHaveLength(0);
  });

  it('excludes micro card FX credit legs from unmatchedTransactions', () => {
    const microDeposit = tx({
      id: 'hash-careem-fx',
      date: '2026-04-07',
      amount: 0.2,
      description: 'CAREEM FOOD U.A.EMIRATES AMOUNT IN',
    });

    const plan = planReconciliation({
      invoices: [],
      transactions: [microDeposit],
      clientsById: dcClientsById,
      existingPayments: [],
      options: { now: TODAY },
    });

    expect(plan.unmatchedTransactions).toHaveLength(0);
  });
});

describe('planReconciliation — disqualifications', () => {
  it("emits 'no-candidate' when invoice has no matching deposit", () => {
    const invoice = parseInvoiceRow(dcInvoice001);
    const plan = planReconciliation({
      invoices: [invoice],
      transactions: [],
      clientsById: dcClientsById,
      existingPayments: [],
      options: { now: TODAY },
    });

    expect(plan.proposedPayments).toHaveLength(0);
    expect(plan.unmatchedInvoices.map(i => i.id)).toEqual(['DC-001']);
    const reasons = plan.notes.map(n => n.code);
    expect(reasons).toContain('no-candidate');
  });

  it("emits 'amount-out-of-tolerance' when deposit differs by more than 5%", () => {
    const invoice = parseInvoiceRow(dcInvoice001);
    const deposit = tx({ id: 'tx-1', amount: 5000 });

    const plan = planReconciliation({
      invoices: [invoice],
      transactions: [deposit],
      clientsById: dcClientsById,
      existingPayments: [],
      options: { now: TODAY },
    });

    expect(plan.proposedPayments).toHaveLength(0);
    expect(plan.notes.some(n => n.code === 'amount-out-of-tolerance')).toBe(true);
    expect(plan.unmatchedInvoices.map(i => i.id)).toEqual(['DC-001']);
    expect(plan.unmatchedTransactions.map(t => t.id)).toEqual(['tx-1']);
  });

  it("emits 'date-out-of-window' when deposit is far from due_date", () => {
    const invoice = parseInvoiceRow(dcInvoice001);
    const deposit = tx({ id: 'tx-1', date: '2026-04-25', amount: 3960 });

    const plan = planReconciliation({
      invoices: [invoice],
      transactions: [deposit],
      clientsById: dcClientsById,
      existingPayments: [],
      options: { now: TODAY, maxProximityDays: 90 },
    });

    expect(plan.proposedPayments).toHaveLength(0);
    expect(plan.notes.some(n => n.code === 'date-out-of-window')).toBe(true);
  });

  it("emits 'unresolved-fx' when currencies differ and fx_rate_at_issue is missing", () => {
    const invoice = parseInvoiceRow(fzcoInvoice001);
    const deposit = tx({
      id: 'tx-1',
      date: '2026-05-01',
      amount: 50000,
      currency: 'AED',
      account: 'emirates-islamic-fzco',
      description: 'LA FOSSE TRANSFER',
      entityId: 'autonize-it-fzco',
    });

    const plan = planReconciliation({
      invoices: [invoice],
      transactions: [deposit],
      clientsById: laFosseClientsById,
      existingPayments: [],
      options: { now: TODAY },
    });

    expect(plan.proposedPayments).toHaveLength(0);
    expect(plan.notes.some(n => n.code === 'unresolved-fx')).toBe(true);
  });

  it('silently disqualifies pairs from a different issuing entity', () => {
    const invoice = parseInvoiceRow(dcInvoice001);
    const deposit = tx({ id: 'tx-1', entityId: 'autonize-it-fzco' });

    const plan = planReconciliation({
      invoices: [invoice],
      transactions: [deposit],
      clientsById: dcClientsById,
      existingPayments: [],
      options: { now: TODAY },
    });

    expect(plan.proposedPayments).toHaveLength(0);
    expect(plan.unmatchedInvoices.map(i => i.id)).toEqual(['DC-001']);
    // Deposit is on FZCO but names a Ltd-only client — out of invoice scope, not unmatched noise.
    expect(plan.unmatchedTransactions).toHaveLength(0);
  });
});

describe('planReconciliation — cross-currency with fx_rate_at_issue', () => {
  it('converts a GBP deposit into AED via the snapshot rate when fx_base_currency matches', () => {
    // Convention: `fx_rate_at_issue` is "AED per 1 GBP".
    // Invoice is in AED; the deposit lands in GBP and is converted.
    const fxInvoice = parseInvoiceRow({
      ...fzcoInvoice001,
      id: 'FZ-0010',
      invoice_number: 'FZ-0010',
      payment_reference: 'FZ-0010',
      currency: 'AED',
      subtotal: '50000',
      vat_rate: '0',
      vat_amount: '0',
      total: '50000',
      fx_rate_at_issue: '4.5',
      fx_base_currency: 'GBP',
      due_date: '2026-05-01',
      invoice_date: '2026-04-01',
      period_start: '2026-04-01',
      period_end: '2026-04-30',
    });

    const deposit = tx({
      id: 'tx-1',
      date: '2026-05-01',
      amount: 11111.11,
      currency: 'GBP',
      account: 'barclays-current',
      description: 'LA FOSSE TRANSFER',
      entityId: 'autonize-it-fzco',
    });

    const plan = planReconciliation({
      invoices: [fxInvoice],
      transactions: [deposit],
      clientsById: laFosseClientsById,
      existingPayments: [],
      options: { now: TODAY },
    });

    expect(plan.proposedPayments).toHaveLength(1);
    const payment = plan.proposedPayments[0];
    expect(payment.invoice_id).toBe('FZ-0010');
    expect(payment.deposit_currency).toBe('GBP');
    expect(payment.fx_rate_at_payment).toBe(4.5);
    expect(payment.amount_in_invoice_currency).toBe(50000);
    expect(payment.fx_gain_loss).toBe(0);
  });

  it("emits 'unresolved-fx' when fx_base_currency does not match the deposit currency", () => {
    const fxInvoice = parseInvoiceRow({
      ...fzcoInvoice001,
      id: 'FZ-0011',
      invoice_number: 'FZ-0011',
      payment_reference: 'FZ-0011',
      currency: 'AED',
      subtotal: '50000',
      vat_rate: '0',
      vat_amount: '0',
      total: '50000',
      fx_rate_at_issue: '4.5',
      fx_base_currency: 'GBP',
      due_date: '2026-05-01',
      invoice_date: '2026-04-01',
      period_start: '2026-04-01',
      period_end: '2026-04-30',
    });

    const deposit = tx({
      id: 'tx-1',
      date: '2026-05-01',
      amount: 50000,
      currency: 'EUR',
      account: 'wise-fzco',
      description: 'LA FOSSE TRANSFER',
      entityId: 'autonize-it-fzco',
    });

    const plan = planReconciliation({
      invoices: [fxInvoice],
      transactions: [deposit],
      clientsById: laFosseClientsById,
      existingPayments: [],
      options: { now: TODAY },
    });

    expect(plan.proposedPayments).toHaveLength(0);
    expect(plan.notes.some(n => n.code === 'unresolved-fx')).toBe(true);
  });
});

describe('planReconciliation — reference-anchored batch matching', () => {
  const eg38 = laFosseEgInvoice('EG-0038', 'SB-280052', '1800', '2025-11-10');
  const eg39 = laFosseEgInvoice('EG-0039', 'SB-280053', '3000', '2025-11-03');
  const eg40 = laFosseEgInvoice('EG-0040', 'SB-280054', '3000', '2025-11-17');

  it('matches a £7,800 batch deposit citing all three SB references', () => {
    const deposit = tx({
      id: 'tx-batch-full',
      date: '2025-12-24',
      amount: 7800,
      description: 'LA FOSSE LTD SB-280052 SB-280053 SB-280054 BG',
    });

    const plan = planReconciliation({
      invoices: [eg38, eg39, eg40],
      transactions: [deposit],
      clientsById: laFosseClientsById,
      existingPayments: [],
      options: { now: TODAY, maxProximityDays: 120 },
    });

    expect(plan.proposedPayments).toHaveLength(3);
    expect(plan.proposedPayments.every(p => p.bank_transaction_id === 'tx-batch-full')).toBe(true);
    expect(plan.proposedPayments.every(
      p => plan.paymentConfidence.get(p.id) === 'reference-exact',
    )).toBe(true);
    expect(plan.unmatchedTransactions).toHaveLength(0);
    expect(plan.unmatchedInvoices).toHaveLength(0);
  });

  it('expands a truncated narrative (SB-280052 only) to the full £7,800 batch', () => {
    const deposit = tx({
      id: 'tx-batch-trunc',
      date: '2025-12-24',
      amount: 7800,
      description: 'LA FOSSE LTD SB-280052 SB-28005 BG',
    });

    const plan = planReconciliation({
      invoices: [eg38, eg39, eg40],
      transactions: [deposit],
      clientsById: laFosseClientsById,
      existingPayments: [],
      options: { now: TODAY, maxProximityDays: 120 },
    });

    expect(plan.proposedPayments).toHaveLength(3);
    expect(new Set(plan.proposedPayments.map(p => p.invoice_id))).toEqual(
      new Set(['EG-0038', 'EG-0039', 'EG-0040']),
    );
    expect(plan.paymentConfidence.get(plan.proposedPayments[0]!.id)).toBe('reference-exact');
  });

  it('matches a single cited reference when the deposit equals one invoice', () => {
    const deposit = tx({
      id: 'tx-single',
      date: '2025-12-24',
      amount: 1800,
      description: 'LA FOSSE LTD SB-280052',
    });

    const plan = planReconciliation({
      invoices: [eg38, eg39, eg40],
      transactions: [deposit],
      clientsById: laFosseClientsById,
      existingPayments: [],
      options: { now: TODAY, maxProximityDays: 120 },
    });

    expect(plan.proposedPayments).toHaveLength(1);
    expect(plan.proposedPayments[0]!.invoice_id).toBe('EG-0038');
    expect(plan.paymentConfidence.get(plan.proposedPayments[0]!.id)).toBe('reference-exact');
  });

  it('emits reference-amount-mismatch when cited references do not sum to the deposit', () => {
    const deposit = tx({
      id: 'tx-mismatch',
      date: '2025-12-24',
      amount: 5000,
      description: 'LA FOSSE LTD SB-280052',
    });

    const plan = planReconciliation({
      invoices: [eg38, eg39, eg40],
      transactions: [deposit],
      clientsById: laFosseClientsById,
      existingPayments: [],
      options: { now: TODAY, maxProximityDays: 120 },
    });

    expect(plan.proposedPayments).toHaveLength(0);
    expect(plan.referenceCitedIssues).toHaveLength(1);
    expect(plan.referenceCitedIssues[0]!.code).toBe('reference-amount-mismatch');
    expect(plan.referenceCitedIssues[0]!.citedInvoiceIds).toEqual(['EG-0038']);
    expect(plan.unmatchedTransactions.map(t => t.id)).toEqual(['tx-mismatch']);
  });

  it('uses resolveDepositAmount for batch total checks', () => {
    const deposit = tx({
      id: 'tx-resolver',
      date: '2025-12-24',
      amount: 9000,
      description: 'LA FOSSE LTD SB-280052 SB-280053 SB-280054',
    });

    const planWithoutResolver = planReconciliation({
      invoices: [eg38, eg39, eg40],
      transactions: [deposit],
      clientsById: laFosseClientsById,
      existingPayments: [],
      options: { now: TODAY, maxProximityDays: 120 },
    });
    expect(planWithoutResolver.proposedPayments).toHaveLength(0);

    const plan = planReconciliation({
      invoices: [eg38, eg39, eg40],
      transactions: [deposit],
      clientsById: laFosseClientsById,
      existingPayments: [],
      options: {
        now: TODAY,
        maxProximityDays: 120,
        resolveDepositAmount: () => 7800,
      },
    });

    expect(plan.proposedPayments).toHaveLength(3);
    expect(plan.proposedPayments.every(
      p => plan.paymentConfidence.get(p.id) === 'reference-exact',
    )).toBe(true);
  });

  it('extracts the GBP narrative leg for La Fosse AED deposits', () => {
    expect(
      laFosseDepositAmountForMatch({
        amount: 9000,
        currency: 'AED',
        description: 'LA FOSSE TRANSFER GBP 7800 SB-280052',
      }),
    ).toBe(7800);
  });

  it('matches Barclays Apr-29 £6k batch to EG-0051 and EG-0052 (truncated SB-29267 narrative)', () => {
    const eg51 = laFosseEgInvoice('EG-0051', 'SB-292672', '3000', '2026-02-16');
    const eg52 = laFosseEgInvoice('EG-0052', 'SB-292673', '3000', '2026-02-23');
    eg51.due_date = '2026-05-01';
    eg52.due_date = '2026-05-01';
    const deposit = tx({
      id: 'tx-eg-apr29',
      date: '2026-04-29',
      amount: 6000,
      description: 'LA FOSSE LTD SB-292672 SB-29267 BGC',
    });

    const plan = planReconciliation({
      invoices: [eg51, eg52],
      transactions: [deposit],
      clientsById: laFosseClientsById,
      existingPayments: [],
      options: { now: '2026-06-02', maxProximityDays: 120 },
    });

    expect(plan.proposedPayments).toHaveLength(2);
    expect(new Set(plan.proposedPayments.map(p => p.invoice_id))).toEqual(
      new Set(['EG-0051', 'EG-0052']),
    );
    expect(plan.proposedPayments.every(
      p => plan.paymentConfidence.get(p.id) === 'reference-exact',
    )).toBe(true);
    expect(plan.proposedPayments.every(p => p.bank_transaction_id === 'tx-eg-apr29')).toBe(true);
  });

  it('matches Jun-24 Emirates GBP £12k batch to FZ-0007..0012', () => {
    const invoices = [
      laFosseFzInvoice('FZ-0007', 'SB-298459', '2000', '2026-05-05'),
      laFosseFzInvoice('FZ-0008', 'SB-298460', '500', '2026-05-01'),
      laFosseFzInvoice('FZ-0009', 'SB-298461', '2000', '2026-04-27'),
      laFosseFzInvoice('FZ-0010', 'SB-298462', '2500', '2026-04-20'),
      laFosseFzInvoice('FZ-0011', 'SB-298463', '2500', '2026-05-18'),
      laFosseFzInvoice('FZ-0012', 'SB-298464', '2500', '2026-05-11'),
    ];
    const deposit = tx({
      id: 'tx-fz-jun24',
      date: '2026-06-24',
      amount: 12_000,
      currency: 'GBP',
      account: 'emirates-islamic-gbp',
      description: 'LA FOSSE LTD SB-298459 SB-298460 SB-298461 SB-298462 SB-298463 SB-298464',
      entityId: 'autonize-it-fzco',
    });

    const plan = planReconciliation({
      invoices,
      transactions: [deposit],
      clientsById: laFosseClientsById,
      existingPayments: [],
      options: { now: '2026-06-25', maxProximityDays: 120 },
    });

    expect(plan.proposedPayments).toHaveLength(6);
    expect(new Set(plan.proposedPayments.map(p => p.invoice_id))).toEqual(
      new Set(['FZ-0007', 'FZ-0008', 'FZ-0009', 'FZ-0010', 'FZ-0011', 'FZ-0012']),
    );
    expect(plan.proposedPayments.every(
      p => plan.paymentConfidence.get(p.id) === 'reference-exact',
    )).toBe(true);
    expect(plan.proposedPayments.every(p => p.bank_transaction_id === 'tx-fz-jun24')).toBe(true);
  });

  it('matches Jun-24 Emirates GBP £12k when SB-298464 is split across a line wrap', () => {
    const invoices = [
      laFosseFzInvoice('FZ-0007', 'SB-298459', '2000', '2026-05-05'),
      laFosseFzInvoice('FZ-0008', 'SB-298460', '500', '2026-05-01'),
      laFosseFzInvoice('FZ-0009', 'SB-298461', '2000', '2026-04-27'),
      laFosseFzInvoice('FZ-0010', 'SB-298462', '2500', '2026-04-20'),
      laFosseFzInvoice('FZ-0011', 'SB-298463', '2500', '2026-05-18'),
      laFosseFzInvoice('FZ-0012', 'SB-298464', '2500', '2026-05-11'),
    ];
    const deposit = tx({
      id: '889b51b3695f758eb88380a8947cdc1a',
      date: '2026-06-24',
      amount: 12_000,
      currency: 'GBP',
      account: 'emirates-islamic-gbp',
      description:
        'INWARD REMITTANCETT REF: GBC24066EKG0WZT2 GBP 12000 LA FOSSE ASSOC IATES LIMITED /INV/SB-298459SB-298461/INV/SB-2984 64SB-298460/INV/SB-298463/INV/ 25',
      entityId: 'autonize-it-fzco',
    });

    const plan = planReconciliation({
      invoices,
      transactions: [deposit],
      clientsById: laFosseClientsById,
      existingPayments: [],
      options: { now: '2026-07-18', maxProximityDays: 120 },
    });

    expect(plan.proposedPayments).toHaveLength(6);
    expect(plan.proposedPayments.every(
      p => plan.paymentConfidence.get(p.id) === 'reference-exact',
    )).toBe(true);
    expect(plan.unmatchedTransactions).toHaveLength(0);
  });

  it('resolves the Jun-24 batch uniquely despite paid-drift invoices of equal amounts in the pool', () => {
    // Real local shape: FZ-0001..0005 are status=paid with no payment rows
    // (drift), four of them £2,500 — the same amount as un-cited FZ-0010.
    // They must not be pulled into the batch as filler.
    const driftInvoices = [
      laFosseFzInvoice('FZ-0001', 'SB-293519', '2500', '2026-03-09', 'paid'),
      laFosseFzInvoice('FZ-0002', 'SB-293520', '2500', '2026-03-16', 'paid'),
      laFosseFzInvoice('FZ-0003', 'SB-293521', '2500', '2026-03-23', 'paid'),
      laFosseFzInvoice('FZ-0004', 'SB-293522', '2000', '2026-03-30', 'paid'),
      laFosseFzInvoice('FZ-0005', 'SB-294877', '2500', '2026-04-13', 'paid'),
    ];
    const issuedInvoices = [
      laFosseFzInvoice('FZ-0007', 'SB-298459', '2000', '2026-05-05'),
      laFosseFzInvoice('FZ-0008', 'SB-298460', '500', '2026-05-01'),
      laFosseFzInvoice('FZ-0009', 'SB-298461', '2000', '2026-04-27'),
      laFosseFzInvoice('FZ-0010', 'SB-298462', '2500', '2026-04-20'),
      laFosseFzInvoice('FZ-0011', 'SB-298463', '2500', '2026-05-18'),
      laFosseFzInvoice('FZ-0012', 'SB-298464', '2500', '2026-05-11'),
    ];
    // Narrative omits SB-298462 (FZ-0010) — expansion must resolve it uniquely.
    const deposit = tx({
      id: '889b51b3695f758eb88380a8947cdc1a',
      date: '2026-06-24',
      amount: 12_000,
      currency: 'GBP',
      account: 'emirates-islamic-gbp',
      description:
        'INWARD REMITTANCETT REF: GBC24066EKG0WZT2 GBP 12000 LA FOSSE ASSOC IATES LIMITED /INV/SB-298459SB-298461/INV/SB-2984 64SB-298460/INV/SB-298463/INV/ 25',
      entityId: 'autonize-it-fzco',
    });

    const plan = planReconciliation({
      invoices: [...driftInvoices, ...issuedInvoices],
      transactions: [deposit],
      clientsById: laFosseClientsById,
      existingPayments: [],
      options: { now: '2026-07-18', maxProximityDays: 120 },
    });

    expect(new Set(plan.proposedPayments.map(p => p.invoice_id))).toEqual(
      new Set(['FZ-0007', 'FZ-0008', 'FZ-0009', 'FZ-0010', 'FZ-0011', 'FZ-0012']),
    );
    expect(plan.proposedPayments.every(
      p => plan.paymentConfidence.get(p.id) === 'reference-exact',
    )).toBe(true);
    expect(plan.referenceCitedIssues).toHaveLength(0);
  });

  it('does not amount-only match paid-drift invoices to unrelated equal-amount deposits', () => {
    const drift = laFosseFzInvoice('FZ-0001', 'SB-293519', '2500', '2026-03-09', 'paid');
    const standingOrder = tx({
      id: 'tx-savings-sto',
      date: '2026-06-01',
      amount: 2500,
      currency: 'GBP',
      account: 'barclays-savings',
      description: 'AUTONIZE IT LTD F STO',
      entityId: 'autonize-it-fzco',
    });

    const plan = planReconciliation({
      invoices: [drift],
      transactions: [standingOrder],
      clientsById: laFosseClientsById,
      existingPayments: [],
      options: { now: '2026-07-18', maxProximityDays: 120 },
    });

    expect(plan.proposedPayments).toHaveLength(0);
  });

  it('rejects a same-currency deposit that is off by more than a penny', () => {
    const invoice = laFosseFzInvoice('FZ-0012', 'SB-298464', '2500', '2026-05-11');
    const deposit = tx({
      id: 'tx-off-by-ten',
      date: '2026-06-24',
      amount: 2490,
      currency: 'GBP',
      account: 'emirates-islamic-gbp',
      description: 'LA FOSSE LTD SB-298464',
      entityId: 'autonize-it-fzco',
    });

    const plan = planReconciliation({
      invoices: [invoice],
      transactions: [deposit],
      clientsById: laFosseClientsById,
      existingPayments: [],
      options: { now: '2026-07-18', maxProximityDays: 120 },
    });

    expect(plan.proposedPayments).toHaveLength(0);
    expect(plan.notes.some(
      n => n.code === 'reference-amount-mismatch' || n.code === 'amount-out-of-tolerance',
    )).toBe(true);
  });
});

describe('planReconciliation — multi-invoice global greedy', () => {
  it('matches each invoice to its closest qualifying deposit deterministically', () => {
    const dc1 = parseInvoiceRow(dcInvoice001);
    const dc2 = parseInvoiceRow(dcInvoice002);
    const t1 = tx({
      id: 'tx-1',
      date: '2025-08-09',
      amount: 3960,
      description: 'DELTA CAPITA — DC-001',
    });
    const t2 = tx({
      id: 'tx-2',
      date: '2025-09-11',
      amount: 12540,
      description: 'DELTA CAPITA — DC-002',
    });

    const plan = planReconciliation({
      invoices: [dc1, dc2],
      transactions: [t2, t1],
      clientsById: dcClientsById,
      existingPayments: [],
      options: { now: TODAY },
    });

    expect(plan.proposedPayments).toHaveLength(2);
    const byInvoice = new Map(
      plan.proposedPayments.map(p => [p.invoice_id, p.bank_transaction_id]),
    );
    expect(byInvoice.get('DC-001')).toBe('tx-1');
    expect(byInvoice.get('DC-002')).toBe('tx-2');
  });
});
