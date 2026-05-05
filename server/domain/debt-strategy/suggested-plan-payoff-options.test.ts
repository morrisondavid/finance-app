import { describe, it, expect } from 'vitest';
import { buildSuggestedPlanPayoffOptions } from './suggested-plan-payoff-options.js';

describe('buildSuggestedPlanPayoffOptions', () => {
  it('returns three intensity rows using the shared proposal kernel', () => {
    const suggested = {
      id: 'suggested:test-debt',
      display_name: 'Clear Test',
      goal_type: 'pay-off-debt' as const,
      target_id: 'test-debt',
      target_amount: null,
      target_account: 'barclays-current' as const,
      target_date_or_asap: 'ASAP' as const,
      currency: 'GBP' as const,
      scope: 'household' as const,
      intensity: 'medium' as const,
      monthly_allocation: 350,
      activated_at: '2026-05-01',
      completed_at: null,
      projected_completion_date: '2027-01-01',
      notes: null,
      updated_at: '2026-05-01',
      status: 'suggested' as const,
    };

    const po = buildSuggestedPlanPayoffOptions({
      suggested,
      debt: {
        id: 'test-debt',
        currentBalance: 6000,
        matchAmounts: [100],
      },
      availableHeadroom: 800,
      holisticMoneyForDebt: 0,
      strategyPeriodApproxMonths: 12,
      today: '2026-05-01',
    });

    expect(po.baseline_monthly).toBe(100);
    expect(po.current_balance).toBe(6000);
    const kinds = po.intensities.map(r => r.intensity).sort();
    expect(kinds).toEqual(['aggressive', 'medium', 'passive']);
    for (const row of po.intensities) {
      expect(row.monthly_total).toBeGreaterThanOrEqual(row.supplemental_monthly + 100 - 0.01);
      expect(row.monthly_total).toBeGreaterThan(100);
    }
  });

  it('includes one_shot when a lump amount is provided', () => {
    const suggested = {
      id: 'suggested:x',
      display_name: 'Clear X',
      goal_type: 'pay-off-debt' as const,
      target_id: 'x',
      target_amount: null,
      target_account: 'barclays-current' as const,
      target_date_or_asap: 'ASAP' as const,
      currency: 'GBP' as const,
      scope: 'household' as const,
      intensity: 'medium' as const,
      monthly_allocation: 400,
      activated_at: '2026-05-01',
      completed_at: null,
      projected_completion_date: null,
      notes: null,
      updated_at: '2026-05-01',
      status: 'suggested' as const,
    };

    const po = buildSuggestedPlanPayoffOptions({
      suggested,
      debt: { id: 'x', currentBalance: 5000, matchAmounts: [50] },
      availableHeadroom: 600,
      holisticMoneyForDebt: 0,
      strategyPeriodApproxMonths: 12,
      today: '2026-05-01',
      oneShotLumpAmount: 1000,
    });

    expect(po.one_shot).not.toBeNull();
    expect(po.one_shot?.amount).toBe(1000);
  });

  it('uses matchAmounts[0] only as contractual monthly baseline (Novuna-style multi-entry)', () => {
    const suggested = {
      id: 'suggested:novuna',
      display_name: 'Clear Novuna',
      goal_type: 'pay-off-debt' as const,
      target_id: 'novuna',
      target_amount: null,
      target_account: 'barclays-current' as const,
      target_date_or_asap: 'ASAP' as const,
      currency: 'GBP' as const,
      scope: 'household' as const,
      intensity: 'medium' as const,
      monthly_allocation: 400,
      activated_at: '2026-05-01',
      completed_at: null,
      projected_completion_date: null,
      notes: null,
      updated_at: '2026-05-01',
      status: 'suggested' as const,
    };

    const po = buildSuggestedPlanPayoffOptions({
      suggested,
      debt: {
        id: 'novuna',
        currentBalance: 5500,
        matchAmounts: [390.71, 412.71],
      },
      availableHeadroom: 500,
      holisticMoneyForDebt: 0,
      strategyPeriodApproxMonths: 12,
      today: '2026-05-01',
    });

    expect(po.baseline_monthly).toBe(390.71);
    expect(po.baseline_monthly).not.toBe(803.42);
  });
});
