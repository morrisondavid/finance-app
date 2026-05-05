/**
 * Unit tests for `findLastInvoicePaymentDate` and
 * `resolveAccrualWindowStart`. Pure domain code, no I/O, so the
 * fixtures are hand-rolled {@link Transaction} rows rather than the
 * CSV/DB round-trips used in integration tests.
 */

import { describe, it, expect } from 'vitest';
import {
  findLastInvoicePaymentDate,
  resolveAccrualWindowStart,
} from './last-payment.js';
import { parseContractRow } from './csv-io.js';
import { parseClientRow } from '../clients/csv-io.js';
import { dcSowRow, lfContractRow, lfFzcoContractRow } from './test-helpers.js';
import { directRow, agencyRow } from '../clients/test-helpers.js';
import type { InvoicePayment, Transaction } from '../../../shared/api-contracts.js';

const deltaCapita = parseClientRow(directRow);
const laFosse = parseClientRow(agencyRow);
const dc = parseContractRow(dcSowRow);
const lfLtd = parseContractRow(lfContractRow);
const lfFzco = parseContractRow(lfFzcoContractRow);

function mkIncome(date: string, description: string, amount: number): Transaction {
  return {
    date,
    description,
    amount,
    account: 'wise-ltd',
    type: 'income',
  };
}

describe('findLastInvoicePaymentDate — narrative matching', () => {
  it('returns the most recent date when the agency trading name appears verbatim', () => {
    const txns: Transaction[] = [
      mkIncome('2026-03-10', 'LA FOSSE ASSOCIATES LIMITED - INV 123', 11000),
      mkIncome('2026-04-10', 'LA FOSSE ASSOCIATES LIMITED - INV 124', 11000),
      mkIncome('2026-02-05', 'Random interest payment', 3.21),
    ];
    const got = findLastInvoicePaymentDate({
      contract: lfLtd,
      client: laFosse,
      incomeTransactions: txns,
      today: '2026-04-24',
    });
    expect(got).toBe('2026-04-10');
  });

  it('survives statement quirks: punctuation, spacing, and mixed case', () => {
    const txns: Transaction[] = [
      mkIncome('2026-03-10', 'la  fosse    associates.ltd -  invoice', 11000),
    ];
    const got = findLastInvoicePaymentDate({
      contract: lfLtd,
      client: laFosse,
      incomeTransactions: txns,
      today: '2026-04-24',
    });
    expect(got).toBe('2026-03-10');
  });

  it('matches the single-word trading-name token when full name is abbreviated', () => {
    const txns: Transaction[] = [
      mkIncome('2026-03-10', 'DELTA Transfer - supplier payment', 12100),
    ];
    const got = findLastInvoicePaymentDate({
      contract: dc,
      client: deltaCapita,
      incomeTransactions: txns,
      today: '2026-04-24',
    });
    expect(got).toBe('2026-03-10');
  });

  it('ignores expense rows and only considers type === income', () => {
    const txns: Transaction[] = [
      { ...mkIncome('2026-04-15', 'LA FOSSE invoice', 11000), type: 'expense' },
    ];
    const got = findLastInvoicePaymentDate({
      contract: lfLtd,
      client: laFosse,
      incomeTransactions: txns,
      today: '2026-04-24',
    });
    expect(got).toBeNull();
  });

  it('ignores rows dated after `today`', () => {
    const txns: Transaction[] = [
      mkIncome('2026-05-02', 'LA FOSSE invoice', 11000),
    ];
    const got = findLastInvoicePaymentDate({
      contract: lfLtd,
      client: laFosse,
      incomeTransactions: txns,
      today: '2026-04-24',
    });
    expect(got).toBeNull();
  });

  it('returns null when no narrative matches and amount fallback is off', () => {
    const txns: Transaction[] = [
      mkIncome('2026-04-01', 'Unrelated other payer', 11000),
      mkIncome('2026-03-15', 'Treasury income', 500),
    ];
    const got = findLastInvoicePaymentDate({
      contract: lfLtd,
      client: laFosse,
      incomeTransactions: txns,
      today: '2026-04-24',
    });
    expect(got).toBeNull();
  });

  it('returns null for the FZCO contract with zero transactions (no payments yet)', () => {
    const got = findLastInvoicePaymentDate({
      contract: lfFzco,
      client: laFosse,
      incomeTransactions: [],
      today: '2026-04-24',
    });
    expect(got).toBeNull();
  });
});

