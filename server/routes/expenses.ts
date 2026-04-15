import express, { Request, Response } from 'express';
import {
  SimulationExclusionsPutBodySchema,
  type AdHocExpensesResponse,
  type AdHocMerchantSeriesResponse,
  type ExpensesLineItem,
  type ExpensesSection,
  type ExpensesSheetResponse,
  type RecurringExpense,
  type RecurringExpensesResponse,
} from '../../shared/api-contracts.js';
import { ACCOUNTS, ACCOUNT_CONFIG, isValidAccountName } from '../types.js';
import type { AccountName } from '../types.js';
import {
  getTransactions,
  getAvailableFinancialYears,
  getFinancialYearRange,
} from '../db/index.js';
import { categoryColour, CATEGORY_NAMES } from '../utils/categorizer.js';
import { round2, ROLLING_MONTHS, VARIANCE_EPS } from '../utils/math.js';
import { buildExpensesSheetResponse, applySimulationExclusions } from '../../shared/expenses-sheet-build.js';
import {
  getFixedExpenseSimulationExclusions,
  replaceFixedExpenseSimulationExclusions,
} from '../db/repositories/fixed-expense-simulation-exclusions.js';
import {
  recurringKey,
  accKey,
  type RawTransaction,
} from '../utils/recurring-pipeline.js';
import {
  runExpensesOverviewPipeline,
  buildExpensePipelineForAccount,
  transactionRowToRaw,
} from '../utils/expenses-overview-pipeline.js';
import {
  AD_HOC_DEFAULT_LIMIT,
  AD_HOC_DEFAULT_MIN_TOTAL,
  AD_HOC_MAX_LIMIT,
  computeAdHocExpenseGroups,
} from '../utils/ad-hoc-expenses.js';
import {
  computeAdHocMerchantSeries,
  parseAdHocBucketKey,
} from '../utils/ad-hoc-merchant-series.js';

export { accKey };

function oldestIsoDate(rows: RawTransaction[]): string {
  if (rows.length === 0) return '';
  return rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date);
}

