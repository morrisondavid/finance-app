/**
 * Isolated tests for {@link assembleRunwayScenario}: mocked forecast inputs and
 * event assembly so exclusion filtering is deterministic.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { AccountName } from '../../../shared/api-contracts.js';
import type { ForecastEvent } from './events.js';
import type { PipelineResult } from '../../utils/recurring-pipeline.js';

const { loadForecastInputsMock, assembleForecastEventsMock } = vi.hoisted(() => ({
  loadForecastInputsMock: vi.fn(),
  assembleForecastEventsMock: vi.fn(),
}));

vi.mock('./load-inputs.js', () => ({
  loadForecastInputs: () => loadForecastInputsMock(),
}));

vi.mock('./assemble-forecast-events.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./assemble-forecast-events.js')>();
  return {
    ...actual,
    assembleForecastEvents: () => assembleForecastEventsMock(),
  };
});

const emptyPipeline: PipelineResult = {
  expenseCandidates: [],
  incomeCandidates: [],
  expenseAccumulators: new Map(),
  incomeAccumulators: new Map(),
  monthlyExpenseRecurring: [],
  annualExpenseRecurring: [],
  monthlyIncomeRecurring: [],
  annualIncomeRecurring: [],
  monthsCovered: 12,
};

function baseLoad() {
  return {
    today: '2026-01-01',
    horizon: '2026-12-31',
    horizonDays: 60,
    startingBalances: [
      {
        account: 'natwest' as AccountName,
        balance: 1000,
        currency: 'GBP' as const,
        entityId: null,
      },
    ],
    obligations: [],
    pipeline: emptyPipeline,
    upcomingBuckets: { thisMonth: [], thisYear: [] },
    unpaidInvoices: [],
    contracts: [],
    leaveRows: [],
    publicHolidayDatesByEntity: new Map(),
    currencyByAccount: new Map<AccountName, 'GBP'>([['natwest', 'GBP']]),
    accountsByEntity: new Map(),
    defaultAccountByType: new Map(),
    allowedAccountSet: new Set<AccountName>(['natwest']),
  };
}

let assembleRunwayScenario: typeof import('./assemble-runway.js').assembleRunwayScenario;

beforeAll(async () => {
  ({ assembleRunwayScenario } = await import('./assemble-runway.js'));
});

beforeEach(() => {
  loadForecastInputsMock.mockReturnValue(baseLoad());
  assembleForecastEventsMock.mockReset();
});

describe('assembleRunwayScenario', () => {
  it('returns earlier stress when a large accrual contract is excluded', () => {
    const accrualPad: ForecastEvent = {
      date: '2026-01-04',
      amount: 8000,
      account: 'natwest',
      currency: 'GBP',
      source: 'accrual',
      label: 'Accrual pad',
      contractId: 'pad-contract',
    };
    const bill: ForecastEvent = {
      date: '2026-01-05',
      amount: -5000,
      account: 'natwest',
      currency: 'GBP',
      source: 'obligation',
      label: 'Tax',
    };
    assembleForecastEventsMock.mockReturnValue([accrualPad, bill]);

    const padded = assembleRunwayScenario({
      excludedContractIds: [],
      excludedRecurringIncomeKeys: [],
    });
    const stripped = assembleRunwayScenario({
      excludedContractIds: ['pad-contract'],
      excludedRecurringIncomeKeys: [],
    });

    expect(padded.firstStressDate).toBeNull();
    expect(stripped.firstStressDate).toBe('2026-01-05');
  });
});
