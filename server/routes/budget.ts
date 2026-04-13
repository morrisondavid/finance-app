import express, { Request, Response } from 'express';
import type {
  ExpensesLineItem,
  ExpensesSection,
  ExpensesSheetResponse,
  RecurringExpensesResponse,
} from '../../shared/api-contracts.js';
import { ACCOUNTS, ACCOUNT_CONFIG } from '../types.js';
import type { AccountName } from '../types.js';
import { getTransactions, getAvailableFinancialYears } from '../db/index.js';
import { CATEGORY_COLOURS, CATEGORY_NAMES } from '../utils/categorizer.js';
import { detectPassThrough } from '../utils/pass-through-detector.js';
import { buildExpensesInsight } from '../utils/expenses-insight.js';
import { round2, ROLLING_MONTHS, VARIANCE_EPS } from '../utils/math.js';
import { SPECIAL_CATEGORY } from '../utils/category-constants.js';
import {
  buildRecurringPipeline,
  recurringKey,
  accKey,
  type RawTransaction,
} from '../utils/recurring-pipeline.js';

export { accKey };

const router = express.Router();

interface OverviewQuery {
  financialYear?: string;
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

function rollingCutoffIsoDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toLineItem(
  e: { merchant: string; category: string; amount: number; sourceAccount: string; billingDay?: string | null },
  frequency: 'monthly' | 'annual',
  ownership: 'personal' | 'business',
  variance: Array<{ period: string; expected: number; actual: number }>,
): ExpensesLineItem {
  return {
    merchant: e.merchant,
    category: e.category,
    amount: e.amount,
    frequency,
    sourceAccount: e.sourceAccount,
    ownership,
    isVariable: false,
    billingDay: e.billingDay ?? null,
    variance,
  };
}

// ─── /overview ────────────────────────────────────────────────────────────────

router.get('/overview', (_req: Request<object, ExpensesSheetResponse, object, OverviewQuery>, res: Response<ExpensesSheetResponse | { error: string }>) => {
  try {
    const cutoff = rollingCutoffIsoDate(ROLLING_MONTHS);

    const scopedTransactions: RawTransaction[] = [];
    const allTimeTransactions: RawTransaction[] = [];

    for (const account of ACCOUNTS) {
      const txns = getTransactions({ account });
      for (const t of txns) {
        allTimeTransactions.push(t);
        if (t.date >= cutoff) {
          scopedTransactions.push(t);
        }
      }
    }

    const { passThroughIds } = detectPassThrough(scopedTransactions);

    const pipeline = buildRecurringPipeline({
      scopedTransactions,
      allTimeTransactions,
      passThroughIds,
      includeIncome: true,
    });

    // Build expense sections grouped by category
    const monthlyItemsByCategory = new Map<string, ExpensesLineItem[]>();
    for (const e of pipeline.monthlyExpenseRecurring) {
      const acc = pipeline.expenseAccumulators.get(recurringKey(e));
      const variance = acc ? computeMonthlyVariance(acc.monthlyTotals, e.amount) : [];
      const ownership = acc?.ownership ?? ACCOUNT_CONFIG[e.sourceAccount as AccountName]?.ownership ?? 'personal';
      const list = monthlyItemsByCategory.get(e.category) ?? [];
      list.push(toLineItem(e, 'monthly', ownership, variance));
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
        colour: CATEGORY_COLOURS[catName] ?? '#6B7280',
        subtotal: round2(items.reduce((s, i) => s + i.amount, 0)),
        items,
      });
    }

    const annualByCategory = new Map<string, ExpensesLineItem[]>();
    for (const e of pipeline.annualExpenseRecurring) {
      const acc = pipeline.expenseAccumulators.get(recurringKey(e));
      const variance = acc ? getAnnualVariance(acc.transactions, e.amount) : [];
      const ownership = ACCOUNT_CONFIG[e.sourceAccount as AccountName]?.ownership ?? 'personal';
      const list = annualByCategory.get(e.category) ?? [];
      list.push(toLineItem(e, 'annual', ownership, variance));
      annualByCategory.set(e.category, list);
    }
    const annualOutgoings: ExpensesSection[] = [];
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

    // Build income line items
    const incomeMonthlyItems: ExpensesLineItem[] = [];
    for (const e of pipeline.monthlyIncomeRecurring) {
      const acc = pipeline.incomeAccumulators.get(recurringKey(e));
      const variance = acc ? computeMonthlyVariance(acc.monthlyTotals, e.amount) : [];
      const ownership = ACCOUNT_CONFIG[e.sourceAccount as AccountName]?.ownership ?? 'personal';
      incomeMonthlyItems.push(toLineItem(e, 'monthly', ownership, variance));
    }
    const incomeAnnualItems: ExpensesLineItem[] = [];
    for (const e of pipeline.annualIncomeRecurring) {
      const acc = pipeline.incomeAccumulators.get(recurringKey(e));
      const variance = acc ? getAnnualVariance(acc.transactions, e.amount) : [];
      const ownership = ACCOUNT_CONFIG[e.sourceAccount as AccountName]?.ownership ?? 'personal';
      incomeAnnualItems.push(toLineItem(e, 'annual', ownership, variance));
    }
    incomeMonthlyItems.sort((a, b) => b.amount - a.amount);
    incomeAnnualItems.sort((a, b) => b.amount - a.amount);

    // Totals and splits
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
        if (item.category === SPECIAL_CATEGORY.debtRepayment) {
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
    );

    const response: ExpensesSheetResponse = {
      monthlyOutgoings,
      annualOutgoings,
      incomeMonthly: { items: incomeMonthlyItems, total: totalMonthlyIncome },
      incomeAnnual: { items: incomeAnnualItems, total: totalAnnualIncome },
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
        monthsCovered: pipeline.monthsCovered,
      },
    };

    res.json(response);
  } catch (error) {
    console.error('Error generating budget overview:', error);
    res.status(500).json({ error: 'Failed to generate budget overview' });
  }
});

// ─── /recurring ───────────────────────────────────────────────────────────────

interface RecurringQuery {
  account?: string;
  financialYear?: string;
}

router.get('/recurring', (req: Request<object, RecurringExpensesResponse, object, RecurringQuery>, res: Response<RecurringExpensesResponse | { error: string }>) => {
  try {
    const { account, financialYear } = req.query;
    const selectedAccount = account || ACCOUNTS[0];

    const allYears = getAvailableFinancialYears();
    const selectedFY = financialYear || allYears[0] || '';

    const fyTxns = getTransactions({
      account: selectedAccount,
      financialYear: selectedFY || undefined,
    });
    const allTimeTxns = getTransactions({ account: selectedAccount });

    const pipeline = buildRecurringPipeline({
      scopedTransactions: fyTxns,
      allTimeTransactions: allTimeTxns,
      includeIncome: false,
    });

    const response: RecurringExpensesResponse = {
      monthly: pipeline.monthlyExpenseRecurring,
      annual: pipeline.annualExpenseRecurring,
      account: selectedAccount,
      financialYear: selectedFY,
      monthsCovered: pipeline.monthsCovered,
    };

    res.json(response);
  } catch (error) {
    console.error('Error generating recurring expenses:', error);
    res.status(500).json({ error: 'Failed to generate recurring expenses' });
  }
});

export default router;
