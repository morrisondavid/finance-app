import { describe, it, expect } from 'vitest';
import type {
  AccountName,
  Contract,
  CurrencyCode,
  EntityId,
  Invoice,
  RecurringExpense,
} from '../../../shared/api-contracts.js';
import { ACCOUNTS, ExpectedReceiptsResponseSchema } from '../../../shared/api-contracts.js';
import {
  collectAccrualEvents,
  collectInvoiceReceiptEvents,
} from '../forecast/collect-events.js';
import { composeExpectedReceipts } from './expected-receipts.js';
import type { PipelineResult } from '../../utils/recurring-pipeline.js';
import { parseContractRow } from './csv-io.js';
import { dcSowRow } from './test-helpers.js';

const currencyByAccount = new Map<AccountName, CurrencyCode>([
  ['barclays-current' as AccountName, 'GBP'],
]);

const accountsByEntity = new Map<EntityId, readonly AccountName[]>([
  ['autonize-it-ltd' as EntityId, ['barclays-current' as AccountName]],
]);

const AS_OF = '2026-04-25';
const HORIZON = '2026-07-24';

const ltdContract: Contract = parseContractRow(dcSowRow);

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
    due_date: '2026-05-15',
    created_at: '2026-04-01',
    updated_at: null,
    ...overrides,
  };
}