function formatUkLong(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

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

function makeLineKey(
  direction: 'expense' | 'income',
  frequency: 'monthly' | 'annual',
  e: RecurringExpense,
): string {
  return `${direction}|${frequency}|${recurringKey(e)}`;
}

function toLineItem(
  e: RecurringExpense,
  frequency: 'monthly' | 'annual',
  ownership: 'personal' | 'business',
  variance: Array<{ period: string; expected: number; actual: number }>,
  direction: 'expense' | 'income',
): ExpensesLineItem {
  return {
    lineKey: makeLineKey(direction, frequency, e),
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
    const pipeline = runExpensesOverviewPipeline();

    // Build expense sections grouped by category
    const monthlyItemsByCategory = new Map<string, ExpensesLineItem[]>();
    for (const e of pipeline.monthlyExpenseRecurring) {
      const acc = pipeline.expenseAccumulators.get(recurringKey(e));
      const variance = acc ? computeMonthlyVariance(acc.monthlyTotals, e.amount) : [];
      const ownership = acc?.ownership ?? ACCOUNT_CONFIG[e.sourceAccount as AccountName]?.ownership ?? 'personal';
      const list = monthlyItemsByCategory.get(e.category) ?? [];
      list.push(toLineItem(e, 'monthly', ownership, variance, 'expense'));
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
      const ownership = ACCOUNT_CONFIG[e.sourceAccount as AccountName]?.ownership ?? 'personal';
      const list = annualByCategory.get(e.category) ?? [];
      list.push(toLineItem(e, 'annual', ownership, variance, 'expense'));
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

    // Build income line items
    const incomeMonthlyItems: ExpensesLineItem[] = [];
    for (const e of pipeline.monthlyIncomeRecurring) {
      const acc = pipeline.incomeAccumulators.get(recurringKey(e));
      const variance = acc ? computeMonthlyVariance(acc.monthlyTotals, e.amount) : [];
      const ownership = ACCOUNT_CONFIG[e.sourceAccount as AccountName]?.ownership ?? 'personal';
      incomeMonthlyItems.push(toLineItem(e, 'monthly', ownership, variance, 'income'));
    }
    const incomeAnnualItems: ExpensesLineItem[] = [];
    for (const e of pipeline.annualIncomeRecurring) {
      const acc = pipeline.incomeAccumulators.get(recurringKey(e));
      const variance = acc ? getAnnualVariance(acc.transactions, e.amount) : [];
      const ownership = ACCOUNT_CONFIG[e.sourceAccount as AccountName]?.ownership ?? 'personal';
      incomeAnnualItems.push(toLineItem(e, 'annual', ownership, variance, 'income'));
    }
    incomeMonthlyItems.sort((a, b) => b.amount - a.amount);
    incomeAnnualItems.sort((a, b) => b.amount - a.amount);

    const baseline = buildExpensesSheetResponse({
      monthlyOutgoings,
      annualOutgoings,
      incomeMonthlyItems,
      incomeAnnualItems,
      monthsCovered: pipeline.monthsCovered,
      periodDescription: `Last ${ROLLING_MONTHS} months`,
    });
    const persisted = new Set(getFixedExpenseSimulationExclusions());
    const response = applySimulationExclusions(baseline, persisted);

    res.json(response);
  } catch (error) {
    console.error('Error generating expenses sheet overview:', error);
    res.status(500).json({ error: 'Failed to generate expenses sheet overview' });
  }
});

router.get('/simulation-exclusions', (_req, res) => {
  try {
    res.json({ lineKeys: getFixedExpenseSimulationExclusions() });
  } catch (error) {
    console.error('Error reading simulation exclusions:', error);
    res.status(500).json({ error: 'Failed to read simulation exclusions' });
  }
});

router.put('/simulation-exclusions', (req, res) => {
  try {
    const parsed = SimulationExclusionsPutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body: expected { lineKeys: string[] }' });
      return;
    }
    replaceFixedExpenseSimulationExclusions(parsed.data.lineKeys);
    res.json({ lineKeys: getFixedExpenseSimulationExclusions() });
  } catch (error) {
    console.error('Error saving simulation exclusions:', error);
    res.status(500).json({ error: 'Failed to save simulation exclusions' });
  }
});

// ─── /ad-hoc ───────────────────────────────────────────────────────────────────

interface AdHocQuery {
  account?: string;
  financialYear?: string;
  min?: string;
  limit?: string;
}

