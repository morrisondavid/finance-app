import { describe, it, expect } from 'vitest';
import type {
  AccountName,
  CurrencyCode,
  EntityId,
  Invoice,
  ObligationRow,
  UpcomingRecurring,
} from '../../../shared/api-contracts.js';
import {
  collectObligationEvents,
  collectRecurringEvents,
  collectIncomeRecurringEvents,
  collectInvoiceReceiptEvents,
} from './collect-events.js';

const currencyByAccount = new Map<AccountName, CurrencyCode>([
  ['barclays-current' as AccountName, 'GBP'],
  ['emirates-islamic' as AccountName, 'AED'],
]);

const accountsByEntity = new Map<EntityId, readonly AccountName[]>([
  ['autonize-it-ltd' as EntityId, ['barclays-current' as AccountName]],
  ['autonize-it-fzco' as EntityId, ['emirates-islamic' as AccountName]],
]);

const TODAY = '2026-04-25';
const HORIZON = '2026-07-24';

function makeObligation(overrides: Partial<ObligationRow> & { id: string }): ObligationRow {
  return {
    source: 'auto',
    type: 'vat',
    name: 'VAT Q1',
    entity: 'HMRC',
    frequency: 'quarterly',
    expectedAmount: 5000,
    dueDate: '2026-05-07',
    status: 'unpaid',
    paidAmount: null,
    paidDate: null,
    paidFromAccount: null,
    notes: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function makeRecurring(overrides: Partial<UpcomingRecurring>): UpcomingRecurring {
  return {
    merchant: 'Netflix',
    category: 'Entertainment',
    colour: '#000',
    logoUrl: null,
    amount: 15.99,
    frequency: 'monthly',
    sourceAccount: 'barclays-current',
    nextExpectedDate: '2026-05-01',
    lastChargeDate: '2026-04-01',
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<Invoice> & { id: string }): Invoice {
  return {
    contract_id: 'dc-sow-2026',
    client_id: 'delta-capita',
    issuing_entity_id: 'autonize-it-ltd',
    invoice_number: overrides.id,
    payment_reference: overrides.id,
    invoice_date: '2026-04-01',
    period_start: '2026-04-01',
    period_end: '2026-04-30',
    days_billed: 20,
    description: 'test',
    currency: 'GBP',
    subtotal: 11000,
    vat_rate: 0.2,
    vat_amount: 2200,
    total: 13200,
    fx_rate_at_issue: null,
    fx_base_currency: null,
    mechanism: 'supplier-issued',
    status: 'issued',
    due_date: '2026-05-01',
    created_at: '2026-04-01',
    updated_at: null,
    ...overrides,
  };
}

describe('collectObligationEvents', () => {
  const defaultAccountByType = new Map([['vat', 'barclays-current' as AccountName]]);

  it('creates a negative event for an unpaid obligation', () => {
    const events = collectObligationEvents({
      obligations: [makeObligation({ id: 'auto-vat-q1' })],
      defaultAccountByType,
      currencyByAccount,
      horizon: HORIZON,
    });
    expect(events).toHaveLength(1);
    expect(events[0].amount).toBe(-5000);
    expect(events[0].date).toBe('2026-05-07');
    expect(events[0].source).toBe('obligation');
    expect(events[0].account).toBe('barclays-current');
    expect(events[0].obligationId).toBe('auto-vat-q1');
  });

  it('uses paidFromAccount when set', () => {
    const events = collectObligationEvents({
      obligations: [makeObligation({ id: 'ob-1', paidFromAccount: 'emirates-islamic' })],
      defaultAccountByType,
      currencyByAccount,
      horizon: HORIZON,
    });
    expect(events[0].account).toBe('emirates-islamic');
    expect(events[0].currency).toBe('AED');
  });

  it('skips obligations beyond the horizon', () => {
    const events = collectObligationEvents({
      obligations: [makeObligation({ id: 'ob-far', dueDate: '2027-01-01' })],
      defaultAccountByType,
      currencyByAccount,
      horizon: HORIZON,
    });
    expect(events).toHaveLength(0);
  });

  it('skips obligations with null expectedAmount', () => {
    const events = collectObligationEvents({
      obligations: [makeObligation({ id: 'ob-null', expectedAmount: null })],
      defaultAccountByType,
      currencyByAccount,
      horizon: HORIZON,
    });
    expect(events).toHaveLength(0);
  });
});

describe('collectRecurringEvents', () => {
  it('repeats monthly items through the horizon', () => {
    const events = collectRecurringEvents({
      monthlyRecurring: [makeRecurring({ nextExpectedDate: '2026-05-01', amount: 15.99 })],
      annualRecurring: [],
      today: TODAY,
      horizon: HORIZON,
      currencyByAccount,
    });
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events[0].date).toBe('2026-05-01');
    expect(events[1].date).toBe('2026-06-01');
    expect(events[2].date).toBe('2026-07-01');
    expect(events[0].amount).toBe(-15.99);
  });

  it('includes annual items that fall within the horizon', () => {
    const events = collectRecurringEvents({
      monthlyRecurring: [],
      annualRecurring: [makeRecurring({ nextExpectedDate: '2026-06-15', frequency: 'annual', amount: 200 })],
      today: TODAY,
      horizon: HORIZON,
      currencyByAccount,
    });
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe('2026-06-15');
    expect(events[0].amount).toBe(-200);
  });

  it('skips annual items beyond the horizon', () => {
    const events = collectRecurringEvents({
      monthlyRecurring: [],
      annualRecurring: [makeRecurring({ nextExpectedDate: '2026-12-01', frequency: 'annual' })],
      today: TODAY,
      horizon: HORIZON,
      currencyByAccount,
    });
    expect(events).toHaveLength(0);
  });
});

describe('collectIncomeRecurringEvents', () => {
  it('emits positive monthly inflows on the same schedule as expenses', () => {
    const events = collectIncomeRecurringEvents({
      monthlyRecurring: [makeRecurring({ nextExpectedDate: '2026-05-01', amount: 500 })],
      annualRecurring: [],
      today: TODAY,
      horizon: HORIZON,
      currencyByAccount,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].amount).toBe(500);
    expect(events[0].source).toBe('recurring');
  });

  it('carries declaredObligationId through to obligationId on forecast events', () => {
    const events = collectIncomeRecurringEvents({
      monthlyRecurring: [
        makeRecurring({
          nextExpectedDate: '2026-05-01',
          amount: 2850,
          declaredObligationId: 'manual-heath-park-rental',
        }),
      ],
      annualRecurring: [],
      today: TODAY,
      horizon: HORIZON,
      currencyByAccount,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].obligationId).toBe('manual-heath-park-rental');
  });
});

describe('collectInvoiceReceiptEvents', () => {
  it('creates a positive event on the due date', () => {
    const events = collectInvoiceReceiptEvents({
      unpaidInvoices: [makeInvoice({ id: 'DC-011' })],
      today: TODAY,
      horizon: HORIZON,
      accountsByEntity,
      currencyByAccount,
    });
    expect(events).toHaveLength(1);
    expect(events[0].amount).toBe(13200);
    expect(events[0].date).toBe('2026-05-01');
    expect(events[0].source).toBe('invoice-receipt');
  });

  it('places overdue invoices on tomorrow', () => {
    const events = collectInvoiceReceiptEvents({
      unpaidInvoices: [makeInvoice({ id: 'DC-LATE', due_date: '2026-04-01' })],
      today: TODAY,
      horizon: HORIZON,
      accountsByEntity,
      currencyByAccount,
    });
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe('2026-04-26');
  });

  it('falls back to the entity primary account but keeps the invoice currency', () => {
    const events = collectInvoiceReceiptEvents({
      unpaidInvoices: [makeInvoice({ id: 'FZ-001', issuing_entity_id: 'autonize-it-fzco' })],
      today: TODAY,
      horizon: HORIZON,
      accountsByEntity,
      currencyByAccount,
    });
    expect(events[0].account).toBe('emirates-islamic');
    expect(events[0].currency).toBe('GBP');
  });

  it('routes a GBP FZCO invoice to the GBP sub-account, not the AED primary', () => {
    const fzcoAccounts = new Map<EntityId, readonly AccountName[]>([
      [
        'autonize-it-fzco' as EntityId,
        ['emirates-islamic' as AccountName, 'emirates-islamic-gbp' as AccountName],
      ],
    ]);
    const fzcoCurrencies = new Map<AccountName, CurrencyCode>([
      ['emirates-islamic' as AccountName, 'AED'],
      ['emirates-islamic-gbp' as AccountName, 'GBP'],
    ]);

    const events = collectInvoiceReceiptEvents({
      unpaidInvoices: [
        makeInvoice({ id: 'FZ-0013', issuing_entity_id: 'autonize-it-fzco', currency: 'GBP' }),
      ],
      today: TODAY,
      horizon: HORIZON,
      accountsByEntity: fzcoAccounts,
      currencyByAccount: fzcoCurrencies,
    });
    expect(events[0].account).toBe('emirates-islamic-gbp');
    expect(events[0].currency).toBe('GBP');
  });
});
