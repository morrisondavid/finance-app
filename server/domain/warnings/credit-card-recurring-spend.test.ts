import { describe, it, expect } from 'vitest';
import { deriveCreditCardRecurringSpendWarnings } from './credit-card-recurring-spend.js';
import type { AccountConfig } from '../accounts/schema.js';
import type { PipelineResult } from '../../utils/recurring-pipeline.js';
import type { RecurringExpense } from '../../../shared/api-contracts.js';

function emptyPipeline(monthly: RecurringExpense[] = []): PipelineResult {
  return {
    expenseCandidates: [],
    incomeCandidates: [],
    expenseAccumulators: new Map(),
    incomeAccumulators: new Map(),
    monthlyExpenseRecurring: monthly,
    annualExpenseRecurring: [],
    monthlyIncomeRecurring: [],
    annualIncomeRecurring: [],
    monthsCovered: 12,
  };
}

function recurring(over: Partial<RecurringExpense> & Pick<RecurringExpense, 'merchant' | 'sourceAccount'>): RecurringExpense {
  return {
    category: over.category ?? 'Software',
    colour: '#000',
    amount: over.amount ?? 29.99,
    frequency: over.frequency ?? 'monthly',
    monthsActive: over.monthsActive ?? 6,
    annualTotal: over.annualTotal ?? (over.amount ?? 29.99) * 12,
    logoUrl: null,
    billingDayOfMonth: over.billingDayOfMonth ?? 15,
    billingMonth: over.billingMonth ?? null,
    ...over,
  };
}

const costlyCard: AccountConfig = {
  name: 'capital-on-tap',
  label: 'Capital on Tap',
  type: 'credit-card',
  currency: 'GBP',
  entityId: 'autonize-it-ltd',
  category: 'business',
  business: {
    jurisdiction: 'UK',
    vat: { applicable: false, rate: 0.2, registered: true },
    corpTax: { applicable: false, qualifyingFreeZone: false },
  },
  canMakeOutgoingPayments: true,
  excludeTransfersFromIncome: false,
  showTaxLiabilities: false,
  creditCard: { standardApr: 0.0718, minPaymentPct: 0.1, minPaymentFloorGbp: 100 },
};

const debitAccount: AccountConfig = {
  name: 'barclays-current',
  label: 'Barclays Current',
  type: 'current',
  currency: 'GBP',
  entityId: 'autonize-it-ltd',
  category: 'business',
  business: {
    jurisdiction: 'UK',
    vat: { applicable: true, rate: 0.2, registered: true },
    corpTax: { applicable: true, qualifyingFreeZone: false },
  },
  canMakeOutgoingPayments: true,
  excludeTransfersFromIncome: true,
  showTaxLiabilities: true,
};

const cheapCard: AccountConfig = {
  ...costlyCard,
  name: 'barclaycard',
  label: 'Barclaycard',
  creditCard: { standardApr: 0.01, minPaymentPct: 0.02 },
};

describe('deriveCreditCardRecurringSpendWarnings', () => {
  it('warns when costly card has monthly recurring spend', () => {
    const out = deriveCreditCardRecurringSpendWarnings({
      accounts: [costlyCard, debitAccount],
      pipeline: emptyPipeline([
        recurring({ merchant: 'Adobe', sourceAccount: 'capital-on-tap', amount: 54.99 }),
        recurring({ merchant: 'GitHub', sourceAccount: 'capital-on-tap', amount: 12 }),
      ]),
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.code).toBe('credit-card-recurring-spend');
    expect(out[0]?.context?.account).toBe('capital-on-tap');
    expect(out[0]?.context?.merchantCount).toBe(2);
    expect(out[0]?.context?.monthlyTotalGbp).toBe(66.99);
    expect(out[0]?.recommended_action).toContain('Barclays Current');
  });

  it('does NOT fire for debt repayment or transfers on a costly card', () => {
    const out = deriveCreditCardRecurringSpendWarnings({
      accounts: [costlyCard, debitAccount],
      pipeline: emptyPipeline([
        recurring({ merchant: 'Capital on Tap', sourceAccount: 'capital-on-tap', category: 'Debt Repayment' }),
        recurring({ merchant: 'Internal', sourceAccount: 'capital-on-tap', category: 'Transfers' }),
      ]),
    });
    expect(out).toHaveLength(0);
  });

  it('does NOT fire when card terms are unknown (no creditCard block)', () => {
    const unconfigured = { ...costlyCard, creditCard: undefined };
    const out = deriveCreditCardRecurringSpendWarnings({
      accounts: [unconfigured, debitAccount],
      pipeline: emptyPipeline([
        recurring({ merchant: 'Adobe', sourceAccount: 'capital-on-tap' }),
      ]),
    });
    expect(out).toHaveLength(0);
  });

  it('does NOT fire for low-cost card terms', () => {
    const out = deriveCreditCardRecurringSpendWarnings({
      accounts: [cheapCard, debitAccount],
      pipeline: emptyPipeline([
        recurring({ merchant: 'Netflix', sourceAccount: 'barclaycard' }),
      ]),
    });
    expect(out).toHaveLength(0);
  });

  it('does NOT fire when recurring spend is on debit, not card', () => {
    const out = deriveCreditCardRecurringSpendWarnings({
      accounts: [costlyCard, debitAccount],
      pipeline: emptyPipeline([
        recurring({ merchant: 'Adobe', sourceAccount: 'barclays-current' }),
      ]),
    });
    expect(out).toHaveLength(0);
  });
});
