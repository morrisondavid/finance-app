import { describe, it, expect } from 'vitest';
import {
  resolveStrategyPlanningEndDate,
  approxStrategyPeriodMonths,
} from './strategy-capital.js';

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
