/**
 * Unit tests for the canonical "future income" primitive.
 *
 * Drives `projectIncomeForWindow` against synthetic event streams by
 * mocking `assembleForecastEvents`. The intent is to lock the
 * window-filter + bucketing behaviour, not the underlying
 * forecast-event composition (which has its own dedicated tests in
 * collect-events.test.ts).
 */

import { describe, it, expect, vi } from 'vitest';
import type { ForecastEvent } from './events.js';

const assembleForecastEventsMock = vi.fn<(...args: unknown[]) => ForecastEvent[]>();

vi.mock('./assemble-forecast-events.js', () => ({
  assembleForecastEvents: (...args: unknown[]) => assembleForecastEventsMock(...args),
}));

const loadForecastInputsMock = vi.fn();
vi.mock('./load-inputs.js', () => ({
  loadForecastInputs: () => loadForecastInputsMock(),
}));

import {
  projectIncomeForWindow,
  bucketKey,
  scopeForAccount,
} from './project-income.js';

function preLoaded() {
  return {
    today: '2026-04-25',
    horizon: '2026-06-24',
    horizonDays: 60,
    startingBalances: [],
    obligations: [],
    pipeline: {} as never,
    upcomingBuckets: { thisMonth: [], thisYear: [] } as never,
    unpaidInvoices: [],
    contracts: [],
    accrualWindowStartByContractId: new Map(),
    leaveRows: [],
    publicHolidayDatesByEntity: new Map() as never,
    currencyByAccount: new Map() as never,
    accountsByEntity: new Map() as never,
    defaultAccountByType: new Map() as never,
    allowedAccountSet: new Set() as never,
  };
}

function ev(over: Partial<ForecastEvent> & Pick<ForecastEvent, 'date' | 'amount'>): ForecastEvent {
  return {
    date: over.date,
    amount: over.amount,
    account: over.account ?? 'barclays-current',
    currency: over.currency ?? 'GBP',
    source: over.source ?? 'accrual',
    label: over.label ?? 'test event',
  };
}

describe('projectIncomeForWindow — in/out window', () => {
  it('an in-window accrual event lands in the correct bucket', () => {
    assembleForecastEventsMock.mockReturnValue([
      ev({
        date: '2026-05-15', // 20d after today
        amount: 13200,
        account: 'barclays-current',
        currency: 'GBP',
        source: 'accrual',
      }),
    ]);
    const out = projectIncomeForWindow({
      from: '2026-04-25',
      to: '2026-05-25',
      preLoaded: preLoaded(),
    });
    expect(out.byBucket.size).toBe(1);
    expect(out.byBucket.get(bucketKey('GBP', 'autonize-it-ltd'))).toBe(13200);
    expect(out.contributingEvents).toHaveLength(1);
  });

  it('an event before `from` is excluded', () => {
    assembleForecastEventsMock.mockReturnValue([
      ev({ date: '2026-04-20', amount: 5000 }),
    ]);
    const out = projectIncomeForWindow({
      from: '2026-04-25',
      to: '2026-05-25',
      preLoaded: preLoaded(),
    });
    expect(out.byBucket.size).toBe(0);
  });

  it('an event on or after `to` is excluded (exclusive upper bound)', () => {
    assembleForecastEventsMock.mockReturnValue([
      ev({ date: '2026-05-25', amount: 5000 }),  // exactly `to`
      ev({ date: '2026-06-01', amount: 5000 }),  // beyond `to`
    ]);
    const out = projectIncomeForWindow({
      from: '2026-04-25',
      to: '2026-05-25',
      preLoaded: preLoaded(),
    });
    expect(out.byBucket.size).toBe(0);
  });
});

describe('projectIncomeForWindow — sign filtering', () => {
  it('negative amounts are excluded (income-only)', () => {
    assembleForecastEventsMock.mockReturnValue([
      ev({ date: '2026-05-15', amount: -2000, source: 'obligation' }),
      ev({ date: '2026-05-15', amount: 5000, source: 'invoice-receipt' }),
    ]);
    const out = projectIncomeForWindow({
      from: '2026-04-25',
      to: '2026-05-25',
      preLoaded: preLoaded(),
    });
    expect(out.byBucket.get(bucketKey('GBP', 'autonize-it-ltd'))).toBe(5000);
    expect(out.contributingEvents).toHaveLength(1);
  });

  it('zero-amount events are excluded', () => {
    assembleForecastEventsMock.mockReturnValue([
      ev({ date: '2026-05-15', amount: 0 }),
    ]);
    const out = projectIncomeForWindow({
      from: '2026-04-25',
      to: '2026-05-25',
      preLoaded: preLoaded(),
    });
    expect(out.byBucket.size).toBe(0);
  });
});

