/**
 * Morrison-style monthly insight: passive vs salary, net personal, joint need, bills/QoL split, debt terms.
 * Pure functions — uses recurring line items only.
 */

import type { ExpensesInsight, ExpensesLineItem, ExpensesSection } from '../../shared/api-contracts.js';

const BILLS_CATEGORIES = new Set([
  'Housing',
  'Utilities',
  'Insurance',
  'Tax',
  'Property',
]);

const QOL_CATEGORIES = new Set([
  'Groceries',
  'Eating Out',
  'Transport',
  'Entertainment',
  'Shopping',
  'Travel',
  'Health & Personal',
  'Childcare & Education',
  'Other',
]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
  debtMonthlyFixed: number,
): ExpensesInsight {
  let totalSalary = 0;
  for (const i of incomeMonthlyItems) {
    if (isSalaryIncome(i.merchant)) {
      totalSalary += i.amount;
    }
  }
  totalSalary = round2(totalSalary);

  const totalPassiveIncome = round2(totalMonthlyIncome - totalSalary);

  const netExpensesSalaryIncluded = round2(totalMonthlyOutgoings - totalPassiveIncome);
  const netExpensesSalaryExcluded = round2(netExpensesSalaryIncluded - totalSalary);
  const netPersonalExpensesSalaryExcluded = round2(netExpensesSalaryExcluded - businessMonthlyFixed);
  const moneyNeededJointAccount = netPersonalExpensesSalaryExcluded;

  const businessExpensesSalaryExcluded = round2(Math.max(0, businessMonthlyFixed - totalSalary));

  let qualityOfLifeExpenses = 0;
  let debtShortTerm = 0;
  let debtMediumTerm = 0;

  for (const sec of monthlyOutgoings) {
    for (const item of sec.items) {
      if (item.category === 'Debt Repayment') {
        const term = debtTermForMerchant(item.merchant);
        if (term === 'short') {
          debtShortTerm += item.amount;
        } else {
          debtMediumTerm += item.amount;
        }
      }
      if (item.ownership === 'personal' && QOL_CATEGORIES.has(item.category)) {
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
    netExpensesSalaryIncluded,
    netExpensesSalaryExcluded,
    netPersonalExpensesSalaryExcluded,
    moneyNeededJointAccount,
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
