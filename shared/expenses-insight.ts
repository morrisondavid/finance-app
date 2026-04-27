/**
 * Monthly insight: external income, net lines, bills/QoL split, debt terms.
 * Pure functions — safe in browser and server.
 */

import type { ExpensesInsight, ExpensesLineItem, ExpensesSection } from './api-contracts.js';
import { CATEGORY_NAMES } from './category-names.js';
import type { CategoryName } from './category-names.js';
import { SPECIAL_CATEGORY } from './special-category.js';
import { round2 } from './math-round.js';

/**
 * Fixed / obligation categories (non–quality-of-life) for personal recurring spend.
 * QoL is the complement within CATEGORY_NAMES so new categories default to QoL unless explicitly
 * added here (avoids silent misclassification into “bills” via subtraction).
 */
export const NON_QOL_CATEGORIES = new Set<CategoryName>([
  'Housing',
  'Utilities',
  'Insurance',
  'Tax',
  'Property',
  'Dividends',
  SPECIAL_CATEGORY.debtRepayment,
  'Business',
  SPECIAL_CATEGORY.payroll,
  SPECIAL_CATEGORY.transfers,
  SPECIAL_CATEGORY.income,
]);

export const QOL_CATEGORIES = new Set(
  CATEGORY_NAMES.filter((c) => !NON_QOL_CATEGORIES.has(c)),
);

/**
 * Internal predicate for the dashboard's bills-vs-lifestyle insight
 * partitioning. Returns true for any category that's NOT in
 * {@link NON_QOL_CATEGORIES} — i.e. anything we'd render in the
 * "discretionary lifestyle" bucket of the monthly insight chart.
 *
 * This is the **legacy QoL-by-complement** definition. §1.9 introduced
 * a stricter notion of "QoL" (the inviolable lifestyle floor for the
 * Debt Strategy planner — exported below as {@link isQoLCategory}).
 * The two definitions deliberately differ: the legacy set is broader
 * (includes Eating Out, Travel, Shopping, etc.); the strict set is
 * just the three explicitly-tagged ones (Groceries, Childcare &
 * Education, Health & Personal).
 */
function isNonMandatoryBudgetable(category: string): boolean {
  for (const c of QOL_CATEGORIES) {
    if (c === category) return true;
  }
  return false;
}

/**
 * String-domain predicate for "this category is a mandatory bill / obligation",
 * mirroring {@link NON_QOL_CATEGORIES} membership without forcing callers to
 * narrow an arbitrary string into {@link CategoryName} themselves. Unknown
 * categories are treated as QoL — same default as the QoL-by-complement rule
 * above.
 */
export function isMandatoryCategory(category: string): boolean {
  for (const c of NON_QOL_CATEGORIES) {
    if (c === category) return true;
  }
  return false;
}

/**
 * Strict QoL category set (§1.9 — Debt Strategy planner). These are
 * the categories the planner treats as **inviolable**: it never
 * proposes reducing a budget cap on these. Anything else is either
 * mandatory (caught by {@link isMandatoryCategory}) or malleable
 * (the planner can show it as a manual-adjustment candidate in the
 * activation UI).
 *
 * This set must stay in sync with the `qol: true` tagged entries in
 * `server/utils/categorizer.ts` `CATEGORY_CONFIG`. A dedicated test
 * locks the invariant.
 */
export const QOL_STRICT_CATEGORIES = new Set<CategoryName>([
  'Groceries',
  'Childcare & Education',
  'Health & Personal',
]);

/**
 * Strict QoL-category predicate (§1.9). Returns true ONLY for the
 * categories the planner is forbidden from proposing cuts to.
 * Mandatory categories return false (they're a separate class —
 * use {@link isMandatoryCategory} for those). Malleable categories
 * (Eating Out, Transport, Shopping, etc.) also return false.
 */
export function isQoLCategory(category: string): boolean {
  for (const c of QOL_STRICT_CATEGORIES) {
    if (c === category) return true;
  }
  return false;
}

function itemCountsTowardInsight(
  item: ExpensesLineItem,
  excludedLineKeys: ReadonlySet<string> | undefined,
): boolean {
  if (excludedLineKeys === undefined || excludedLineKeys.size === 0) return true;
  return !excludedLineKeys.has(item.lineKey);
}

/** Recurring income that looks like employment pay (not dividends, rent, etc.). */
export function isSalaryIncome(merchant: string): boolean {
  const m = merchant.toUpperCase();
  if (
    /\b(DIVIDEND|DIV\b|RENT RECEIVED|RENTAL INC|FROM SAVINGS|INTEREST CREDIT|CASHBACK|REFUND FROM)\b/i.test(m)
  ) {
    return false;
  }
  return (
    /\b(SALARY|WAGE|PAYROLL|PAYE|EMPLOYMENT)\b|DIRECTOR|MONTHLY PAY|STAFF PAY|GROSS PAY|NET PAY|NI\s|N\.I\./i.test(
      m,
    )
  );
}

/** Rough split: revolving/cards = short, term loans/finance agreements = medium. */
export function debtTermForMerchant(merchant: string): 'short' | 'medium' {
  const m = merchant.toUpperCase();
  if (
    /BOUNCE BACK|NOVUNA|FORD CREDIT|CREDIT STYLE|PARTNER FINANCE|PERSONAL LOAN|CAR LOAN/i.test(m)
  ) {
    return 'medium';
  }
  return 'short';
}

