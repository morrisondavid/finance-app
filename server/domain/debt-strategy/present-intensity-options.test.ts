import { describe, it, expect } from 'vitest';
import { presentIntensityOptions } from './present-intensity-options.js';

describe('presentIntensityOptions — ASAP goals', () => {
  it('returns 95/50/15 percentages of headroom, capped at £100 for Passive', () => {
    const out = presentIntensityOptions({
      availableHeadroom: 1000,
      goal: { goalType: 'pay-off-debt', targetDateOrAsap: 'ASAP', targetAmount: 5000 },
      today: '2026-04-25',
    });
    expect(out.aggressive.monthlyAllocation).toBe(950);
    expect(out.medium.monthlyAllocation).toBe(500);
    // 15% of 1000 = 150 > 100 floor → 100
    expect(out.passive.monthlyAllocation).toBe(100);
    expect(out.feasible).toBe(true);
  });

  it('Passive falls below £100 only when 15% of headroom is below it', () => {
    const out = presentIntensityOptions({
      availableHeadroom: 500, // 15% = £75 < £100 → 75 wins
      goal: { goalType: 'pay-off-debt', targetDateOrAsap: 'ASAP', targetAmount: 5000 },
      today: '2026-04-25',
    });
    expect(out.passive.monthlyAllocation).toBe(75);
  });

  it('all options are 0 when headroom is 0', () => {
    const out = presentIntensityOptions({
      availableHeadroom: 0,
      goal: { goalType: 'pay-off-debt', targetDateOrAsap: 'ASAP', targetAmount: 5000 },
      today: '2026-04-25',
    });
    expect(out.aggressive.monthlyAllocation).toBe(0);
    expect(out.medium.monthlyAllocation).toBe(0);
    expect(out.passive.monthlyAllocation).toBe(0);
    expect(out.feasible).toBe(true); // ASAP with no headroom is technically feasible (just won't progress)
  });

  it('projected completion date scales with the allocation', () => {
    const out = presentIntensityOptions({
      availableHeadroom: 1000,
      goal: { goalType: 'pay-off-debt', targetDateOrAsap: 'ASAP', targetAmount: 1000 },
      today: '2026-01-01',
    });
    // Aggressive £950/mo → ~1.05 months → ~mid Feb 2026
    // Medium £500/mo → 2 months → 2026-03-01
    // Passive £100/mo → 10 months → 2026-11-01
    expect(out.aggressive.projectedCompletionDate?.startsWith('2026-02')).toBe(true);
    expect(out.medium.projectedCompletionDate?.startsWith('2026-03')).toBe(true);
    expect(out.passive.projectedCompletionDate?.startsWith('2026-11')).toBe(true);
  });
});

describe('presentIntensityOptions — fixed-date goals', () => {
  it('stretches each option upward to honour the deadline minimum', () => {
    // £6000 goal in ~6 months ≈ £1000/mo required (modulo 30.44-day month math).
    // Headroom £2000 → 95% = £1900, 50% = £1000, 15% = £100.
    // After stretch: all options are ≥ deadline minimum.
    const out = presentIntensityOptions({
      availableHeadroom: 2000,
      goal: {
        goalType: 'save-for-target',
        targetDateOrAsap: '2026-10-25',
        targetAmount: 6000,
      },
      today: '2026-04-25',
    });
    // Approx £998 deadline minimum (6 months × 30.44 days = 182.6 days actual).
    expect(out.aggressive.monthlyAllocation).toBeGreaterThan(900);
    expect(out.medium.monthlyAllocation).toBeGreaterThan(900);
    expect(out.passive.monthlyAllocation).toBeGreaterThan(900);
    expect(out.feasible).toBe(true);
    // Aggressive 95% (£1900) > deadline minimum, no stretch needed.
    expect(out.aggressive.monthlyAllocation).toBe(1900);
    // Medium 50% (£1000) is ABOVE the £998 minimum — no stretch needed; remains 1000.
    expect(out.medium.monthlyAllocation).toBe(1000);
    // Passive £100 is BELOW the deadline minimum — stretched up to ~£998.
    expect(out.passive.monthlyAllocation).toBeGreaterThan(900);
    expect(out.passive.monthlyAllocation).toBeLessThan(1010);
  });

  it('feasible:false when even the entire headroom cannot hit the deadline', () => {
    // £10000 in 6 months = £1666.67/mo required, but headroom is only £500.
    const out = presentIntensityOptions({
      availableHeadroom: 500,
      goal: {
        goalType: 'save-for-target',
        targetDateOrAsap: '2026-10-25',
        targetAmount: 10000,
      },
      today: '2026-04-25',
    });
    expect(out.feasible).toBe(false);
    expect(out.aggressive.monthlyAllocation).toBe(500);
    expect(out.medium.monthlyAllocation).toBe(500);
    expect(out.passive.monthlyAllocation).toBe(500);
  });

  it('feasible:false when deadline is in the past', () => {
    const out = presentIntensityOptions({
      availableHeadroom: 1000,
      goal: {
        goalType: 'save-for-target',
        targetDateOrAsap: '2025-01-01',
        targetAmount: 5000,
      },
      today: '2026-04-25',
    });
    expect(out.feasible).toBe(false);
  });

  it('Aggressive uses 95% when 95% already exceeds the deadline minimum', () => {
    // Headroom £2000, 95% = £1900. Deadline ~12 months at 30.44 days/mo ≈ £500/mo.
    // No stretch for aggressive (1900 > 500); medium 1000 stays (1000 > 500);
    // passive £100 floor stretches up to ~£500.
    const out = presentIntensityOptions({
      availableHeadroom: 2000,
      goal: {
        goalType: 'save-for-target',
        targetDateOrAsap: '2027-04-25',
        targetAmount: 6000,
      },
      today: '2026-04-25',
    });
    expect(out.aggressive.monthlyAllocation).toBe(1900);
    expect(out.medium.monthlyAllocation).toBe(1000);
    // Passive stretched from £100 floor up to the deadline minimum (~£500).
    expect(out.passive.monthlyAllocation).toBeGreaterThan(490);
    expect(out.passive.monthlyAllocation).toBeLessThan(510);
  });
});

describe('presentIntensityOptions — projected completion date', () => {
  it('returns null when allocation or target is 0', () => {
    const out = presentIntensityOptions({
      availableHeadroom: 0,
      goal: { goalType: 'pay-off-debt', targetDateOrAsap: 'ASAP', targetAmount: 5000 },
      today: '2026-04-25',
    });
    expect(out.aggressive.projectedCompletionDate).toBeNull();
  });
});
