import { describe, it, expect, vi } from 'vitest';
import {
  deriveAdHocSpendWarnings,
  AD_HOC_ROLLING_30D_WARN,
} from './ad-hoc-spend.js';
import type { RawTransaction, PipelineResult } from '../../utils/recurring-pipeline.js';
import type { BudgetNudgeRow } from '../../utils/budget-nudges.js';

vi.mock('../../utils/budget-nudges.js', () => ({
  computeBudgetNudges: vi.fn(),
}));

import { computeBudgetNudges } from '../../utils/budget-nudges.js';
const mockComputeBudgetNudges = vi.mocked(computeBudgetNudges);

const today = '2026-01-30';

let txnId = 1;
function tx(date: string, amount: number, description: string, account = 'natwest'): RawTransaction {
  return { id: txnId++, date, amount, description, account, type: 'expense' };
}

function emptyPipeline(): PipelineResult {
  return {
    expenseCandidates: [],
    incomeCandidates: [],
    expenseAccumulators: new Map(),
    incomeAccumulators: new Map(),
    monthlyExpenseRecurring: [],
    annualExpenseRecurring: [],
    monthlyIncomeRecurring: [],
    annualIncomeRecurring: [],
    monthsCovered: 12,
  };
}

function nudge(over: Partial<BudgetNudgeRow> = {}): BudgetNudgeRow {
  return {
    merchant: 'Careem',
    suggestedCategory: 'Transport',
    totalSpend: 600,
    transactionCount: 30,
    lastDate: today,
    logoUrl: null,
    ...over,
  };
}

describe('ad-hoc-spend escalation thresholds', () => {
  it('does not emit when 30d and 90d are both below threshold', () => {
    mockComputeBudgetNudges.mockReturnValue([nudge()]);
    const out = deriveAdHocSpendWarnings({
      today,
      expenseTransactions: [
        tx('2026-01-15', -100, 'CAREEM INC'),
        tx('2026-01-10', -100, 'CAREEM INC'),
      ],
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    expect(out).toHaveLength(0);
  });

  it('emits warn when 30d > threshold but no MoM acceleration', () => {
    mockComputeBudgetNudges.mockReturnValue([nudge()]);
    const txns: RawTransaction[] = [];
    // Recent 30d: ~£600 (6 × £100)
    for (let i = 0; i < 6; i++) txns.push(tx(`2026-01-${String(20 - i).padStart(2, '0')}`, -100, 'CAREEM SOMETHING'));
    // Prior 30d (days 31-60): also ~£600 to keep MoM neutral
    for (let i = 0; i < 6; i++) txns.push(tx(`2025-12-${String(20 - i).padStart(2, '0')}`, -100, 'CAREEM SOMETHING'));
    const out = deriveAdHocSpendWarnings({
      today,
      expenseTransactions: txns,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    const w = out.find(o => o.code === 'ad-hoc-spend-escalating');
    expect(w).toBeDefined();
    expect(w?.severity).toBe('warn');
    expect((w?.context?.rolling30dTotal as number)).toBeGreaterThan(AD_HOC_ROLLING_30D_WARN);
    expect(w?.context?.merchant).toBe('Careem');
  });

  it('emits critical when 30d breaches threshold AND MoM > 50%', () => {
    mockComputeBudgetNudges.mockReturnValue([nudge()]);
    const txns: RawTransaction[] = [];
    // Recent 30d: £900 (9 × £100)
    for (let i = 0; i < 9; i++) txns.push(tx(`2026-01-${String(20 - i).padStart(2, '0')}`, -100, 'CAREEM CAREEM'));
    // Prior 30d: £400 (4 × £100) → MoM = (900 - 400) / 400 = 1.25 > 0.5
    for (let i = 0; i < 4; i++) txns.push(tx(`2025-12-${String(20 - i).padStart(2, '0')}`, -100, 'CAREEM CAREEM'));
    const out = deriveAdHocSpendWarnings({
      today,
      expenseTransactions: txns,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    const w = out.find(o => o.code === 'ad-hoc-spend-escalating');
    expect(w?.severity).toBe('critical');
    expect((w?.context?.momChangePct as number) > 0.5).toBe(true);
  });

  it('does not promote to critical when MoM is high but 30d does not breach', () => {
    mockComputeBudgetNudges.mockReturnValue([nudge()]);
    const txns: RawTransaction[] = [];
    // Recent 30d: £200 (under threshold) but very high MoM jump
    for (let i = 0; i < 2; i++) txns.push(tx(`2026-01-${String(20 - i).padStart(2, '0')}`, -100, 'CAREEM C'));
    // Prior 30d: £20 → ratio +900% but base is too low to escalate
    txns.push(tx('2025-12-15', -20, 'CAREEM C'));
    const out = deriveAdHocSpendWarnings({
      today,
      expenseTransactions: txns,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    expect(out).toHaveLength(0);
  });

  it('skips merchants the nudge surface did not accept (already-budgeted)', () => {
    mockComputeBudgetNudges.mockReturnValue([]); // simulate "already budgeted"
    const txns: RawTransaction[] = [];
    for (let i = 0; i < 9; i++) txns.push(tx(`2026-01-${String(20 - i).padStart(2, '0')}`, -100, 'CAREEM'));
    const out = deriveAdHocSpendWarnings({
      today,
      expenseTransactions: txns,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(['Transport']),
    });
    expect(out).toHaveLength(0);
  });
});

describe('output ordering', () => {
  it('critical before warn, then 30d total desc', () => {
    mockComputeBudgetNudges.mockReturnValue([
      nudge({ merchant: 'Careem' }),
      nudge({ merchant: 'Talabat' }),
    ]);
    const txns: RawTransaction[] = [];
    // Careem: warn-only (~£600 30d, neutral MoM)
    for (let i = 0; i < 6; i++) txns.push(tx(`2026-01-${String(20 - i).padStart(2, '0')}`, -100, 'CAREEM CAREEM'));
    for (let i = 0; i < 6; i++) txns.push(tx(`2025-12-${String(20 - i).padStart(2, '0')}`, -100, 'CAREEM CAREEM'));
    // Talabat: critical (~£900 30d, low prior → big MoM)
    for (let i = 0; i < 9; i++) txns.push(tx(`2026-01-${String(20 - i).padStart(2, '0')}`, -100, 'TALABAT TALABAT'));
    for (let i = 0; i < 4; i++) txns.push(tx(`2025-12-${String(20 - i).padStart(2, '0')}`, -100, 'TALABAT TALABAT'));

    const out = deriveAdHocSpendWarnings({
      today,
      expenseTransactions: txns,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    expect(out.map(o => o.context?.merchant)).toEqual(['Talabat', 'Careem']);
    expect(out[0].severity).toBe('critical');
    expect(out[1].severity).toBe('warn');
  });
});
