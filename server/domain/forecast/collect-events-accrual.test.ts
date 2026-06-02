import { describe, it, expect } from 'vitest';
import type {
  AccountName,
  Contract,
  CurrencyCode,
  EntityId,
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

  it('rolls an overdue trailing receipt forward to expected-now (today+1)', () => {
    // The May work would have arrived 2026-06-30; today is past that, so the
    // worked-but-unpaid tail is overdue. Like an overdue invoice, it rolls
    // forward to today+1 rather than being dropped, so the cash still surfaces
    // as a forward inflow.
    const events = collectAccrualEvents({
      ...base,
      today: '2026-07-15',
      accrualWindowStartByContractId: new Map([[endingContract.id, '2026-05-01']]),
    });
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe('2026-07-16');
    expect(events[0].amount).toBeGreaterThan(0);
    expect(events[0].contractId).toBe(endingContract.id);
  });
});

describe('collectAccrualEvents owed window after the latest invoiced period', () => {
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

  it('accrues only the worked days after the owed-window start through contract end', () => {
    // Upstream resolved the owed window to 2026-05-25 (the day after the last
    // invoiced period_end 2026-05-24). collectAccrualEvents is a dumb consumer
    // of that anchor — it must not re-derive it from invoices.
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
      accrualWindowStartByContractId: new Map([[weeklyLfMay.id, '2026-05-25']]),
      projectToContractEnd: true,
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events.some(e => e.source === 'accrual' && e.contractId === weeklyLfMay.id)).toBe(true);
    const totalAccrued = events.reduce((sum, e) => sum + e.amount, 0);
    expect(totalAccrued).toBeGreaterThan(0);
    // Only the 25–31 May tail, not the whole month.
    expect(totalAccrued).toBeLessThanOrEqual(2500);
  });
});