describe('projectIncomeForWindow — bucketing', () => {
  it('AED accrual on a FZCO account lands in the AED::autonize-it-fzco bucket', () => {
    assembleForecastEventsMock.mockReturnValue([
      ev({
        date: '2026-05-15',
        amount: 50000,
        account: 'emirates-islamic',
        currency: 'AED',
        source: 'accrual',
      }),
    ]);
    const out = projectIncomeForWindow({
      from: '2026-04-25',
      to: '2026-05-25',
      preLoaded: preLoaded(),
    });
    expect(out.byBucket.get(bucketKey('AED', 'autonize-it-fzco'))).toBe(50000);
  });

  it('multi-currency events split into separate buckets', () => {
    assembleForecastEventsMock.mockReturnValue([
      ev({ date: '2026-05-15', amount: 13200, account: 'barclays-current', currency: 'GBP' }),
      ev({ date: '2026-05-15', amount: 50000, account: 'emirates-islamic', currency: 'AED' }),
      ev({ date: '2026-05-15', amount: 1500, account: 'natwest', currency: 'GBP' }),
    ]);
    const out = projectIncomeForWindow({
      from: '2026-04-25',
      to: '2026-05-25',
      preLoaded: preLoaded(),
    });
    expect(out.byBucket.get(bucketKey('GBP', 'autonize-it-ltd'))).toBe(13200);
    expect(out.byBucket.get(bucketKey('AED', 'autonize-it-fzco'))).toBe(50000);
    expect(out.byBucket.get(bucketKey('GBP', 'household'))).toBe(1500);
  });

  it('multiple events on the same bucket sum', () => {
    assembleForecastEventsMock.mockReturnValue([
      ev({ date: '2026-05-01', amount: 5000 }),
      ev({ date: '2026-05-15', amount: 7000 }),
      ev({ date: '2026-05-20', amount: 1000 }),
    ]);
    const out = projectIncomeForWindow({
      from: '2026-04-25',
      to: '2026-05-25',
      preLoaded: preLoaded(),
    });
    expect(out.byBucket.get(bucketKey('GBP', 'autonize-it-ltd'))).toBe(13000);
  });
});

describe('projectIncomeForWindow — bucketFilter', () => {
  it('bucketFilter.currency narrows to the requested currency', () => {
    assembleForecastEventsMock.mockReturnValue([
      ev({ date: '2026-05-15', amount: 10000, currency: 'GBP' }),
      ev({ date: '2026-05-15', amount: 50000, account: 'emirates-islamic', currency: 'AED' }),
    ]);
    const out = projectIncomeForWindow({
      from: '2026-04-25',
      to: '2026-05-25',
      preLoaded: preLoaded(),
      bucketFilter: { currency: 'GBP' },
    });
    expect(out.byBucket.get(bucketKey('GBP', 'autonize-it-ltd'))).toBe(10000);
    expect(out.byBucket.has(bucketKey('AED', 'autonize-it-fzco'))).toBe(false);
  });

  it('bucketFilter.scope narrows to the requested scope', () => {
    assembleForecastEventsMock.mockReturnValue([
      ev({ date: '2026-05-15', amount: 10000, account: 'barclays-current', currency: 'GBP' }),
      ev({ date: '2026-05-15', amount: 1500, account: 'natwest', currency: 'GBP' }),
    ]);
    const out = projectIncomeForWindow({
      from: '2026-04-25',
      to: '2026-05-25',
      preLoaded: preLoaded(),
      bucketFilter: { scope: 'household' },
    });
    expect(out.byBucket.get(bucketKey('GBP', 'household'))).toBe(1500);
    expect(out.byBucket.has(bucketKey('GBP', 'autonize-it-ltd'))).toBe(false);
  });
});

describe('scopeForAccount — invariants', () => {
  it('business accounts return their entity id', () => {
    expect(scopeForAccount('barclays-current')).toBe('autonize-it-ltd');
    expect(scopeForAccount('emirates-islamic')).toBe('autonize-it-fzco');
  });

  it('personal accounts return household', () => {
    expect(scopeForAccount('natwest')).toBe('household');
    expect(scopeForAccount('monzo-joint')).toBe('household');
  });
});
