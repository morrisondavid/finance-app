import { describe, it, expect } from 'vitest';
import {
  resolveStrategyPlanningEndDate,
  approxStrategyPeriodMonths,
  buildHolisticStrategyRollup,
} from './strategy-capital.js';
import type { StrategyCapitalBucketSnapshot } from './strategy-capital.js';

describe('buildHolisticStrategyRollup', () => {
  it('sets holistic debt money to the usable pool (after 2× bills), not the FX row-sum of money_for_debt_strategy', () => {
    const row: StrategyCapitalBucketSnapshot = {
      key: 'GBP::household',
      currency: 'GBP',
      scope: 'household',
      strategy_end_date: '2026-12-01',
      deployable_money_now: 10_000,
      money_expected_in_period: 0,
      fixed_bills_in_period: 0,
      surplus_in_period: 0,
      money_for_debt_strategy: 50_000,
      typical_monthly_bills: 1_000,
      monthly_standing_order_drain: 0,
      money_available_after_plan: 0,
      months_of_bill_cover_after_plan: 6,
      bill_cover_viable: true,
      bill_cover_meets_comfort_target: true,
    };
    const h = buildHolisticStrategyRollup([row]);
    expect(h.usable_for_debt_paydown).toBe(8000);
    expect(h.holistic_money_for_debt_gbp).toBe(h.usable_for_debt_paydown);
    expect(h.holistic_per_scope_row_sum_gbp).toBe(50_000);
  });
});

describe('resolveStrategyPlanningEndDate', () => {
  it('shifts today forward by maxPlanningDays', () => {
    expect(resolveStrategyPlanningEndDate({ today: '2026-05-01', maxPlanningDays: 30 })).toBe(
      '2026-05-31',
    );
  });

  it('caps at hard end for large maxPlanningDays (no contract horizon)', () => {
    expect(resolveStrategyPlanningEndDate({ today: '2026-05-01', maxPlanningDays: 100 })).toBe(
      '2026-08-09',
    );
  });

  it('returns today when shift would not advance past today', () => {
    expect(resolveStrategyPlanningEndDate({ today: '2026-05-01', maxPlanningDays: 0 })).toBe(
      '2026-05-01',
    );
  });
});

describe('approxStrategyPeriodMonths', () => {
  it('returns at least 1', () => {
    expect(approxStrategyPeriodMonths('2026-05-01', '2026-05-01')).toBe(1);
    expect(approxStrategyPeriodMonths('not-a-date', '2026-05-01')).toBe(1);
  });

  it('ceil partial months from midpoint timestamps', () => {
    expect(approxStrategyPeriodMonths('2026-05-01', '2026-06-15')).toBe(2);
  });
});
