import { describe, it, expect } from 'vitest';
import {
  deriveRunwayThresholdWarnings,
  RUNWAY_LOW_MONTHS_CRITICAL,
  RUNWAY_LOW_MONTHS_WARN,
} from './runway-thresholds.js';
import type { AssembledRunway } from '../forecast/assemble-runway.js';
import type {
  CurrencyCode,
  RunwayHouseholdCurrency,
} from '../../../shared/api-contracts.js';
import type { ForecastDailyPoint } from '../forecast/build-forecast.js';

function makeBlock(over: Partial<RunwayHouseholdCurrency>): RunwayHouseholdCurrency {
  return {
    currency: 'GBP',
    runwayMonthsFullRecurring: 12,
    runwayMonthsMandatoryRecurring: 18,
    firstStressDateFullRecurring: '2026-12-01',
    firstStressDateMandatoryRecurring: '2027-06-01',
    totalCashCurrent: 5000,
    totalAvailableCredit: 1000,
    ...over,
  };
}

function makeAssembled(over: {
  household?: AssembledRunway['household'];
  fullMerged?: ReadonlyMap<CurrencyCode, ForecastDailyPoint[]>;
}): AssembledRunway {
  const result = { today: '2026-01-01', horizonDays: 720, accounts: [], entities: [] };
  return {
    today: '2026-01-01',
    horizonDays: 720,
    household: over.household ?? {},
    fullRecurring: {
      result,
      mergedByCurrency: over.fullMerged ?? new Map(),
    },
    mandatoryRecurring: {
      result,
      mergedByCurrency: new Map(),
    },
  };
}

describe('runway-low threshold bands', () => {
  it('emits critical when full runway < 3 months', () => {
    const out = deriveRunwayThresholdWarnings(
      makeAssembled({
        household: { GBP: makeBlock({ runwayMonthsFullRecurring: 2.5, firstStressDateFullRecurring: '2026-03-15' }) },
      }),
    );
    const w = out.find(o => o.code === 'runway-low');
    expect(w).toBeDefined();
    expect(w?.severity).toBe('critical');
    expect(w?.context?.threshold).toBe(RUNWAY_LOW_MONTHS_CRITICAL);
  });

  it('emits warn when full runway in [3, 6) months', () => {
    const out = deriveRunwayThresholdWarnings(
      makeAssembled({
        household: { GBP: makeBlock({ runwayMonthsFullRecurring: 4.5, firstStressDateFullRecurring: '2026-05-15' }) },
      }),
    );
    const w = out.find(o => o.code === 'runway-low');
    expect(w?.severity).toBe('warn');
    expect(w?.context?.threshold).toBe(RUNWAY_LOW_MONTHS_WARN);
  });

  it('does not emit when full runway >= 6 months', () => {
    const out = deriveRunwayThresholdWarnings(
      makeAssembled({
        household: { GBP: makeBlock({ runwayMonthsFullRecurring: 12 }) },
      }),
    );
    expect(out.find(o => o.code === 'runway-low')).toBeUndefined();
  });
});

describe('runway-mandatory-low — severity cap', () => {
  it('emits critical even when bills-only runway is 4 months (cap one band higher)', () => {
    const out = deriveRunwayThresholdWarnings(
      makeAssembled({
        household: {
          GBP: makeBlock({
            runwayMonthsMandatoryRecurring: 4,
            firstStressDateMandatoryRecurring: '2026-05-01',
          }),
        },
      }),
    );
    const w = out.find(o => o.code === 'runway-mandatory-low');
    expect(w?.severity).toBe('critical');
  });

  it('does not emit when bills-only runway >= 6 months', () => {
    const out = deriveRunwayThresholdWarnings(
      makeAssembled({
        household: { GBP: makeBlock({ runwayMonthsMandatoryRecurring: 18 }) },
      }),
    );
    expect(out.find(o => o.code === 'runway-mandatory-low')).toBeUndefined();
  });
});

describe('trapped-cash — cross-currency divergence', () => {
  it('emits when one currency goes negative and another stays positive', () => {
    const out = deriveRunwayThresholdWarnings(
      makeAssembled({
        fullMerged: new Map<CurrencyCode, ForecastDailyPoint[]>([
          ['GBP', [
            { date: '2026-01-01', balance: 1000 },
            { date: '2026-06-01', balance: -500 },
          ]],
          ['AED', [
            { date: '2026-01-01', balance: 5000 },
            { date: '2026-06-01', balance: 4000 },
          ]],
        ]),
      }),
    );
    const w = out.find(o => o.code === 'trapped-cash');
    expect(w).toBeDefined();
    expect(w?.context?.stressedCurrency).toBe('GBP');
    expect(w?.context?.solventCurrencies).toContain('AED');
  });

  it('does not emit when both currencies are solvent', () => {
    const out = deriveRunwayThresholdWarnings(
      makeAssembled({
        fullMerged: new Map<CurrencyCode, ForecastDailyPoint[]>([
          ['GBP', [{ date: '2026-01-01', balance: 1000 }]],
          ['AED', [{ date: '2026-01-01', balance: 5000 }]],
        ]),
      }),
    );
    expect(out.find(o => o.code === 'trapped-cash')).toBeUndefined();
  });

  it('does not emit when both currencies are stressed (no escape valve)', () => {
    const out = deriveRunwayThresholdWarnings(
      makeAssembled({
        fullMerged: new Map<CurrencyCode, ForecastDailyPoint[]>([
          ['GBP', [{ date: '2026-06-01', balance: -100 }]],
          ['AED', [{ date: '2026-06-01', balance: -100 }]],
        ]),
      }),
    );
    expect(out.find(o => o.code === 'trapped-cash')).toBeUndefined();
  });
});
