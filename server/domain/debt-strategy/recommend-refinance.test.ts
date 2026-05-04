import { describe, it, expect } from 'vitest';
import { recommendRefinanceFromTradeoff } from './recommend-refinance.js';
import type { EvaluateRefinanceTradeoffResult } from './evaluate-refinance-tradeoff.js';

function mockResult(over: Partial<EvaluateRefinanceTradeoffResult>): EvaluateRefinanceTradeoffResult {
  const base = {
    planA_keepAsIs: { monthlyPayment: 100, monthsToClear: 12, totalInterest: 200, totalCost: 1200 },
    planB_minOnly: { monthlyPayment: 50, monthsToClear: 40, totalInterest: 800, totalCost: 2000 },
    planB_overpay: { monthlyPayment: 100, monthsToClear: 10, totalInterest: 50, totalCost: 1050 },
    promoExpiresMidPayoff: false,
    postIntroJumpToRate: null as number | null,
  };
  return { ...base, ...over };
}

describe('recommendRefinanceFromTradeoff', () => {
  it('prefers balance transfer when overpay total cost is lower', () => {
    const out = recommendRefinanceFromTradeoff(
      mockResult({
        planA_keepAsIs: { monthlyPayment: 100, monthsToClear: 12, totalInterest: 500, totalCost: 1500 },
        planB_overpay: { monthlyPayment: 100, monthsToClear: 11, totalInterest: 100, totalCost: 1200 },
      }),
    );
    expect(out.kind).toBe('prefer_balance_transfer_same_payment');
    expect(out.total_cost_savings_vs_keep).toBe(300);
  });

  it('prefers keep when it is cheaper than overpay on the card', () => {
    const out = recommendRefinanceFromTradeoff(
      mockResult({
        planA_keepAsIs: { monthlyPayment: 100, monthsToClear: 10, totalInterest: 100, totalCost: 1100 },
        planB_overpay: { monthlyPayment: 100, monthsToClear: 12, totalInterest: 400, totalCost: 1500 },
      }),
    );
    expect(out.kind).toBe('prefer_keep');
    expect(out.total_cost_savings_vs_keep).toBe(0);
  });

  it('no_clear_winner when costs are within epsilon', () => {
    const out = recommendRefinanceFromTradeoff(
      mockResult({
        planA_keepAsIs: { monthlyPayment: 100, monthsToClear: 12, totalInterest: 100, totalCost: 1300 },
        planB_overpay: { monthlyPayment: 100, monthsToClear: 12, totalInterest: 100, totalCost: 1300.5 },
      }),
      1,
    );
    expect(out.kind).toBe('no_clear_winner');
  });
});
