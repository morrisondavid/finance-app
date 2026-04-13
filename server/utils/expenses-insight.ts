/**
 * Morrison-style monthly insight: passive vs salary, net personal, joint need, bills/QoL split, debt terms.
 * Pure functions — uses recurring line items only.
 *
 * `isSalaryIncome` and `debtTermForMerchant` match on **normalised merchant display names**
 * (see `normalizeMerchant` / `merchant-registry.ts`). Renaming a display name there can break
 * these heuristics — keep patterns in sync or add regression tests when registry strings change.
 */

import type { ExpensesInsight, ExpensesLineItem, ExpensesSection } from '../../shared/api-contracts.js';
import { CATEGORY_NAMES } from './merchant-registry.js';
import type { CategoryName } from './merchant-registry.js';
import { SPECIAL_CATEGORY } from './category-constants.js';
import { round2 } from './math.js';

/**
 * Fixed / obligation categories (non–quality-of-life) for personal recurring spend.
 * QoL is the complement within CATEGORY_NAMES so new categories default to QoL unless explicitly
 * added here (avoids silent misclassification into “bills” via subtraction).
 * Exported for tests: partition of CATEGORY_NAMES into bills/obligations vs QoL.
 */
export const NON_QOL_CATEGORIES = new Set<CategoryName>([
  'Housing',
  'Utilities',
  'Insurance',
  'Tax',
  'Property',
  SPECIAL_CATEGORY.debtRepayment,
  'Business',
  SPECIAL_CATEGORY.transfers,
  SPECIAL_CATEGORY.income,
]);

export const QOL_CATEGORIES = new Set(
  CATEGORY_NAMES.filter((c) => !NON_QOL_CATEGORIES.has(c)),
);

function isQoLCategory(category: string): boolean {
  for (const c of QOL_CATEGORIES) {
    if (c === category) return true;
  }
  return false;
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
    /\b(SALARY|WAGE|PAYROLL|PAYE|EMPLOYMENT)\b|AUTONIZE|AUTONIZEITLIMITED|DIRECTOR|MONTHLY PAY|STAFF PAY|GROSS PAY|NET PAY|NI\s|N\.I\./i.test(
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

/** Split signed net into two non-negative amounts: shortfall (need) vs surplus (headroom). */
function shortfallSurplus(signedNet: number): { shortfall: number; surplus: number } {
  const x = round2(signedNet);
  if (x >= 0) return { shortfall: x, surplus: 0 };
  return { shortfall: 0, surplus: round2(-x) };
}

function dividendSplitFromIncome(items: ExpensesLineItem[]): { heena: number | null; david: number | null } {
  let heena = 0;
  let david = 0;
  let anyDiv = false;
  for (const i of items) {
    const m = i.merchant.toUpperCase();
    if (!/\bDIVIDEND\b|DIV\b.*LTD|DIV\s/i.test(m)) continue;
    anyDiv = true;
    if (/HEENA|H MORRISON|H\.MORRISON/i.test(m)) heena += i.amount;
    else if (/DAVID|D MORRISON|D\.MORRISON/i.test(m)) david += i.amount;
  }
  if (!anyDiv) return { heena: null, david: null };
  return { heena: round2(heena), david: round2(david) };
}

export function buildExpensesInsight(
  monthlyOutgoings: ExpensesSection[],
  incomeMonthlyItems: ExpensesLineItem[],
  totalMonthlyOutgoings: number,
  totalMonthlyIncome: number,
  personalMonthlyFixed: number,
  businessMonthlyFixed: number,
): ExpensesInsight {
  let totalSalary = 0;
  for (const i of incomeMonthlyItems) {
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

  for (const sec of monthlyOutgoings) {
    for (const item of sec.items) {
      if (item.category === SPECIAL_CATEGORY.debtRepayment) {
        const term = debtTermForMerchant(item.merchant);
        if (term === 'short') {
          debtShortTerm += item.amount;
        } else {
          debtMediumTerm += item.amount;
        }
      }
      if (item.ownership === 'personal' && isQoLCategory(item.category)) {
        qualityOfLifeExpenses += item.amount;
      }
    }
  }

  qualityOfLifeExpenses = round2(qualityOfLifeExpenses);
  const billsExpenses = round2(personalMonthlyFixed - qualityOfLifeExpenses);
  debtShortTerm = round2(debtShortTerm);
  debtMediumTerm = round2(debtMediumTerm);
  const debtTotal = round2(debtShortTerm + debtMediumTerm);

  const { heena: dividendHeena, david: dividendDavid } = dividendSplitFromIncome(incomeMonthlyItems);

  return {
    totalFixedMonthlyExpenses: totalMonthlyOutgoings,
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
    qualityOfLifeExpenses,
    billsExpenses,
    totalPassiveIncome,
    debtShortTerm,
    debtMediumTerm,
    debtTotal,
    dividendHeena,
    dividendDavid,
  };
}
