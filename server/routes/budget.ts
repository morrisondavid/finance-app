import express, { Request, Response } from 'express';
import type {
  ExpensesLineItem,
  ExpensesSection,
  ExpensesSheetResponse,
  RecurringExpense,
  RecurringExpensesResponse,
} from '../../shared/api-contracts.js';
import { ACCOUNTS, ACCOUNT_CONFIG } from '../types.js';
import type { AccountName } from '../types.js';
import { getTransactions, getAvailableFinancialYears } from '../db/index.js';
import { categorizeTransaction, CATEGORY_COLOURS, CATEGORY_NAMES } from '../utils/categorizer.js';
import { normalizeMerchant } from '../utils/merchant-normalizer.js';
import { classifyRecurring } from '../utils/recurring-detector.js';
import type { RecurringCandidate, TransactionDetail } from '../utils/recurring-detector.js';
import { detectPassThrough } from '../utils/pass-through-detector.js';
import { buildExpensesInsight } from '../utils/expenses-insight.js';

const router = express.Router();

/** Rolling window for “current position” fixed-cost detection (not financial year). */
const ROLLING_MONTHS = 24;

interface OverviewQuery {
  financialYear?: string;
}

interface HouseholdAccumulator {
  merchant: string;
  category: string;
  sourceAccount: string;
  ownership: 'personal' | 'business';
  monthlyTotals: Map<string, number>;
  annualTotal: number;
  transactions: TransactionDetail[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toYearMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function accKey(category: string, merchant: string, account: string, amount: number): string {
  return `${category}|${merchant}|${account}|${Math.round(amount)}`;
}

function computeMonthlyVariance(
  monthlyTotals: Map<string, number>,
  typical: number,
): Array<{ month: string; expected: number; actual: number }> {
  const EPS = 0.005;
  const out: Array<{ month: string; expected: number; actual: number }> = [];
  for (const [ym, actual] of monthlyTotals) {
    if (Math.abs(actual - typical) > EPS) {
      out.push({ month: ym, expected: round2(typical), actual: round2(actual) });
    }
  }
  out.sort((a, b) => a.month.localeCompare(b.month));
  return out;
}

function getAnnualVariance(transactions: TransactionDetail[], typical: number): Array<{ month: string; expected: number; actual: number }> {
  const byYear = new Map<number, number>();
  for (const t of transactions) {
    const y = parseInt(t.date.slice(0, 4), 10);
    byYear.set(y, Math.max(byYear.get(y) ?? 0, t.amount));
  }
  const EPS = 0.005;
  const out: Array<{ month: string; expected: number; actual: number }> = [];
  for (const [year, actual] of byYear) {
    if (Math.abs(actual - typical) > EPS) {
      out.push({ month: String(year), expected: round2(typical), actual: round2(actual) });
    }
  }
  out.sort((a, b) => a.month.localeCompare(b.month));
  return out;
}

function recurringKey(e: RecurringExpense): string {
  return accKey(e.category, e.merchant, e.sourceAccount);
}

function rollingCutoffIsoDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

router.get('/overview', (_req: Request<object, ExpensesSheetResponse, object, OverviewQuery>, res: Response<ExpensesSheetResponse | { error: string }>) => {
  try {
    const cutoff = rollingCutoffIsoDate(ROLLING_MONTHS);

    const allTransactions: Array<{
      id: number;
      date: string;
      description: string;
      amount: number;
      account: string;
      type: 'income' | 'expense' | 'transfer';
    }> = [];

    for (const account of ACCOUNTS) {
      const txns = getTransactions({ account });
      for (const t of txns) {
        if (t.date >= cutoff) {
          allTransactions.push(t);
        }
      }
    }

    const { passThroughIds } = detectPassThrough(allTransactions);

    const expenseAccumulators = new Map<string, HouseholdAccumulator>();
    const incomeAccumulators = new Map<string, HouseholdAccumulator>();
    const allMonths = new Set<string>();

    for (const txn of allTransactions) {
      if (passThroughIds.has(txn.id)) continue;

      const isExpense = txn.type === 'expense' || (txn.type === 'transfer' && txn.amount < 0);
      const isIncome = txn.type === 'income' || (txn.type === 'transfer' && txn.amount > 0);
      if (!isExpense && !isIncome) continue;

      const category = isIncome ? 'Income' : categorizeTransaction(txn.description);
      if (category === 'Transfers') continue;

      const merchant = normalizeMerchant(txn.description);
      const account = txn.account;
      const config = ACCOUNT_CONFIG[account as AccountName];
      const ownership = config?.ownership ?? 'personal';
      const absAmount = Math.abs(txn.amount);
      const key = accKey(category, merchant, account, absAmount);
      const ym = toYearMonth(txn.date);
      allMonths.add(ym);

      const map = category === 'Income' ? incomeAccumulators : expenseAccumulators;
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

    for (const account of ACCOUNTS) {
      const allTimeTxns = getTransactions({ account });
      for (const txn of allTimeTxns) {
        const isExpense = txn.type === 'expense' || (txn.type === 'transfer' && txn.amount < 0);
        const isIncome = txn.type === 'income' || (txn.type === 'transfer' && txn.amount > 0);
        if (!isExpense && !isIncome) continue;

        const category = isIncome ? 'Income' : categorizeTransaction(txn.description);
        if (category === 'Transfers') continue;

        const merchant = normalizeMerchant(txn.description);
        const absAmount = Math.abs(txn.amount);
        const key = accKey(category, merchant, account, absAmount);
        const map = category === 'Income' ? incomeAccumulators : expenseAccumulators;
        const acc = map.get(key);
        if (!acc) continue;
        acc.transactions.push({ date: txn.date, amount: absAmount });
      }
    }

    const monthsCovered = allMonths.size || 1;

    const toCandidates = (map: Map<string, HouseholdAccumulator>): RecurringCandidate[] => {
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
    };

    const expenseCandidates = toCandidates(expenseAccumulators);
    const incomeCandidates = toCandidates(incomeAccumulators);

    const { monthly: monthlyExpenseRecurring, annual: annualExpenseRecurring } = classifyRecurring(
      expenseCandidates,
      monthsCovered,
    );
    const { monthly: monthlyIncomeRecurring, annual: annualIncomeRecurring } = classifyRecurring(
      incomeCandidates,
      monthsCovered,
    );

    const monthlyItemsByCategory = new Map<string, ExpensesLineItem[]>();

    const pushItem = (category: string, item: ExpensesLineItem): void => {
      const list = monthlyItemsByCategory.get(category) ?? [];
      list.push(item);
      monthlyItemsByCategory.set(category, list);
    };

    for (const e of monthlyExpenseRecurring) {
      const key = recurringKey(e);
      const acc = expenseAccumulators.get(key);
      const variance = acc
        ? computeMonthlyVariance(acc.monthlyTotals, e.amount)
        : [];
      const ownership = acc?.ownership ?? ACCOUNT_CONFIG[e.sourceAccount as AccountName]?.ownership ?? 'personal';
      pushItem(e.category, {
        merchant: e.merchant,
        category: e.category,
        amount: e.amount,
        frequency: 'monthly',
        sourceAccount: e.sourceAccount,
        ownership,
        isVariable: false,
        billingDay: e.billingDay,
        variance,
      });
    }

    const categoryOrder = [...CATEGORY_NAMES, 'Other'];
    const monthlyOutgoings: ExpensesSection[] = [];
    for (const catName of categoryOrder) {
      const items = monthlyItemsByCategory.get(catName);
      if (!items || items.length === 0) continue;
      items.sort((a, b) => b.amount - a.amount);
      monthlyOutgoings.push({
        name: catName,
        colour: CATEGORY_COLOURS[catName] ?? '#6B7280',
        subtotal: round2(items.reduce((s, i) => s + i.amount, 0)),
        items,
      });
    }

    const annualOutgoings: ExpensesSection[] = [];
    const annualByCategory = new Map<string, ExpensesLineItem[]>();
    for (const e of annualExpenseRecurring) {
      const key = recurringKey(e);
      const acc = expenseAccumulators.get(key);
      const variance = acc ? getAnnualVariance(acc.transactions, e.amount) : [];
      const item: ExpensesLineItem = {
        merchant: e.merchant,
        category: e.category,
        amount: e.amount,
        frequency: 'annual',
        sourceAccount: e.sourceAccount,
        ownership: ACCOUNT_CONFIG[e.sourceAccount as AccountName]?.ownership ?? 'personal',
        isVariable: false,
        billingDay: e.billingDay,
        variance,
      };
      const list = annualByCategory.get(e.category) ?? [];
      list.push(item);
      annualByCategory.set(e.category, list);
    }
    for (const catName of categoryOrder) {
      const items = annualByCategory.get(catName);
      if (!items || items.length === 0) continue;
      items.sort((a, b) => b.amount - a.amount);
      annualOutgoings.push({
        name: catName,
        colour: CATEGORY_COLOURS[catName] ?? '#6B7280',
        subtotal: round2(items.reduce((s, i) => s + i.amount, 0)),
        items,
      });
    }

    const incomeMonthlyItems: ExpensesLineItem[] = [];
    const incomeAnnualItems: ExpensesLineItem[] = [];

    for (const e of monthlyIncomeRecurring) {
      const key = recurringKey(e);
      const acc = incomeAccumulators.get(key);
      const variance = acc ? computeMonthlyVariance(acc.monthlyTotals, e.amount) : [];
      incomeMonthlyItems.push({
        merchant: e.merchant,
        category: 'Income',
        amount: e.amount,
        frequency: 'monthly',
        sourceAccount: e.sourceAccount,
        ownership: ACCOUNT_CONFIG[e.sourceAccount as AccountName]?.ownership ?? 'personal',
        isVariable: false,
        billingDay: e.billingDay,
        variance,
      });
    }

    for (const e of annualIncomeRecurring) {
      const key = recurringKey(e);
      const acc = incomeAccumulators.get(key);
      const variance = acc ? getAnnualVariance(acc.transactions, e.amount) : [];
      incomeAnnualItems.push({
        merchant: e.merchant,
        category: 'Income',
        amount: e.amount,
        frequency: 'annual',
        sourceAccount: e.sourceAccount,
        ownership: ACCOUNT_CONFIG[e.sourceAccount as AccountName]?.ownership ?? 'personal',
        isVariable: false,
        billingDay: e.billingDay,
        variance,
      });
    }

    incomeMonthlyItems.sort((a, b) => b.amount - a.amount);
    incomeAnnualItems.sort((a, b) => b.amount - a.amount);

    const totalMonthlyOutgoings = round2(monthlyOutgoings.reduce((s, sec) => s + sec.subtotal, 0));
    const totalAnnualOutgoings = round2(annualOutgoings.reduce((s, sec) => s + sec.subtotal, 0));

    const totalMonthlyIncome = round2(incomeMonthlyItems.reduce((s, i) => s + i.amount, 0));
    const totalAnnualIncome = round2(incomeAnnualItems.reduce((s, i) => s + i.amount, 0));

    let personalMonthlyFixed = 0;
    let businessMonthlyFixed = 0;
    let debtMonthlyFixed = 0;
    for (const sec of monthlyOutgoings) {
      for (const item of sec.items) {
        if (item.ownership === 'business') {
          businessMonthlyFixed += item.amount;
        } else {
          personalMonthlyFixed += item.amount;
        }
        if (item.category === 'Debt Repayment') {
          debtMonthlyFixed += item.amount;
        }
      }
    }
    personalMonthlyFixed = round2(personalMonthlyFixed);
    businessMonthlyFixed = round2(businessMonthlyFixed);
    debtMonthlyFixed = round2(debtMonthlyFixed);

    const netMonthlyFixed = round2(totalMonthlyIncome - totalMonthlyOutgoings);
    const needToEarnMonthly = round2(Math.max(0, totalMonthlyOutgoings - totalMonthlyIncome));
    const monthlySurplus = round2(Math.max(0, totalMonthlyIncome - totalMonthlyOutgoings));
    const netAnnualFixed = round2(totalAnnualIncome - totalAnnualOutgoings);

    const insight = buildExpensesInsight(
      monthlyOutgoings,
      incomeMonthlyItems,
      totalMonthlyOutgoings,
      totalMonthlyIncome,
      personalMonthlyFixed,
      businessMonthlyFixed,
      debtMonthlyFixed,
    );

    const response: ExpensesSheetResponse = {
      monthlyOutgoings,
      annualOutgoings,
      incomeMonthly: {
        items: incomeMonthlyItems,
        total: totalMonthlyIncome,
      },
      incomeAnnual: {
        items: incomeAnnualItems,
        total: totalAnnualIncome,
      },
      insight,
      summary: {
        totalMonthlyOutgoings,
        totalAnnualOutgoings,
        totalMonthlyIncome,
        totalAnnualIncome,
        netMonthlyFixed,
        needToEarnMonthly,
        monthlySurplus,
        personalMonthlyFixed,
        businessMonthlyFixed,
        debtMonthlyFixed,
        netAnnualFixed,
        periodDescription: `Last ${ROLLING_MONTHS} months`,
        monthsCovered,
      },
    };

    res.json(response);
  } catch (error) {
    console.error('Error generating budget overview:', error);
    res.status(500).json({ error: 'Failed to generate budget overview' });
  }
});

interface RecurringQuery {
  account?: string;
  financialYear?: string;
}

interface RecurringAccumulator {
  merchant: string;
  category: string;
  sourceAccount: string;
  ownership: 'personal' | 'business';
  monthlyTotals: Map<string, number>;
  annualTotal: number;
  transactions: TransactionDetail[];
}

router.get('/recurring', (req: Request<object, RecurringExpensesResponse, object, RecurringQuery>, res: Response<RecurringExpensesResponse | { error: string }>) => {
  try {
    const { account, financialYear } = req.query;
    const selectedAccount = account || ACCOUNTS[0];

    const allYears = getAvailableFinancialYears();
    const selectedFY = financialYear || allYears[0] || '';

    // FY-scoped transactions for monthly totals and monthsActive
    const fyTxns = getTransactions({
      account: selectedAccount,
      financialYear: selectedFY || undefined,
    });

    // All-time transactions so annual detection can see multi-year patterns
    const allTimeTxns = getTransactions({ account: selectedAccount });

    const accumulators = new Map<string, RecurringAccumulator>();
    const allMonths = new Set<string>();

    // First pass: build FY-scoped monthly totals
    for (const txn of fyTxns) {
      const isExpense = txn.type === 'expense' || (txn.type === 'transfer' && txn.amount < 0);
      if (!isExpense) continue;

      const category = categorizeTransaction(txn.description);
      if (category === 'Transfers') continue;

      const merchant = normalizeMerchant(txn.description);
      const config = ACCOUNT_CONFIG[selectedAccount as AccountName];
      const ownership = config?.ownership ?? 'personal';
      const absAmount = Math.abs(txn.amount);
      const key = `${category}|${merchant}|${Math.round(absAmount)}`;
      const ym = toYearMonth(txn.date);
      allMonths.add(ym);

      let acc = accumulators.get(key);
      if (!acc) {
        acc = {
          merchant,
          category,
          sourceAccount: selectedAccount,
          ownership,
          monthlyTotals: new Map(),
          annualTotal: 0,
          transactions: [],
        };
        accumulators.set(key, acc);
      }

      acc.annualTotal += absAmount;
      acc.monthlyTotals.set(ym, (acc.monthlyTotals.get(ym) ?? 0) + absAmount);
    }

    // Second pass: attach ALL-TIME transaction details for annual detection
    for (const txn of allTimeTxns) {
      const isExpense = txn.type === 'expense' || (txn.type === 'transfer' && txn.amount < 0);
      if (!isExpense) continue;

      const category = categorizeTransaction(txn.description);
      if (category === 'Transfers') continue;

      const merchant = normalizeMerchant(txn.description);
      const absAmount = Math.abs(txn.amount);
      const key = `${category}|${merchant}|${Math.round(absAmount)}`;

      const acc = accumulators.get(key);
      if (!acc) continue;

      acc.transactions.push({ date: txn.date, amount: absAmount });
    }

    const monthsCovered = allMonths.size || 1;

    const candidates: RecurringCandidate[] = [];
    for (const acc of accumulators.values()) {
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

    const { monthly, annual } = classifyRecurring(candidates, monthsCovered);

    const response: RecurringExpensesResponse = {
      monthly,
      annual,
      account: selectedAccount,
      financialYear: selectedFY,
      monthsCovered,
    };

    res.json(response);
  } catch (error) {
    console.error('Error generating recurring expenses:', error);
    res.status(500).json({ error: 'Failed to generate recurring expenses' });
  }
});

export default router;
