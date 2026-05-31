import { describe, it, expect } from 'vitest';
import type {
  AccountName,
  Contract,
  CurrencyCode,
  EntityId,
} from '../../../shared/api-contracts.js';
import { collectAccrualEvents } from './collect-events.js';
import { parseContractRow } from '../contracts/csv-io.js';
import { dcSowRow, rowFromHeaders } from '../contracts/test-helpers.js';

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
