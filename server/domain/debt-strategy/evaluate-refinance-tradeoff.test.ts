import { describe, it, expect } from 'vitest';
import { evaluateRefinanceTradeoffWithToday } from './evaluate-refinance-tradeoff.js';
import type { CreditCardConfig } from '../accounts/schema.js';

describe('evaluateRefinanceTradeoffWithToday — both-sides framing invariant', () => {
  it('always returns ALL THREE plans (planA + planB_minOnly + planB_overpay) populated', () => {
    const out = evaluateRefinanceTradeoffWithToday({
      sourceDebt: { balance: 9000, apr: 0.154, monthlyPayment: 399.49 },
      targetCard: { standardApr: 0.249 },
      today: '2026-04-25',
    });
    expect(out.planA_keepAsIs.monthlyPayment).toBeGreaterThan(0);
    expect(out.planA_keepAsIs.totalInterest).toBeGreaterThanOrEqual(0);
    expect(out.planB_minOnly.monthlyPayment).toBeGreaterThan(0);
    expect(out.planB_minOnly.totalInterest).toBeGreaterThanOrEqual(0);
    expect(out.planB_overpay.monthlyPayment).toBeGreaterThan(0);
    expect(out.planB_overpay.totalInterest).toBeGreaterThanOrEqual(0);
  });
});

describe('evaluateRefinanceTradeoffWithToday — Funding Circle 15.4% → 0% promo (genuine savings)', () => {
  const promo: CreditCardConfig = {
    standardApr: 0.249,
    promo: {
      apr: 0,
      expiresAt: '2028-04-25', // 24-month promo
      transferFeePct: 0.029,
      minPaymentPct: 0.01,
      minPaymentTerminatesPromo: true,
    },
  };

  it('planB_overpay (same monthly cash) costs LESS in interest than planA under 0% promo', () => {
    // The genuine win when refinancing onto a 0% promo: keep paying
    // the same monthly amount as before, but at 0% interest so all of
    // it goes to principal. This is the textbook good move.
    const out = evaluateRefinanceTradeoffWithToday({
      sourceDebt: { balance: 9000, apr: 0.154, monthlyPayment: 399.49 },
      targetCard: promo,
      today: '2026-04-25',
    });
    expect(out.planA_keepAsIs.totalInterest).toBeGreaterThan(out.planB_overpay.totalInterest);
    // Total cost (interest + transfer fee) of planB_overpay should also be lower
    // than planA's interest-only cost — the £261 fee is small vs ~£1500 saved in interest.
    expect(out.planB_overpay.totalCost).toBeLessThan(out.planA_keepAsIs.totalCost);
  });

  it('planB_overpay clears faster + cheaper than planB_minOnly under 0% promo', () => {
    // Overpaying actively beats paying minimums even when both are at 0%
    // — minimums leave a balance that gets hit at 24.9% post-promo.
    const out = evaluateRefinanceTradeoffWithToday({
      sourceDebt: { balance: 9000, apr: 0.154, monthlyPayment: 399.49 },
      targetCard: promo,
      today: '2026-04-25',
    });
    expect(out.planB_overpay.monthsToClear).toBeLessThan(out.planB_minOnly.monthsToClear);
    expect(out.planB_overpay.totalInterest).toBeLessThan(out.planB_minOnly.totalInterest);
  });

  it('captures the transfer fee on planB plans', () => {
    const out = evaluateRefinanceTradeoffWithToday({
      sourceDebt: { balance: 9000, apr: 0.154, monthlyPayment: 399.49 },
      targetCard: promo,
      today: '2026-04-25',
    });
    expect(out.planB_minOnly.transferFee).toBe(261); // 9000 * 0.029
    expect(out.planB_overpay.transferFee).toBe(261);
    // planA has no transfer fee
    expect(out.planA_keepAsIs.transferFee).toBeUndefined();
  });
});

describe('evaluateRefinanceTradeoffWithToday — standard 24.9% card (planB loses money on minOnly)', () => {
  const standard: CreditCardConfig = { standardApr: 0.249 };

  it('planB_minOnly costs MORE in total than planA under a high-APR standard card', () => {
    const out = evaluateRefinanceTradeoffWithToday({
      sourceDebt: { balance: 9000, apr: 0.154, monthlyPayment: 399.49 },
      targetCard: standard,
      today: '2026-04-25',
    });
    expect(out.planB_minOnly.totalInterest).toBeGreaterThan(out.planA_keepAsIs.totalInterest);
  });

  it('planB_overpay (same monthly cash) is closer to planA but still costs more on a higher APR', () => {
    const out = evaluateRefinanceTradeoffWithToday({
      sourceDebt: { balance: 9000, apr: 0.154, monthlyPayment: 399.49 },
      targetCard: standard,
      today: '2026-04-25',
    });
    expect(out.planB_overpay.totalInterest).toBeGreaterThan(out.planA_keepAsIs.totalInterest);
  });
});

describe('evaluateRefinanceTradeoffWithToday — promo expires mid-payoff', () => {
  it('promoExpiresMidPayoff:true when planB_minOnly takes longer than promo period', () => {
    const shortPromo: CreditCardConfig = {
      standardApr: 0.249,
      promo: {
        apr: 0,
        expiresAt: '2026-10-25', // 6-month promo
        transferFeePct: 0.029,
        minPaymentPct: 0.01,
        minPaymentTerminatesPromo: true,
      },
    };
    const out = evaluateRefinanceTradeoffWithToday({
      sourceDebt: { balance: 9000, apr: 0.154, monthlyPayment: 399.49 },
      targetCard: shortPromo,
      today: '2026-04-25',
    });
    expect(out.promoExpiresMidPayoff).toBe(true);
    expect(out.postIntroJumpToRate).toBe(0.249);
  });

  it('promoExpiresMidPayoff:false when promo is generous enough that minOnly clears within it', () => {
    // 100-year promo @ 50% min payment = absurdly generous, but the
    // point is: when minOnly clears BEFORE the promo expires,
    // promoExpiresMidPayoff is false.
    const longPromo: CreditCardConfig = {
      standardApr: 0.249,
      promo: {
        apr: 0,
        expiresAt: '2126-04-25', // 100 years
        transferFeePct: 0.029,
        minPaymentPct: 0.5, // Hugely above realistic — clears in months
        minPaymentTerminatesPromo: true,
      },
    };
    const out = evaluateRefinanceTradeoffWithToday({
      sourceDebt: { balance: 9000, apr: 0.154, monthlyPayment: 399.49 },
      targetCard: longPromo,
      today: '2026-04-25',
    });
    expect(out.promoExpiresMidPayoff).toBe(false);
  });

  it('postIntroJumpToRate is null when there is no promo', () => {
    const out = evaluateRefinanceTradeoffWithToday({
      sourceDebt: { balance: 9000, apr: 0.154, monthlyPayment: 399.49 },
      targetCard: { standardApr: 0.249 },
      today: '2026-04-25',
    });
    expect(out.postIntroJumpToRate).toBeNull();
  });
});
