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
  Invoice,
  InvoicePayment,
} from '../../../shared/api-contracts.js';
import { parseClientRow } from '../clients/csv-io.js';
import {
  directRow as directClientRow,
  agencyRow as agencyClientRow,
} from '../clients/test-helpers.js';
import { parseInvoiceRow } from './csv-io.js';
import { dcInvoice001, dcInvoice002, fzcoInvoice001 } from './test-helpers.js';
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
    expect(plan.unmatchedTransactions.map(t => t.id)).toEqual(['tx-1']);
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
