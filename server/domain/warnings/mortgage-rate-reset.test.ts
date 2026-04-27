import { describe, it, expect } from 'vitest';
import {
  deriveMortgageRateResetWarnings,
  RATE_RESET_CRITICAL_DAYS,
} from './mortgage-rate-reset.js';
import type { Debt } from '../../db/repositories/debts.js';

const today = '2026-04-25';

function makeMortgage(over: Partial<Debt> = {}): Debt {
  return {
    id: 'mortgage-test',
    name: 'Test Mortgage',
    merchantPattern: 'NatWest',
    sourceAccounts: ['monzo-joint'],
    originalLoanAmount: 200000,
    originalLoanDate: null,
    openingBalance: 200000,
    openingBalanceDate: '2024-01-01',
    archived: false,
    matchAmounts: [800],
    matchTolerancePct: 0,
    kind: 'mortgage',
    interestRate: 4.48,
    fixedRateEndDate: '2026-09-01', // ~129 days out — outside window
    repaymentType: 'interest-only',
    propertyValueEstimate: 300000,
    propertyId: 'test-prop',
    updatedAt: '2026-01-01',
    ...over,
  };
}

describe('mortgage-rate-reset thresholds', () => {
  it('warn when reset is 30-90 days out', () => {
    const out = deriveMortgageRateResetWarnings({
      today,
      debts: [makeMortgage({ fixedRateEndDate: '2026-06-25' })], // 61 days
    });
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('warn');
    expect(out[0].context?.daysUntilReset).toBe(61);
  });

  it('critical when reset is < 30 days', () => {
    const out = deriveMortgageRateResetWarnings({
      today,
      debts: [makeMortgage({ fixedRateEndDate: '2026-05-10' })], // 15 days
    });
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('critical');
  });

  it('does NOT fire when reset is > 90 days', () => {
    const out = deriveMortgageRateResetWarnings({
      today,
      debts: [makeMortgage({ fixedRateEndDate: '2027-04-25' })],
    });
    expect(out).toHaveLength(0);
  });

  it('does NOT fire when reset is in the past', () => {
    const out = deriveMortgageRateResetWarnings({
      today,
      debts: [makeMortgage({ fixedRateEndDate: '2025-01-01' })],
    });
    expect(out).toHaveLength(0);
  });
});

describe('mortgage-rate-reset — stress payment math', () => {
  it('stressed monthly is current monthly × (rate + 1.5pp) / rate', () => {
    const out = deriveMortgageRateResetWarnings({
      today,
      debts: [
        makeMortgage({
          fixedRateEndDate: '2026-06-01',
          interestRate: 4.48,
          matchAmounts: [801.35], // current monthly
        }),
      ],
    });
    expect(out).toHaveLength(1);
    // 5.98 / 4.48 ≈ 1.3348, × 801.35 ≈ 1069.65
    expect(out[0].context?.stressedMonthlyPaymentAtMarketRate).toBeCloseTo(1069.65, 1);
    expect(out[0].context?.monthlyPaymentDelta).toBeCloseTo(268.30, 1);
    expect(out[0].context?.stressSpreadPp).toBe(1.5);
  });
});

describe('mortgage-rate-reset — no-op cases', () => {
  it('skips non-mortgage debts', () => {
    const out = deriveMortgageRateResetWarnings({
      today,
      debts: [makeMortgage({ kind: 'consumer', fixedRateEndDate: '2026-06-01' })],
    });
    expect(out).toHaveLength(0);
  });

  it('skips archived mortgages', () => {
    const out = deriveMortgageRateResetWarnings({
      today,
      debts: [makeMortgage({ archived: true, fixedRateEndDate: '2026-06-01' })],
    });
    expect(out).toHaveLength(0);
  });

  it('skips mortgages with no fixedRateEndDate (e.g. interest-only with rolling rate)', () => {
    const out = deriveMortgageRateResetWarnings({
      today,
      debts: [makeMortgage({ fixedRateEndDate: null })],
    });
    expect(out).toHaveLength(0);
  });

  it('skips mortgages with empty matchAmounts (no monthly payment data)', () => {
    const out = deriveMortgageRateResetWarnings({
      today,
      debts: [makeMortgage({ matchAmounts: [], fixedRateEndDate: '2026-06-01' })],
    });
    expect(out).toHaveLength(0);
  });
});

describe('mortgage-rate-reset — exported constants', () => {
  it('RATE_RESET_CRITICAL_DAYS = 30', () => {
    expect(RATE_RESET_CRITICAL_DAYS).toBe(30);
  });
});