function shortfallSurplus(signedNet: number): { shortfall: number; surplus: number } {
  const x = round2(signedNet);
  if (x >= 0) return { shortfall: x, surplus: 0 };
  return { shortfall: 0, surplus: round2(-x) };
}

export function buildExpensesInsight(
  monthlyOutgoings: ExpensesSection[],
  incomeMonthlyItems: ExpensesLineItem[],
  totalMonthlyOutgoings: number,
  totalMonthlyIncome: number,
  personalMonthlyFixed: number,
  businessMonthlyFixed: number,
  excludedLineKeys?: ReadonlySet<string>,
): ExpensesInsight {
  let totalSalary = 0;
  for (const i of incomeMonthlyItems) {
    if (!itemCountsTowardInsight(i, excludedLineKeys)) continue;
    if (isSalaryIncome(i.merchant)) {
      totalSalary += i.amount;
    }
  }
  totalSalary = round2(totalSalary);

  const totalPassiveIncome = round2(totalMonthlyIncome - totalSalary);

  const rawNetIncluded = round2(totalMonthlyOutgoings - totalPassiveIncome);
  const rawNetExcluded = round2(rawNetIncluded - totalSalary);
  const rawNetPersonalExcluded = round2(rawNetExcluded - businessMonthlyFixed);

  const afterPassive = shortfallSurplus(rawNetIncluded);
  const afterSalary = shortfallSurplus(rawNetExcluded);
  const afterPersonal = shortfallSurplus(rawNetPersonalExcluded);

  const businessExpensesSalaryExcluded = round2(Math.max(0, businessMonthlyFixed - totalSalary));

  let qualityOfLifeExpenses = 0;
  let debtShortTerm = 0;
  let debtMediumTerm = 0;
  let natwestPersonalFixed = 0;

  for (const sec of monthlyOutgoings) {
    for (const item of sec.items) {
      if (!itemCountsTowardInsight(item, excludedLineKeys)) continue;
      if (item.category === SPECIAL_CATEGORY.debtRepayment) {
        const term = debtTermForMerchant(item.merchant);
        if (term === 'short') {
          debtShortTerm += item.amount;
        } else {
          debtMediumTerm += item.amount;
        }
      }
      if (item.accountCategory === 'personal' && isNonMandatoryBudgetable(item.category)) {
        qualityOfLifeExpenses += item.amount;
      }
      if (item.sourceAccount === 'natwest' && item.accountCategory === 'personal') {
        natwestPersonalFixed += item.amount;
      }
    }
  }

  qualityOfLifeExpenses = round2(qualityOfLifeExpenses);
  const billsExpenses = round2(personalMonthlyFixed - qualityOfLifeExpenses);
  debtShortTerm = round2(debtShortTerm);
  debtMediumTerm = round2(debtMediumTerm);
  const debtTotal = round2(debtShortTerm + debtMediumTerm);
  natwestPersonalFixed = round2(natwestPersonalFixed);

  const monthlyIncomeNeededAfterPassive = round2(Math.max(0, rawNetIncluded));

  return {
    totalFixedMonthlyExpenses: totalMonthlyOutgoings,
    monthlyIncomeNeededAfterPassive,
    netExpensesSalaryIncludedShortfall: afterPassive.shortfall,
    netExpensesSalaryIncludedSurplus: afterPassive.surplus,
    netExpensesSalaryExcludedShortfall: afterSalary.shortfall,
    netExpensesSalaryExcludedSurplus: afterSalary.surplus,
    netPersonalExpensesSalaryExcludedShortfall: afterPersonal.shortfall,
    netPersonalExpensesSalaryExcludedSurplus: afterPersonal.surplus,
    moneyNeededJointAccount: afterPersonal.shortfall,
    jointAccountMonthlySurplus: afterPersonal.surplus,
    businessExpenses: businessMonthlyFixed,
    businessExpensesSalaryExcluded,
    totalSalary,
    personalExpenses: personalMonthlyFixed,
    natwestPersonalFixed,
    qualityOfLifeExpenses,
    billsExpenses,
    totalPassiveIncome,
    debtShortTerm,
    debtMediumTerm,
    debtTotal,
    dividendHeena: null,
    dividendDavid: null,
  };
}

export function computeYearlyFixedInsightFigures(
  insight: ExpensesInsight,
  totalAnnualOutgoings: number,
  incomeAnnualItems: readonly ExpensesLineItem[],
  excludedLineKeys?: ReadonlySet<string>,
): {
  totalYearlyFixedOutgoings: number;
  totalYearlyPassiveIncome: number;
  yearlyIncomeNeededAfterPassive: number;
} {
  let annualPassiveIncome = 0;
  for (const i of incomeAnnualItems) {
    if (!itemCountsTowardInsight(i, excludedLineKeys)) continue;
    if (!isSalaryIncome(i.merchant)) {
      annualPassiveIncome += i.amount;
    }
  }
  annualPassiveIncome = round2(annualPassiveIncome);
  const totalYearlyFixedOutgoings = round2(12 * insight.totalFixedMonthlyExpenses + totalAnnualOutgoings);
  const totalYearlyPassiveIncome = round2(12 * insight.totalPassiveIncome + annualPassiveIncome);
  const yearlyIncomeNeededAfterPassive = round2(Math.max(0, totalYearlyFixedOutgoings - totalYearlyPassiveIncome));
  return { totalYearlyFixedOutgoings, totalYearlyPassiveIncome, yearlyIncomeNeededAfterPassive };
}
