import { describe, expect, it } from 'vitest';
import { computeFinancialSafety } from './compute.js';
import type { FinancialSafetyInput } from './types.js';

function baseInput(over: Partial<FinancialSafetyInput> = {}): FinancialSafetyInput {
  return {
    totalCashGbp: 80_000,
    totalCommittedGbp: 40_000,
    cashAfterCommitmentsGbp: 40_000,
    runwayMonthsFullRecurring: 18,
    verdictKind: 'safe',
    topClientShareOfActiveMonthly: 0.35,
    outstandingInvoicesGbp: 10_000,
    budgetNudgeCount: 0,
    debtMinAvailableHeadroomRatio: 0.6,
    warnings: [],
    ...over,
  };
}

describe('computeFinancialSafety', () => {
  it('high cash with commitments much larger than cash yields low pillar A and low headline', () => {
    const r = computeFinancialSafety(
      baseInput({
        totalCashGbp: 36_000,
        totalCommittedGbp: 180_000,
        cashAfterCommitmentsGbp: -144_000,
      }),
    );
    expect(r.pillars[0].id).toBe('A');
    expect(r.pillars[0].contribution).toBeLessThanOrEqual(2);
    expect(r.baseScoreBeforeWarnings).toBeLessThan(7);
  });

  it('pillar A can be sound without warnings', () => {
    const r = computeFinancialSafety(
      baseInput({
        warnings: [],
        cashAfterCommitmentsGbp: 50_000,
        totalCommittedGbp: 100_000,
      }),
    );
    expect(r.pillars[0].contribution).toBeGreaterThanOrEqual(8);
    expect(r.warningAdjustment.pointsDeducted).toBe(0);
  });

  it('warnings-only modifier reduces score from an otherwise strong base', () => {
    const strong = computeFinancialSafety(baseInput());
    const withWarnings = computeFinancialSafety(
      baseInput({
        warnings: [
          { id: 'w1', code: 'runway-below-threshold', severity: 'critical' },
          { id: 'w2', code: 'obligation-missed', severity: 'warn' },
        ],
      }),
    );
    expect(withWarnings.score).toBeLessThan(strong.score);
    expect(withWarnings.warningAdjustment.linkedWarnings).toHaveLength(2);
    expect(withWarnings.warningAdjustment.pointsDeducted).toBeGreaterThan(0);
  });

  it('runway stress and deficit verdict cap pillar B', () => {
    const stressed = computeFinancialSafety(
      baseInput({
        runwayMonthsFullRecurring: 8,
        verdictKind: 'runway_stressed',
      }),
    );
    expect(stressed.pillars[1].contribution).toBeLessThanOrEqual(6);

    const def = computeFinancialSafety(
      baseInput({
        runwayMonthsFullRecurring: 2,
        verdictKind: 'deficit_imminent',
      }),
    );
    expect(def.pillars[1].contribution).toBeLessThanOrEqual(3);
  });

  it('clamps final score to 0–10', () => {
    const r = computeFinancialSafety(
      baseInput({
        totalCashGbp: 0,
        cashAfterCommitmentsGbp: -500_000,
        totalCommittedGbp: 600_000,
        runwayMonthsFullRecurring: 0,
        verdictKind: 'negative_after_commitments',
        warnings: Array.from({ length: 12 }, (_, i) => ({
          id: `c${i}`,
          code: 'data-quality-gap',
          severity: 'critical' as const,
        })),
      }),
    );
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(10);
    expect(r.warningAdjustment.pointsDeducted).toBeLessThanOrEqual(7);
  });

  it('propagates optional fingerprint into linkedWarnings', () => {
    const r = computeFinancialSafety(
      baseInput({
        warnings: [
          { id: 'w1', code: 'runway-below-threshold', severity: 'critical', fingerprint: 'a'.repeat(32) },
        ],
      }),
    );
    expect(r.warningAdjustment.linkedWarnings[0]).toMatchObject({
      id: 'w1',
      code: 'runway-below-threshold',
      fingerprint: 'a'.repeat(32),
    });
  });

  it('exposes formulaVersion 1.0.0', () => {
    expect(computeFinancialSafety(baseInput()).formulaVersion).toBe('1.0.0');
  });
});
