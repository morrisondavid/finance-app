/**
 * Shared accumulation + classification pipeline used by both /overview and /recurring routes.
 * Eliminates ~200 lines of duplication by parameterising the differences:
 *   - which transactions to scope (rolling window vs FY)
 *   - which transactions to attach for all-time annual detection
 *   - whether to include income accumulators
 *   - whether to filter pass-through IDs
 */

import { ACCOUNT_CONFIG } from '../types.js';
import type { AccountName } from '../types.js';
import { categorizeTransaction } from './categorizer.js';
import type { CategoryName } from './categorizer.js';
import { normalizeMerchant } from './merchant-normalizer.js';
import { classifyRecurring } from './recurring-detector.js';
import type { RecurringCandidate, TransactionDetail } from './recurring-detector.js';
import type { RecurringExpense } from '../../shared/api-contracts.js';
import { round2 } from './math.js';
import { SPECIAL_CATEGORY } from './category-constants.js';

export interface RawTransaction {
  id: number;
  date: string;
  description: string;
  amount: number;
  account: string;
  type: 'income' | 'expense' | 'transfer';
}

export interface Accumulator {
  merchant: string;
  category: CategoryName;
  sourceAccount: string;
  ownership: 'personal' | 'business';
  monthlyTotals: Map<string, number>;
  annualTotal: number;
  transactions: TransactionDetail[];
}

export interface PipelineResult {
  expenseCandidates: RecurringCandidate[];
  incomeCandidates: RecurringCandidate[];
  expenseAccumulators: Map<string, Accumulator>;
  incomeAccumulators: Map<string, Accumulator>;
  monthlyExpenseRecurring: RecurringExpense[];
  annualExpenseRecurring: RecurringExpense[];
  monthlyIncomeRecurring: RecurringExpense[];
  annualIncomeRecurring: RecurringExpense[];
  monthsCovered: number;
}

export interface PipelineConfig {
  scopedTransactions: RawTransaction[];
  allTimeTransactions: RawTransaction[];
  passThroughIds?: Set<number>;
  includeIncome: boolean;
}

export function accKey(category: string, merchant: string, account: string, amount: number): string {
  return `${category}|${merchant}|${account}|${Math.round(amount)}`;
}

export function recurringKey(e: RecurringExpense): string {
  return accKey(e.category, e.merchant, e.sourceAccount, e.amount);
}

function toYearMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function classifyTxn(txn: RawTransaction): 'expense' | 'income' | null {
  if (txn.type === 'expense' || (txn.type === 'transfer' && txn.amount < 0)) return 'expense';
  if (txn.type === 'income' || (txn.type === 'transfer' && txn.amount > 0)) return 'income';
  return null;
}

function accumulatorsToCandiates(map: Map<string, Accumulator>): RecurringCandidate[] {
  const candidates: RecurringCandidate[] = [];
  for (const acc of map.values()) {
    const monthlyValues = Array.from(acc.monthlyTotals.values());
    const monthlyMax = monthlyValues.length > 0 ? Math.max(...monthlyValues) : 0;
    const monthlyAvg = monthlyValues.length > 0
      ? monthlyValues.reduce((s, v) => s + v, 0) / monthlyValues.length
      : 0;

    candidates.push({
      merchant: acc.merchant,
      category: acc.category,
      monthlyMax: round2(monthlyMax),
      monthlyAvg: round2(monthlyAvg),
      monthsActive: acc.monthlyTotals.size,
      annualTotal: round2(acc.annualTotal),
      sourceAccount: acc.sourceAccount,
      ownership: acc.ownership,
      transactions: acc.transactions,
    });
  }
  return candidates;
}

/**
 * Run the full accumulate-and-classify pipeline.
 *
 * Pass 1: build monthly totals from `scopedTransactions`.
 * Pass 2: attach all-time transaction details from `allTimeTransactions` (for annual detection).
 * Then classify via `classifyRecurring`.
 */
export function buildRecurringPipeline(config: PipelineConfig): PipelineResult {
  const { scopedTransactions, allTimeTransactions, passThroughIds, includeIncome } = config;

  const expenseAccumulators = new Map<string, Accumulator>();
  const incomeAccumulators = new Map<string, Accumulator>();
  const allMonths = new Set<string>();

  // Pass 1: scoped transactions -> monthly totals
  for (const txn of scopedTransactions) {
    if (passThroughIds?.has(txn.id)) continue;

    const side = classifyTxn(txn);
    if (!side) continue;
    if (side === 'income' && !includeIncome) continue;

    const category = side === 'income' ? SPECIAL_CATEGORY.income : categorizeTransaction(txn.description);
    if (category === SPECIAL_CATEGORY.transfers) continue;

    const merchant = normalizeMerchant(txn.description);
    const account = txn.account;
    const ownership = ACCOUNT_CONFIG[account as AccountName]?.ownership ?? 'personal';
    const absAmount = Math.abs(txn.amount);
    const key = accKey(category, merchant, account, absAmount);
    const ym = toYearMonth(txn.date);
    allMonths.add(ym);

    const map = side === 'income' ? incomeAccumulators : expenseAccumulators;
    let acc = map.get(key);
    if (!acc) {
      acc = {
        merchant,
        category,
        sourceAccount: account,
        ownership,
        monthlyTotals: new Map(),
        annualTotal: 0,
        transactions: [],
      };
      map.set(key, acc);
    }

    acc.annualTotal += absAmount;
    acc.monthlyTotals.set(ym, (acc.monthlyTotals.get(ym) ?? 0) + absAmount);
  }

  // Pass 2: all-time transactions -> attach for annual pattern detection
  for (const txn of allTimeTransactions) {
    const side = classifyTxn(txn);
    if (!side) continue;
    if (side === 'income' && !includeIncome) continue;

    const category = side === 'income' ? SPECIAL_CATEGORY.income : categorizeTransaction(txn.description);
    if (category === SPECIAL_CATEGORY.transfers) continue;

    const merchant = normalizeMerchant(txn.description);
    const absAmount = Math.abs(txn.amount);
    const key = accKey(category, merchant, txn.account, absAmount);
    const map = side === 'income' ? incomeAccumulators : expenseAccumulators;
    const acc = map.get(key);
    if (!acc) continue;
    acc.transactions.push({ date: txn.date, amount: absAmount });
  }

  const monthsCovered = allMonths.size || 1;

  const expenseCandidates = accumulatorsToCandiates(expenseAccumulators);
  const incomeCandidates = includeIncome ? accumulatorsToCandiates(incomeAccumulators) : [];

  const { monthly: monthlyExpenseRecurring, annual: annualExpenseRecurring } =
    classifyRecurring(expenseCandidates, monthsCovered);
  const { monthly: monthlyIncomeRecurring, annual: annualIncomeRecurring } = includeIncome
    ? classifyRecurring(incomeCandidates, monthsCovered)
    : { monthly: [], annual: [] };

  return {
    expenseCandidates,
    incomeCandidates,
    expenseAccumulators,
    incomeAccumulators,
    monthlyExpenseRecurring,
    annualExpenseRecurring,
    monthlyIncomeRecurring,
    annualIncomeRecurring,
    monthsCovered,
  };
}
