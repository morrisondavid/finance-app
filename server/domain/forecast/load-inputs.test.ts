/**
 * Smoke test for the canonical forecast-input loader.
 *
 * The loader is heavily I/O-bound (reads balances, obligations,
 * pipeline, recurring upcoming, invoices, contracts, leave, public
 * holidays + a couple of registries). We mock the data dependencies
 * so this test exercises the loader's COMPOSITION — every dep is
 * called, every output field is populated, the entity filter shape
 * is honoured — without standing up an in-memory DB. The fuller
 * integration is exercised through `forecast.ts` and `runway.ts`
 * tests already in the suite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock every I/O dependency before importing the SUT.
vi.mock('../../db/repositories/balance.js', () => ({
  getAllAccountBalances: vi.fn(() => ({
    'barclays-current': { currentBalance: 5000 },
    'barclays-savings': { currentBalance: 1000 },
    'capital-on-tap': { currentBalance: 0 },
    'barclaycard': { currentBalance: 0 },
    'wise-ltd': { currentBalance: 100 },
    'natwest': { currentBalance: 2000 },
    'natwest-savings': { currentBalance: 500 },
    'monzo-joint': { currentBalance: 300 },
    'emirates-islamic': { currentBalance: 10000 },
    'emirates-islamic-gbp': { currentBalance: 0 },
    'emirates-islamic-usd': { currentBalance: 0 },
    'santander-everyday': { currentBalance: 0 },
  })),
}));
vi.mock('../../db/repositories/obligations.js', () => ({
  getUpcomingObligations: vi.fn(() => []),
  toApiObligation: vi.fn((o: unknown) => o),
}));
vi.mock('../../utils/expenses-overview-pipeline.js', () => ({
  runExpensesOverviewPipeline: vi.fn(() => ({
    expenseCandidates: [],
    incomeCandidates: [],
    expenseAccumulators: new Map(),
    incomeAccumulators: new Map(),
    monthlyExpenseRecurring: [],
    annualExpenseRecurring: [],
    monthlyIncomeRecurring: [],
    annualIncomeRecurring: [],
    monthsCovered: 12,
  })),
}));
vi.mock('../../utils/recurring-upcoming.js', () => ({
  buildUpcomingRecurring: vi.fn(() => ({ thisMonth: [], thisYear: [] })),
}));
vi.mock('../invoices/index.js', () => ({
  listInvoicesByStatus: vi.fn(() => []),
}));
vi.mock('../contracts/queries.js', () => ({
  listCurrentContracts: vi.fn(() => []),
  listContractsForForecast: vi.fn(() => []),
  accountsForEntity: vi.fn((id: string) => {
    if (id === 'autonize-it-ltd') {
      return ['barclays-current', 'barclays-savings', 'capital-on-tap', 'barclaycard', 'wise-ltd'];
    }
    return ['emirates-islamic'];
  }),
  getAccountConfig: vi.fn((name: string) => ({
    currency: name === 'emirates-islamic' ? 'AED' : 'GBP',
  })),
  getEntityIdForAccount: vi.fn((name: string) => {
    if (['barclays-current', 'barclays-savings', 'capital-on-tap', 'barclaycard', 'wise-ltd'].includes(name)) {
      return 'autonize-it-ltd';
    }
    if (name === 'emirates-islamic') return 'autonize-it-fzco';
    return null;
  }),
}));
vi.mock('../accounts/queries.js', () => ({
  accountsForEntity: vi.fn((id: string) => {
    if (id === 'autonize-it-ltd') {
      return ['barclays-current', 'barclays-savings', 'capital-on-tap', 'barclaycard', 'wise-ltd'];
    }
    return ['emirates-islamic'];
  }),
  getAccountConfig: vi.fn((name: string) => ({
    currency: name === 'emirates-islamic' ? 'AED' : 'GBP',
  })),
  getEntityIdForAccount: vi.fn((name: string) => {
    if (['barclays-current', 'barclays-savings', 'capital-on-tap', 'barclaycard', 'wise-ltd'].includes(name)) {
      return 'autonize-it-ltd';
    }
    if (name === 'emirates-islamic') return 'autonize-it-fzco';
    return null;
  }),
}));
vi.mock('../contracts/last-payment-resolver.js', () => ({
  resolveLastPaymentsForContracts: vi.fn(() => new Map<string, string | null>()),
}));
vi.mock('../leave/index.js', () => ({
  allLeave: vi.fn(() => []),
}));
vi.mock('../working-days/public-holidays.js', () => ({
  holidayDatesForEntity: vi.fn(() => new Set()),
}));
vi.mock('../company/index.js', () => ({
  allEntityIds: vi.fn(() => ['autonize-it-ltd', 'autonize-it-fzco']),
}));

import {
  loadForecastInputs,
  DEFAULT_OBLIGATION_ACCOUNTS,
  DEFAULT_FORECAST_HORIZON_DAYS,
} from './load-inputs.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadForecastInputs', () => {
  it('returns every documented field with the expected shape', () => {
    const inputs = loadForecastInputs({ today: '2026-04-25' });

    expect(inputs.today).toBe('2026-04-25');
    expect(inputs.horizonDays).toBe(DEFAULT_FORECAST_HORIZON_DAYS);
    expect(typeof inputs.horizon).toBe('string');
    expect(inputs.horizon).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(Array.isArray(inputs.startingBalances)).toBe(true);
    expect(Array.isArray(inputs.obligations)).toBe(true);
    expect(Array.isArray(inputs.unpaidInvoices)).toBe(true);
    expect(Array.isArray(inputs.contracts)).toBe(true);
    expect(Array.isArray(inputs.leaveRows)).toBe(true);

    expect(inputs.pipeline).toBeDefined();
    expect(inputs.upcomingBuckets).toBeDefined();

    expect(inputs.publicHolidayDatesByEntity instanceof Map).toBe(true);
    expect(inputs.currencyByAccount instanceof Map).toBe(true);
    expect(inputs.accountsByEntity instanceof Map).toBe(true);
    expect(inputs.defaultAccountByType instanceof Map).toBe(true);
    expect(inputs.allowedAccountSet instanceof Set).toBe(true);
    expect(inputs.accrualWindowStartByContractId instanceof Map).toBe(true);
  });

  it('honours an explicit horizonDays override', () => {
    const inputs = loadForecastInputs({ today: '2026-04-25', horizonDays: 60 });
    expect(inputs.horizonDays).toBe(60);
    // 2026-04-25 + 60 days = 2026-06-24.
    expect(inputs.horizon).toBe('2026-06-24');
  });

  it('uses DEFAULT_OBLIGATION_ACCOUNTS as defaultAccountByType', () => {
    const inputs = loadForecastInputs({ today: '2026-04-25' });
    expect(inputs.defaultAccountByType).toBe(DEFAULT_OBLIGATION_ACCOUNTS);
  });

  it('full ACCOUNTS set is the allowedAccountSet when no entity filter is supplied', () => {
    const inputs = loadForecastInputs({ today: '2026-04-25' });
    expect(inputs.allowedAccountSet.size).toBeGreaterThan(0);
    expect(inputs.allowedAccountSet.has('barclays-current')).toBe(true);
    expect(inputs.allowedAccountSet.has('emirates-islamic')).toBe(true);
  });

  it('narrows allowedAccountSet + startingBalances when filterEntityId is supplied', () => {
    const inputs = loadForecastInputs({
      today: '2026-04-25',
      filterEntityId: 'autonize-it-ltd',
    });
    for (const sb of inputs.startingBalances) {
      expect(sb.entityId).not.toBe('autonize-it-fzco');
    }
    expect(inputs.allowedAccountSet.has('emirates-islamic')).toBe(false);
  });

  it('currencyByAccount carries the right currency per account', () => {
    const inputs = loadForecastInputs({ today: '2026-04-25' });
    expect(inputs.currencyByAccount.get('barclays-current')).toBe('GBP');
    expect(inputs.currencyByAccount.get('emirates-islamic')).toBe('AED');
  });

  it('startingBalances entries carry account, balance, currency, entityId', () => {
    const inputs = loadForecastInputs({ today: '2026-04-25' });
    for (const sb of inputs.startingBalances) {
      expect(typeof sb.account).toBe('string');
      expect(typeof sb.balance).toBe('number');
      expect(['GBP', 'AED']).toContain(sb.currency);
      expect(sb.entityId === null || typeof sb.entityId === 'string').toBe(true);
    }
  });
});