describe('findLastInvoicePaymentDate — amount fallback (opt-in)', () => {
  it('matches within 5% tolerance of day_rate * plausible day count when enabled', () => {
    // £550 * 22 = £12,100. £12,000 is within 5%.
    const txns: Transaction[] = [
      mkIncome('2026-04-02', 'SEPA credit unknown payer', 12000),
    ];
    const got = findLastInvoicePaymentDate({
      contract: dc,
      client: deltaCapita,
      incomeTransactions: txns,
      today: '2026-04-24',
      enableAmountFallback: true,
    });
    expect(got).toBe('2026-04-02');
  });

  it('does NOT match when fallback is disabled (the default)', () => {
    const txns: Transaction[] = [
      mkIncome('2026-04-02', 'SEPA credit unknown payer', 12000),
    ];
    const got = findLastInvoicePaymentDate({
      contract: dc,
      client: deltaCapita,
      incomeTransactions: txns,
      today: '2026-04-24',
    });
    expect(got).toBeNull();
  });

  it('rejects amounts that are nowhere near day_rate * N even with fallback on', () => {
    const txns: Transaction[] = [
      mkIncome('2026-04-02', 'Random incoming', 37.5),
    ];
    const got = findLastInvoicePaymentDate({
      contract: dc,
      client: deltaCapita,
      incomeTransactions: txns,
      today: '2026-04-24',
      enableAmountFallback: true,
    });
    expect(got).toBeNull();
  });

  it('prefers a narrative match over an amount match even with fallback on', () => {
    const txns: Transaction[] = [
      mkIncome('2026-04-10', 'SEPA credit unknown payer', 12100),
      mkIncome('2026-04-02', 'DELTA CAPITA INV 99', 12100),
    ];
    const got = findLastInvoicePaymentDate({
      contract: dc,
      client: deltaCapita,
      incomeTransactions: txns,
      today: '2026-04-24',
      enableAmountFallback: true,
    });
    // Narrative pass runs first and picks the newest narrative hit
    // ('2026-04-02'), not the newer amount-only row ('2026-04-10').
    expect(got).toBe('2026-04-02');
  });
});

describe('findLastInvoicePaymentDate — ledger payments (Phase 4)', () => {
  function mkLedgerPayment(
    invoiceId: 'DC-001' | 'DC-002',
    paymentDate: string,
  ): InvoicePayment {
    return {
      id: `ip-${invoiceId}-${paymentDate}`,
      invoice_id: invoiceId,
      bank_transaction_id: `tx-${invoiceId}-${paymentDate}`,
      payment_date: paymentDate,
      amount_paid: 11000,
      deposit_currency: 'GBP',
      fx_rate_at_payment: null,
      amount_in_invoice_currency: 11000,
      fx_gain_loss: 0,
      residual: 0,
      created_at: paymentDate,
      updated_at: null,
    };
  }

  it('prefers the latest ledger payment date over a newer narrative hit', () => {
    const txns: Transaction[] = [
      mkIncome('2026-04-15', 'LA FOSSE invoice', 11000),
    ];
    const ledger = [
      mkLedgerPayment('DC-001', '2026-04-05'),
      mkLedgerPayment('DC-002', '2026-04-10'),
    ];
    const got = findLastInvoicePaymentDate({
      contract: lfLtd,
      client: laFosse,
      incomeTransactions: txns,
      ledgerPayments: ledger,
      today: '2026-04-24',
    });
    expect(got).toBe('2026-04-10');
  });

  it('falls through to narrative match when no ledger payment is supplied', () => {
    const txns: Transaction[] = [
      mkIncome('2026-04-12', 'LA FOSSE invoice', 11000),
    ];
    const got = findLastInvoicePaymentDate({
      contract: lfLtd,
      client: laFosse,
      incomeTransactions: txns,
      ledgerPayments: [],
      today: '2026-04-24',
    });
    expect(got).toBe('2026-04-12');
  });

  it('ignores ledger rows dated after `today`', () => {
    const ledger = [mkLedgerPayment('DC-001', '2026-05-15')];
    const got = findLastInvoicePaymentDate({
      contract: lfLtd,
      client: laFosse,
      incomeTransactions: [],
      ledgerPayments: ledger,
      today: '2026-04-24',
    });
    expect(got).toBeNull();
  });
});

describe('resolveAccrualWindowStart', () => {
  it('returns the day after last payment when known and inside the contract', () => {
    const got = resolveAccrualWindowStart({
      contract: dc,
      lastPaymentDate: '2026-04-05',
      today: '2026-04-24',
    });
    expect(got).toBe('2026-04-06');
  });

  it('falls back to month-start when lastPaymentDate is null', () => {
    const got = resolveAccrualWindowStart({
      contract: dc,
      lastPaymentDate: null,
      today: '2026-04-24',
    });
    expect(got).toBe('2026-04-01');
  });

  it('clamps to contract.start_date when the derived start would precede it', () => {
    // dc.start_date = 2026-01-01. Last payment 2025-12-15 → base 2025-12-16.
    const got = resolveAccrualWindowStart({
      contract: dc,
      lastPaymentDate: '2025-12-15',
      today: '2026-04-24',
    });
    expect(got).toBe('2026-01-01');
  });

  it('clamps to contract.start_date when month-start precedes it (contract started mid-month)', () => {
    // lf-2026-apr (FZCO) starts 2026-03-02. Today = 2026-03-10. Month start = 2026-03-01 → clamp to 03-02.
    const got = resolveAccrualWindowStart({
      contract: lfFzco,
      lastPaymentDate: null,
      today: '2026-03-10',
    });
    expect(got).toBe('2026-03-02');
  });
});
