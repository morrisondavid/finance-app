/**
 * Envelope: {@link RunwayResponseSchema} stays aligned with the GET /api/runway shape.
 * (HTTP stack is covered manually; the route composes registries + DB like forecast.)
 */
import { describe, it, expect } from 'vitest';
import { RunwayResponseSchema, ForecastEntitySummarySchema } from '../../shared/api-contracts.js';

const zeroInsight = {
  totalFixedMonthlyExpenses: 0,
  monthlyIncomeNeededAfterPassive: 0,
  netExpensesSalaryIncludedShortfall: 0,
  netExpensesSalaryIncludedSurplus: 0,
  netExpensesSalaryExcludedShortfall: 0,
  netExpensesSalaryExcludedSurplus: 0,
  netPersonalExpensesSalaryExcludedShortfall: 0,
  netPersonalExpensesSalaryExcludedSurplus: 0,
  moneyNeededJointAccount: 0,
  jointAccountMonthlySurplus: 0,
  businessExpenses: 0,
  businessExpensesSalaryExcluded: 0,
  totalSalary: 0,
  personalExpenses: 0,
  natwestPersonalFixed: 0,
  qualityOfLifeExpenses: 0,
  billsExpenses: 0,
  totalPassiveIncome: 0,
  debtShortTerm: 0,
  debtMediumTerm: 0,
  debtTotal: 0,
  dividendHeena: null,
  dividendDavid: null,
} as const;

function entityStub(): unknown {
  return ForecastEntitySummarySchema.parse({
    entityId: 'autonize-it-ltd',
    currency: 'GBP',
    current: 0,
    day30: 0,
    day60: 0,
    day90: 0,
  });
}

describe('RunwayResponseSchema', () => {
  it('accepts a minimal valid payload', () => {
    const body = {
      today: '2026-01-15',
      horizonDays: 90,
      household: {
        GBP: {
          currency: 'GBP' as const,
          runwayMonthsFullRecurring: 12,
          runwayMonthsMandatoryRecurring: 18,
          firstStressDateFullRecurring: '2026-12-01',
          firstStressDateMandatoryRecurring: '2027-01-01',
          totalCashCurrent: 1000,
          totalAvailableCredit: 500,
        },
      },
      holisticGbp: {
        firstStressDateFullRecurring: '2026-11-15',
        runwayMonthsFullRecurring: 11.2,
        firstStressDateMandatoryRecurring: '2026-12-20',
        runwayMonthsMandatoryRecurring: 12.1,
      },
      insight: zeroInsight,
      insightNote: 'test',
      stress: {
        fullRecurring: { entities: [entityStub()] },
        mandatoryRecurring: { entities: [entityStub()] },
      },
    };
    const parsed = RunwayResponseSchema.safeParse(body);
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});
