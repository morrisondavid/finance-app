import { describe, it, expect } from 'vitest';
import type {
  AccountName,
  Contract,
  CurrencyCode,
  EntityId,
  Invoice,
} from '../../../shared/api-contracts.js';
import { collectAccrualEvents } from './collect-events.js';
import { parseContractRow } from '../contracts/csv-io.js';
import { dcSowRow, lfFzcoContractRow, rowFromHeaders } from '../contracts/test-helpers.js';

const currencyByAccount = new Map<AccountName, CurrencyCode>([
  ['barclays-current' as AccountName, 'GBP'],
]);

const accountsByEntity = new Map<EntityId, readonly AccountName[]>([
  ['autonize-it-ltd' as EntityId, ['barclays-current' as AccountName]],
]);

const TODAY = '2026-04-25';
const HORIZON = '2026-08-31';

const endingContract: Contract = parseContractRow(
  rowFromHeaders({
    ...dcSowRow,
    id: 'short-2026',
    end_date: '2026-05-31',
    reference: 'Short · Apr–May 2026',
  }),
);

describe('collectAccrualEvents projectToContractEnd', () => {
  const base = {
    contracts: [endingContract],
    leaveRows: [],
    publicHolidayDatesByEntity: new Map([
      ['autonize-it-ltd' as EntityId, new Set<string>()],
    ]),
    today: TODAY,
    horizon: HORIZON,
    accountsByEntity,
    currencyByAccount,
    invoicedContractIds: new Set<string>(),
    unpaidInvoices: [],
  };

  it('default emits one accrual for current month window only', () => {
    const events = collectAccrualEvents(base);
    expect(events).toHaveLength(1);
  });

  it('projectToContractEnd emits accruals for April partial and May full', () => {
    const events = collectAccrualEvents({ ...base, projectToContractEnd: true });
    expect(events.length).toBeGreaterThanOrEqual(2);
    const dates = events.map(e => e.date).sort();
    expect(new Set(dates).size).toBe(dates.length);
  });
});

describe('collectAccrualEvents owed-window backfill', () => {
  // `endingContract` ends 2026-05-31 (monthly, 30-day terms). Two weeks
  // later the engagement is over but the May invoice is still unpaid.
  const AFTER_END = '2026-06-15';

  const base = {
    contracts: [endingContract],
    leaveRows: [],
    publicHolidayDatesByEntity: new Map([
      ['autonize-it-ltd' as EntityId, new Set<string>()],
    ]),
    horizon: '2026-12-31',
    accountsByEntity,
    currencyByAccount,
    invoicedContractIds: new Set<string>(),
    unpaidInvoices: [],
    projectToContractEnd: true as const,
  };

  it('emits nothing for an ended contract without an owed-window map', () => {
    const events = collectAccrualEvents({ ...base, today: AFTER_END });
    expect(events).toHaveLength(0);
  });

  it('projects the trailing May receipt when the owed window reaches into May', () => {
    const events = collectAccrualEvents({
      ...base,
      today: AFTER_END,
      accrualWindowStartByContractId: new Map([[endingContract.id, '2026-05-01']]),
    });
    expect(events).toHaveLength(1);
    // Monthly cadence: arrival = end-of-work-month (31 May) + 30-day terms.
    expect(events[0].date).toBe('2026-06-30');
    expect(events[0].amount).toBeGreaterThan(0);
    expect(events[0].contractId).toBe(endingContract.id);
  });

  it('skips a trailing receipt whose arrival is already in the past', () => {
    // The May invoice would have arrived 2026-06-30; today is past that, so
    // the cash either landed (already in balance) or is overdue — not a
    // forward inflow.
    const events = collectAccrualEvents({
      ...base,
      today: '2026-07-15',
      accrualWindowStartByContractId: new Map([[endingContract.id, '2026-05-01']]),
    });
    expect(events).toHaveLength(0);
  });
});

describe('collectAccrualEvents with unpaid invoices', () => {
  const weeklyLfMay: Contract = parseContractRow(
    rowFromHeaders({
      ...lfFzcoContractRow,
      id: 'lf-2026-may',
      reference: 'La Fosse · May 2026',
      placement_ref: 'BH-30484',
      start_date: '2026-05-01',
      end_date: '2026-05-31',
    }),
  );

  it('accrues worked days after the latest unpaid invoice period through contract end', () => {
    const unpaid: Invoice = {
      id: 'FZ-0011',
      contract_id: weeklyLfMay.id,
      client_id: 'la-fosse',
      issuing_entity_id: 'autonize-it-fzco',
      invoice_number: 'FZ-0011',
      payment_reference: 'SB-298463',
      invoice_date: '2026-05-28',
      period_start: '2026-05-18',
      period_end: '2026-05-24',
      days_billed: 5,
      description: 'test',
      currency: 'GBP',
      subtotal: 2500,
      vat_rate: 0,
      vat_amount: 0,
      total: 2500,
      fx_rate_at_issue: null,
      fx_base_currency: null,
      mechanism: 'self-bill',
      pdf_path: null,
      status: 'issued',
      due_date: '2026-06-27',
      created_at: '2026-05-28',
      updated_at: null,
    };

    const events = collectAccrualEvents({
      contracts: [weeklyLfMay],
      leaveRows: [],
      publicHolidayDatesByEntity: new Map([
        ['autonize-it-fzco' as EntityId, new Set<string>()],
      ]),
      today: '2026-06-02',
      horizon: '2026-08-31',
      accountsByEntity: new Map([
        ['autonize-it-fzco' as EntityId, ['emirates-islamic-gbp' as AccountName]],
      ]),
      currencyByAccount: new Map([
        ['emirates-islamic-gbp' as AccountName, 'GBP'],
      ]),
      unpaidInvoices: [unpaid],
      projectToContractEnd: true,
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events.some(e => e.source === 'accrual' && e.contractId === weeklyLfMay.id)).toBe(true);
    const totalAccrued = events.reduce((sum, e) => sum + e.amount, 0);
    expect(totalAccrued).toBeGreaterThan(0);
    expect(totalAccrued).toBeLessThanOrEqual(2500);
  });
});
