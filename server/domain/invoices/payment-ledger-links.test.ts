import { describe, it, expect } from 'vitest';
import type { InvoicePayment } from '../../../shared/api-contracts.js';
import {
  invoiceIdsWithLedgerLinkedPayments,
  paymentsLinkedToLedger,
} from './payment-ledger-links.js';

const orphan: InvoicePayment = {
  id: 'ip-DC-009-orphan',
  invoice_id: 'DC-009',
  bank_transaction_id: 'e3ecf82fde14f1950eb661b421a32914',
  payment_date: '2026-04-01',
  amount_paid: 13200,
  deposit_currency: 'GBP',
  fx_rate_at_payment: null,
  amount_in_invoice_currency: 13200,
  fx_gain_loss: 0,
  residual: 0,
  created_at: '2026-06-06',
  updated_at: null,
};

const linked: InvoicePayment = {
  ...orphan,
  id: 'ip-DC-009-linked',
  bank_transaction_id: 'c7ea7307288f56eb60e093353802cc44',
};

describe('payment-ledger-links', () => {
  it('drops payment rows whose bank_transaction_id is absent from the ledger', () => {
    const ledger = new Set(['c7ea7307288f56eb60e093353802cc44']);
    expect(paymentsLinkedToLedger([orphan, linked], ledger)).toEqual([linked]);
  });

  it('returns invoice ids only for ledger-linked payments', () => {
    const ledger = new Set(['c7ea7307288f56eb60e093353802cc44']);
    expect([...invoiceIdsWithLedgerLinkedPayments([orphan, linked], ledger)]).toEqual([
      'DC-009',
    ]);
  });
});
