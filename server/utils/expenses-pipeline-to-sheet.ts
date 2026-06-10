/**
 * Maps a full {@link PipelineResult} into {@link BuildExpensesSheetInput} for
 * {@link buildExpensesSheetResponse} — shared by `/api/expenses/overview` and runway.
 */

import type { ExpensesLineItem, ExpensesSection, RecurringExpense } from '../../shared/api-contracts.js';
import type { BuildExpensesSheetInput } from '../../shared/expenses-sheet-build.js';
import { categoryColour, CATEGORY_NAMES } from './categorizer.js';
import { round2, ROLLING_MONTHS, VARIANCE_EPS } from './math.js';
import { isValidAccountName, getAccountConfig } from '../domain/accounts/index.js';
import { recurringKey } from './recurring-pipeline.js';
import type { PipelineResult } from './recurring-pipeline.js';

/**
 * Resolve `RecurringExpense.sourceAccount` (typed as `string` in the schema) to
 * the account's category, falling back to `'personal'` for any value that does
 * not validate as a known account id. Pure narrowing through
 * {@link isValidAccountName} — no escape casts.
 */
function accountCategoryFor(sourceAccount: string): 'personal' | 'business' {
  if (!isValidAccountName(sourceAccount)) return 'personal';
  return getAccountConfig(sourceAccount).category;
}

function computeMonthlyVariance(
  monthlyTotals: Map<string, number>,
  typical: number,
): Array<{ period: string; expected: number; actual: number }> {
  const out: Array<{ period: string; expected: number; actual: number }> = [];
  for (const [ym, actual] of monthlyTotals) {
    if (Math.abs(actual - typical) > VARIANCE_EPS) {
      out.push({ period: ym, expected: round2(typical), actual: round2(actual) });
    }
  }
  out.sort((a, b) => a.period.localeCompare(b.period));
  return out;
}

function getAnnualVariance(
  transactions: Array<{ date: string; amount: number }>,
  typical: number,
): Array<{ period: string; expected: number; actual: number }> {
  const byYear = new Map<number, number>();
  for (const t of transactions) {
    const y = parseInt(t.date.slice(0, 4), 10);
    byYear.set(y, Math.max(byYear.get(y) ?? 0, t.amount));
  }
  const out: Array<{ period: string; expected: number; actual: number }> = [];
  for (const [year, actual] of byYear) {
    if (Math.abs(actual - typical) > VARIANCE_EPS) {
      out.push({ period: String(year), expected: round2(typical), actual: round2(actual) });
    }
  }
  out.sort((a, b) => a.period.localeCompare(b.period));
  return out;
}

export function recurringLineKey(
  direction: 'expense' | 'income',
  frequency: 'monthly' | 'annual',
  e: RecurringExpense,
): string {
  return `${direction}|${frequency}|${recurringKey(e)}`;
}

function toLineItem(
  e: RecurringExpense,
  frequency: 'monthly' | 'annual',
  accountCategory: 'personal' | 'business',
  variance: Array<{ period: string; expected: number; actual: number }>,
  direction: 'expense' | 'income',
): ExpensesLineItem {
  return {
    lineKey: recurringLineKey(direction, frequency, e),
    merchant: e.merchant,
    category: e.category,
    amount: e.amount,
    frequency,
    sourceAccount: e.sourceAccount,
    accountCategory,
    isVariable: false,
    billingDayOfMonth: e.billingDayOfMonth ?? null,
    billingMonth: e.billingMonth ?? null,
    variance,
    nativeAmount: e.nativeAmount,
    nativeCurrency: e.nativeCurrency,
  };
}

/**
 * Build the same shape the expenses overview route used to build inline, for
 * `buildExpensesSheetResponse` + optional `applySimulationExclusions`.
 */
export function buildExpensesSheetInputFromPipeline(
  pipeline: PipelineResult,
): BuildExpensesSheetInput {
  const monthlyItemsByCategory = new Map<string, ExpensesLineItem[]>();
  for (const e of pipeline.monthlyExpenseRecurring) {
    const acc = pipeline.expenseAccumulators.get(recurringKey(e));
    const variance = acc ? computeMonthlyVariance(acc.monthlyTotals, e.amount) : [];
    const acctCat = acc?.accountCategory ?? accountCategoryFor(e.sourceAccount);
    const list = monthlyItemsByCategory.get(e.category) ?? [];
    list.push(toLineItem(e, 'monthly', acctCat, variance, 'expense'));
    monthlyItemsByCategory.set(e.category, list);
  }

  const categoryOrder = CATEGORY_NAMES;
  const monthlyOutgoings: ExpensesSection[] = [];
  for (const catName of categoryOrder) {
    const items = monthlyItemsByCategory.get(catName);
    if (!items || items.length === 0) continue;
    items.sort((a, b) => b.amount - a.amount);
    monthlyOutgoings.push({
      name: catName,
      colour: categoryColour(catName),
      subtotal: round2(items.reduce((s, i) => s + i.amount, 0)),
      items,
    });
  }

  const annualByCategory = new Map<string, ExpensesLineItem[]>();
  for (const e of pipeline.annualExpenseRecurring) {
    const acc = pipeline.expenseAccumulators.get(recurringKey(e));
    const variance = acc ? getAnnualVariance(acc.transactions, e.amount) : [];
    const list = annualByCategory.get(e.category) ?? [];
    list.push(toLineItem(e, 'annual', accountCategoryFor(e.sourceAccount), variance, 'expense'));
    annualByCategory.set(e.category, list);
  }
  const annualOutgoings: ExpensesSection[] = [];
  for (const catName of categoryOrder) {
    const items = annualByCategory.get(catName);
    if (!items || items.length === 0) continue;
    items.sort((a, b) => b.amount - a.amount);
    annualOutgoings.push({
      name: catName,
      colour: categoryColour(catName),
      subtotal: round2(items.reduce((s, i) => s + i.amount, 0)),
      items,
    });
  }

  const incomeMonthlyItems: ExpensesLineItem[] = [];
  for (const e of pipeline.monthlyIncomeRecurring) {
    const acc = pipeline.incomeAccumulators.get(recurringKey(e));
    const variance = acc ? computeMonthlyVariance(acc.monthlyTotals, e.amount) : [];
    incomeMonthlyItems.push(
      toLineItem(e, 'monthly', accountCategoryFor(e.sourceAccount), variance, 'income'),
    );
  }
  const incomeAnnualItems: ExpensesLineItem[] = [];
  for (const e of pipeline.annualIncomeRecurring) {
    const acc = pipeline.incomeAccumulators.get(recurringKey(e));
    const variance = acc ? getAnnualVariance(acc.transactions, e.amount) : [];
    incomeAnnualItems.push(
      toLineItem(e, 'annual', accountCategoryFor(e.sourceAccount), variance, 'income'),
    );
  }
  incomeMonthlyItems.sort((a, b) => b.amount - a.amount);
  incomeAnnualItems.sort((a, b) => b.amount - a.amount);

  return {
    monthlyOutgoings,
    annualOutgoings,
    incomeMonthlyItems,
    incomeAnnualItems,
    monthsCovered: pipeline.monthsCovered,
    periodDescription: `Last ${ROLLING_MONTHS} months`,
  };
}
