import { describe, it, expect } from 'vitest';
import {
  computeMonthsOfBillCoverAfterPlan,
  isPlanViableAgainstBillCoverFloor,
  meetsBillCoverComfortTarget,
} from './bill-cover.js';

describe('bill-cover helpers', () => {
  it('computeMonthsOfBillCoverAfterPlan divides and rounds to cents', () => {
    expect(computeMonthsOfBillCoverAfterPlan(9000, 3000)).toBe(3);
    expect(computeMonthsOfBillCoverAfterPlan(1000, 3)).toBe(333.33);
  });

  it('returns null when typical monthly bills is not positive', () => {
    expect(computeMonthsOfBillCoverAfterPlan(5000, 0)).toBeNull();
    expect(computeMonthsOfBillCoverAfterPlan(5000, -100)).toBeNull();
  });

  it('isPlanViableAgainstBillCoverFloor treats null as viable', () => {
    expect(isPlanViableAgainstBillCoverFloor(null, 2)).toBe(true);
  });

  it('meetsBillCoverComfortTarget is false for null months', () => {
    expect(meetsBillCoverComfortTarget(null, 3)).toBe(false);
  });

  it('comfort requires at least the target months', () => {
    expect(meetsBillCoverComfortTarget(2.9, 3)).toBe(false);
    expect(meetsBillCoverComfortTarget(3, 3)).toBe(true);
  });
});