describe('composeExpectedReceipts', () => {
  it('parses as ExpectedReceiptsResponseSchema', () => {
    const body = composeExpectedReceipts({
      asOf: AS_OF,
      horizon: HORIZON,
      contracts: [ltdContract],
      leaveRows: [],
      publicHolidayDatesByEntity: new Map([
        ['autonize-it-ltd' as EntityId, new Set<string>()],
      ]),
      unpaidInvoices: [],
      accountsByEntity,
      currencyByAccount,
      allowedAccountSet: new Set(ACCOUNTS),
    });
    expect(() => ExpectedReceiptsResponseSchema.parse(body)).not.toThrow();
    expect(body.asOf).toBe(AS_OF);
    expect(body.horizon).toBe(HORIZON);
  });

  it('accrual receipts match collectAccrualEvents (parity)', () => {
    const accrualEvents = collectAccrualEvents({
      contracts: [ltdContract],
      leaveRows: [],
      publicHolidayDatesByEntity: new Map([
        ['autonize-it-ltd' as EntityId, new Set<string>()],
      ]),
      today: AS_OF,
      horizon: HORIZON,
      accountsByEntity,
      currencyByAccount,
    });

    const body = composeExpectedReceipts({
      asOf: AS_OF,
      horizon: HORIZON,
      contracts: [ltdContract],
      leaveRows: [],
      publicHolidayDatesByEntity: new Map([
        ['autonize-it-ltd' as EntityId, new Set<string>()],
      ]),
      unpaidInvoices: [],
      accountsByEntity,
      currencyByAccount,
      allowedAccountSet: new Set(ACCOUNTS),
    });

    const accrualRows = body.receipts.filter(r => r.source === 'accrual');
    expect(accrualRows).toHaveLength(accrualEvents.length);
    for (let i = 0; i < accrualEvents.length; i++) {
      const e = accrualEvents[i];
      const r = accrualRows[i];
      expect(r.expectedDate).toBe(e.date);
      expect(r.amount).toBe(e.amount);
      expect(r.account).toBe(e.account);
      expect(r.currency).toBe(e.currency);
      expect(r.contractId).toBe(e.contractId ?? null);
    }
  });

  it('includes invoice-receipt rows and emits no accrual once the owed window opens past contract end', () => {
    const inv = makeInvoice({ id: 'DC-075' });
    const invoiceEvents = collectInvoiceReceiptEvents({
      unpaidInvoices: [inv],
      today: AS_OF,
      horizon: HORIZON,
      accountsByEntity,
      currencyByAccount,
    });

    const body = composeExpectedReceipts({
      asOf: AS_OF,
      horizon: HORIZON,
      contracts: [ltdContract],
      leaveRows: [],
      publicHolidayDatesByEntity: new Map([
        ['autonize-it-ltd' as EntityId, new Set<string>()],
      ]),
      unpaidInvoices: [inv],
      accountsByEntity,
      currencyByAccount,
      allowedAccountSet: new Set(ACCOUNTS),
      // Invoice covers through 2026-04-30 (the contract end), so the owed
      // window opens 2026-05-01 — past contract end → no accrual tail.
      accrualWindowStartByContractId: new Map([['dc-sow-2026', '2026-05-01']]),
    });

    expect(body.receipts.filter(r => r.source === 'accrual')).toHaveLength(0);

    const invRows = body.receipts.filter(r => r.source === 'invoice-receipt');
    expect(invRows).toHaveLength(1);
    expect(invRows[0].invoiceId).toBe('DC-075');
    expect(invRows[0].contractId).toBe('dc-sow-2026');
    expect(invRows[0].amount).toBe(inv.total);
    expect(invRows[0].expectedDate).toBe(invoiceEvents[0].date);
  });

  it('filters to allowedAccountSet when entity-scoped', () => {
    const body = composeExpectedReceipts({
      asOf: AS_OF,
      horizon: HORIZON,
      contracts: [ltdContract],
      leaveRows: [],
      publicHolidayDatesByEntity: new Map([
        ['autonize-it-ltd' as EntityId, new Set<string>()],
      ]),
      unpaidInvoices: [],
      accountsByEntity,
      currencyByAccount,
      allowedAccountSet: new Set<AccountName>(), // empty — drop all
    });
    expect(body.receipts).toHaveLength(0);
  });

  it('includes declared rental-income receipts projected through the horizon', () => {
    const rentalRow: RecurringExpense = {
      merchant: '53 Heath Park Road',
      category: 'Property',
      colour: '#888',
      amount: 2850,
      frequency: 'monthly',
      monthsActive: 0,
      annualTotal: 2850 * 12,
      logoUrl: null,
      sourceAccount: 'monzo-joint',
      billingDayOfMonth: 1,
      billingMonth: null,
      declaredObligationId: 'manual-heath-park-rental',
    };
    const pipeline: PipelineResult = {
      expenseCandidates: [],
      incomeCandidates: [],
      expenseAccumulators: new Map(),
      incomeAccumulators: new Map(),
      monthlyExpenseRecurring: [],
      annualExpenseRecurring: [],
      monthlyIncomeRecurring: [rentalRow],
      annualIncomeRecurring: [],
      monthsCovered: 12,
    };

    const body = composeExpectedReceipts({
      asOf: AS_OF,
      horizon: HORIZON,
      contracts: [],
      leaveRows: [],
      publicHolidayDatesByEntity: new Map(),
      unpaidInvoices: [],
      accountsByEntity,
      currencyByAccount: new Map<AccountName, CurrencyCode>([
        ['monzo-joint' as AccountName, 'GBP'],
      ]),
      allowedAccountSet: new Set<AccountName>(['monzo-joint' as AccountName]),
      pipeline,
      rentalIncomeRecurring: [rentalRow],
    });

    const rentalReceipts = body.receipts.filter(r => r.source === 'rental-income');
    expect(rentalReceipts.length).toBeGreaterThan(0);
    expect(rentalReceipts.every(r => r.obligationId === 'manual-heath-park-rental')).toBe(true);
    expect(rentalReceipts.every(r => r.amount === 2850)).toBe(true);
    expect(rentalReceipts.every(r => r.account === 'monzo-joint')).toBe(true);
    expect(() => ExpectedReceiptsResponseSchema.parse(body)).not.toThrow();
  });

  it('projects every declared rental even when only one is due this calendar month', () => {
    const huntersRow: RecurringExpense = {
      merchant: '78 Hunters Square',
      category: 'Property',
      colour: '#888',
      amount: 1292.72,
      frequency: 'monthly',
      monthsActive: 24,
      annualTotal: 1292.72 * 12,
      logoUrl: null,
      sourceAccount: 'monzo-joint',
      billingDayOfMonth: 5,
      billingMonth: null,
      declaredObligationId: 'seed-hunters-square-78',
    };
    const heathRow: RecurringExpense = {
      merchant: '53 Heath Park Road',
      category: 'Property',
      colour: '#888',
      amount: 2850,
      frequency: 'monthly',
      monthsActive: 0,
      annualTotal: 2850 * 12,
      logoUrl: null,
      sourceAccount: 'monzo-joint',
      billingDayOfMonth: 1,
      billingMonth: null,
      declaredObligationId: 'manual-heath-park-rental',
    };
    const pipeline: PipelineResult = {
      expenseCandidates: [],
      incomeCandidates: [],
      expenseAccumulators: new Map(),
      incomeAccumulators: new Map(),
      monthlyExpenseRecurring: [],
      annualExpenseRecurring: [],
      monthlyIncomeRecurring: [huntersRow, heathRow],
      annualIncomeRecurring: [],
      monthsCovered: 12,
    };

    const body = composeExpectedReceipts({
      asOf: AS_OF,
      horizon: HORIZON,
      contracts: [],
      leaveRows: [],
      publicHolidayDatesByEntity: new Map(),
      unpaidInvoices: [],
      accountsByEntity,
      currencyByAccount: new Map<AccountName, CurrencyCode>([
        ['monzo-joint' as AccountName, 'GBP'],
      ]),
      allowedAccountSet: new Set<AccountName>(['monzo-joint' as AccountName]),
      pipeline,
      rentalIncomeRecurring: [huntersRow, heathRow],
    });

    const rentalReceipts = body.receipts.filter(r => r.source === 'rental-income');
    const obligationIds = new Set(rentalReceipts.map(r => r.obligationId));
    expect(obligationIds.has('seed-hunters-square-78')).toBe(true);
    expect(obligationIds.has('manual-heath-park-rental')).toBe(true);
  });
});