interface AdHocSeriesQuery {
  account?: string;
  financialYear?: string;
  bucketKey?: string;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

router.get(
  '/ad-hoc/series',
  (req: Request<object, AdHocMerchantSeriesResponse, object, AdHocSeriesQuery>, res: Response<AdHocMerchantSeriesResponse | { error: string }>) => {
    try {
      const accountRaw = req.query.account;
      if (!accountRaw || typeof accountRaw !== 'string' || !isValidAccountName(accountRaw)) {
        res.status(400).json({ error: 'Invalid or missing account' });
        return;
      }
      const account = accountRaw as AccountName;

      const fyRaw = req.query.financialYear;
      const financialYear =
        typeof fyRaw === 'string' && fyRaw.trim() !== '' ? fyRaw.trim() : null;

      if (financialYear !== null) {
        const validYears = getAvailableFinancialYears();
        if (!validYears.includes(financialYear)) {
          res.status(400).json({ error: 'Invalid financial year' });
          return;
        }
      }

      const bucketKeyRaw = req.query.bucketKey;
      if (typeof bucketKeyRaw !== 'string' || bucketKeyRaw.trim() === '') {
        res.status(400).json({ error: 'Missing or invalid bucketKey' });
        return;
      }
      const bucketKey = bucketKeyRaw.trim();

      const pipeline = buildExpensePipelineForAccount(account, financialYear ?? undefined);
      const expenseRows = getTransactions({
        account,
        financialYear: financialYear ?? undefined,
        type: 'expense',
      });
      const expenseTransactions = expenseRows.map(transactionRowToRaw);

      const points = computeAdHocMerchantSeries({
        pipeline,
        account,
        expenseTransactions,
        bucketKey,
      });
      if (points === null) {
        res.status(400).json({ error: 'Invalid bucketKey for this account' });
        return;
      }

      let periodDescription: string;
      if (financialYear !== null) {
        const range = getFinancialYearRange(financialYear);
        periodDescription = `${formatUkLong(range.startDate)} – ${formatUkLong(range.endDate)} (${range.label})`;
      } else {
        periodDescription = 'All time';
      }

      const parsed = parseAdHocBucketKey(bucketKey, account);
      if (parsed === null) {
        res.status(400).json({ error: 'Invalid bucketKey for this account' });
        return;
      }

      const body: AdHocMerchantSeriesResponse = {
        account,
        financialYear,
        periodDescription,
        bucketKey,
        category: parsed.category,
        merchant: parsed.merchant,
        points,
      };
      res.json(body);
    } catch (error) {
      console.error('Error generating ad hoc merchant series:', error);
      res.status(500).json({ error: 'Failed to generate ad hoc merchant series' });
    }
  },
);

router.get('/ad-hoc', (req: Request<object, AdHocExpensesResponse, object, AdHocQuery>, res: Response<AdHocExpensesResponse | { error: string }>) => {
  try {
    const accountRaw = req.query.account;
    if (!accountRaw || typeof accountRaw !== 'string' || !isValidAccountName(accountRaw)) {
      res.status(400).json({ error: 'Invalid or missing account' });
      return;
    }
    const account = accountRaw as AccountName;

    const fyRaw = req.query.financialYear;
    const financialYear =
      typeof fyRaw === 'string' && fyRaw.trim() !== '' ? fyRaw.trim() : null;

    if (financialYear !== null) {
      const validYears = getAvailableFinancialYears();
      if (!validYears.includes(financialYear)) {
        res.status(400).json({ error: 'Invalid financial year' });
        return;
      }
    }

    const minTotal = Math.max(
      0,
      parseFloat(String(req.query.min ?? AD_HOC_DEFAULT_MIN_TOTAL)) || AD_HOC_DEFAULT_MIN_TOTAL,
    );
    const limit = clampInt(
      parseInt(String(req.query.limit ?? AD_HOC_DEFAULT_LIMIT), 10) || AD_HOC_DEFAULT_LIMIT,
      1,
      AD_HOC_MAX_LIMIT,
    );

    const pipeline = buildExpensePipelineForAccount(account, financialYear ?? undefined);

    const expenseRows = getTransactions({
      account,
      financialYear: financialYear ?? undefined,
      type: 'expense',
    });
    const expenseTransactions = expenseRows.map(transactionRowToRaw);

    const items = computeAdHocExpenseGroups({
      pipeline,
      account,
      expenseTransactions,
      minTotal,
      limit,
    });

    let periodDescription: string;
    let analysisCutoff: string;
    if (financialYear !== null) {
      const range = getFinancialYearRange(financialYear);
      periodDescription = `${formatUkLong(range.startDate)} – ${formatUkLong(range.endDate)} (${range.label})`;
      analysisCutoff = range.startDate;
    } else {
      periodDescription = 'All time';
      analysisCutoff = oldestIsoDate(expenseTransactions);
    }

    const body: AdHocExpensesResponse = {
      account,
      financialYear,
      periodDescription,
      analysisCutoff,
      pipelineMonths: pipeline.monthsCovered,
      analysisMonths: pipeline.monthsCovered,
      minTotal,
      limit,
      items,
    };
    res.json(body);
  } catch (error) {
    console.error('Error generating ad hoc expenses:', error);
    res.status(500).json({ error: 'Failed to generate ad hoc expenses' });
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

    const pipeline = buildExpensePipelineForAccount(
      selectedAccount as AccountName,
      selectedFY || undefined,
    );

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
