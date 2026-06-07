import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildLiquidityCommitments,
  monthKeysInInclusiveRange,
} from './liquidity-commitments.js';
import * as obligations from '../../db/repositories/obligations.js';
import * as expensesOverview from '../../utils/expenses-overview-pipeline.js';
import { isoDateAddCalendarMonths } from '../../../shared/iso-date.js';
import { round2 } from '../../utils/math.js';

vi.mock('../../db/repositories/obligations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/repositories/obligations.js')>();
  return {
    ...actual,
    getAllObligations: vi.fn(),
  };
});

vi.mock('../../utils/expenses-overview-pipeline.js', () => ({
  runExpensesOverviewPipeline: vi.fn(),
}));

describe('monthKeysInInclusiveRange', () => {
  it('includes start and end month keys', () => {
    expect(monthKeysInInclusiveRange('2026-03-15', '2026-05-08')).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
  });
});

describe('buildLiquidityCommitments', () => {
  beforeEach(() => {
    vi.mocked(obligations.getAllObligations).mockReturnValue([]);
    vi.mocked(expensesOverview.runExpensesOverviewPipeline).mockReturnValue({
      expenseCandidates: [],
      incomeCandidates: [],
      expenseAccumulators: new Map(),
      incomeAccumulators: new Map(),
      monthlyExpenseRecurring: [],
      annualExpenseRecurring: [],
      monthlyIncomeRecurring: [],
      annualIncomeRecurring: [],
      monthsCovered: 6,
    });
  });

  it('filters obligations with getAllObligations date range (rolling year forward + lookback)', () => {
    buildLiquidityCommitments({
      todayIso: '2026-02-01',
      totalCashGbp: 5000,
    });

    expect(obligations.getAllObligations).toHaveBeenCalledWith({
      minDueDate: '2025-02-01',
      maxDueDate: isoDateAddCalendarMonths('2026-02-01', 12),
      hideCompleted: true,
    });
  });

  it('sums obligation remaining amounts and subtracts from total cash', () => {
    vi.mocked(obligations.getAllObligations).mockReturnValue([
      {
        id: 'ob-1',
        source: 'auto',
        type: 'vat',
        name: 'VAT',
        entity: 'HMRC',
        frequency: 'quarterly',
        expected_amount: 1000,
        naive_amount: null,
        adjustment_basis: null,
        adjustment_source: null,
        due_date: '2026-03-07',
        status: 'pending',
        paid_amount: 250,
        paid_date: null,
        paid_from_account: null,
        paid_from_tx_hash: null,
        notes: null,
        person_id: null,
        created_at: null,
        updated_at: null,
      },
    ]);

    const out = buildLiquidityCommitments({
      todayIso: '2026-02-01',
      totalCashGbp: 5000,
    });

    expect(out.horizonStartDate).toBe('2026-02-01');
    expect(out.horizonEndDate).toBe(isoDateAddCalendarMonths('2026-02-01', 12));
    expect(out.lines.some(l => l.source === 'obligation' && l.amountGbp === 750)).toBe(true);
    expect(out.totalCommittedGbp).toBe(750);
    expect(out.cashAfterCommitmentsGbp).toBe(4250);
  });

  it('adds projected monthly recurring as monthly amount times months in horizon', () => {
    vi.mocked(expensesOverview.runExpensesOverviewPipeline).mockReturnValue({
      expenseCandidates: [],
      incomeCandidates: [],
      expenseAccumulators: new Map(),
      incomeAccumulators: new Map(),
      monthlyExpenseRecurring: [
        {
          merchant: 'Rent',
          category: 'Other',
          colour: '#000',
          amount: 100,
          frequency: 'monthly',
          monthsActive: 3,
          annualTotal: 1200,
          logoUrl: null,
          sourceAccount: 'barclays-current',
          billingDayOfMonth: 1,
          billingMonth: null,
        },
      ],
      annualExpenseRecurring: [],
      monthlyIncomeRecurring: [],
      annualIncomeRecurring: [],
      monthsCovered: 6,
    });

    const out = buildLiquidityCommitments({
      todayIso: '2026-03-15',
      totalCashGbp: 10_000,
    });

    const end = isoDateAddCalendarMonths('2026-03-15', 12);
    const months = monthKeysInInclusiveRange('2026-03-15', end).length;

    const rent = out.lines.find(l => l.label === 'Rent');
    expect(rent?.source).toBe('recurring-fixed');
    expect(rent?.amountGbp).toBe(100 * months);
    expect(out.totalCommittedGbp).toBe(100 * months);
    expect(out.cashAfterCommitmentsGbp).toBe(round2(10_000 - 100 * months));
  });

  it('includes annual recurring when a due date falls in the rolling window', () => {
    vi.mocked(expensesOverview.runExpensesOverviewPipeline).mockReturnValue({
      expenseCandidates: [],
      incomeCandidates: [],
      expenseAccumulators: new Map(),
      incomeAccumulators: new Map(),
      monthlyExpenseRecurring: [],
      annualExpenseRecurring: [
        {
          merchant: 'Insurance',
          category: 'Insurance',
          colour: '#000',
          amount: 600,
          frequency: 'annual',
          monthsActive: 1,
          annualTotal: 600,
          logoUrl: null,
          sourceAccount: 'barclays-current',
          billingDayOfMonth: 15,
          billingMonth: 3,
        },
      ],
      monthlyIncomeRecurring: [],
      annualIncomeRecurring: [],
      monthsCovered: 6,
    });

    const out = buildLiquidityCommitments({
      todayIso: '2026-02-01',
      totalCashGbp: 5000,
    });

    const ins = out.lines.find(l => l.label === 'Insurance');
    expect(ins?.amountGbp).toBe(600);
    expect(ins?.dueDate).toBe('2026-03-15');
  });

  it('marks obligation lines at or above threshold as significant', () => {
    vi.mocked(obligations.getAllObligations).mockReturnValue([
      {
        id: 'ob-big',
        source: 'manual',
        type: 'self-assessment',
        name: 'SA',
        entity: 'HMRC',
        frequency: 'annual',
        expected_amount: 3500,
        naive_amount: null,
        adjustment_basis: null,
        adjustment_source: null,
        due_date: '2026-06-01',
        status: 'pending',
        paid_amount: null,
        paid_date: null,
        paid_from_account: null,
        paid_from_tx_hash: null,
        notes: null,
        person_id: null,
        created_at: null,
        updated_at: null,
      },
    ]);

    const out = buildLiquidityCommitments({
      todayIso: '2026-02-01',
      totalCashGbp: 50_000,
    });
    const line = out.lines.find(l => l.label === 'SA');
    expect(line?.significant).toBe(true);
  });
});
