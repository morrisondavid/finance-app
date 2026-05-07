import express, { Request, Response } from 'express';
import {
  SimulationExclusionsPutBodySchema,
  type AdHocExpensesResponse,
  type AdHocMerchantSeriesResponse,
  type ExpensesSheetResponse,
  type RecurringExpensesResponse,
} from '../../shared/api-contracts.js';
import type { AccountName } from '../types.js';
import {
  getTransactions,
  getAvailableFinancialYears,
  getFinancialYearRange,
} from '../db/index.js';
import {
  getFixedExpenseSimulationExclusions,
  replaceFixedExpenseSimulationExclusions,
} from '../db/repositories/fixed-expense-simulation-exclusions.js';
import { isValidAccountName } from '../domain/accounts/index.js';
import {
  buildAdHocExpensesResponse,
  buildExpensesOverviewSheetResponse,
  buildRecurringExpensesResponse,
} from '../domain/expenses/read-response-builders.js';
import { accKey } from '../utils/recurring-pipeline.js';
import { buildExpensePipelineForAccount, transactionRowToRaw } from '../utils/expenses-overview-pipeline.js';
import {
  AD_HOC_DEFAULT_LIMIT,
  AD_HOC_DEFAULT_MIN_TOTAL,
  AD_HOC_MAX_LIMIT,
} from '../utils/ad-hoc-expenses.js';
import {
  computeAdHocMerchantSeries,
  parseAdHocBucketKey,
} from '../utils/ad-hoc-merchant-series.js';

export { accKey };

function formatUkLong(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const router = express.Router();

interface OverviewQuery {
  financialYear?: string;
}

// ─── /overview ────────────────────────────────────────────────────────────────

router.get('/overview', (_req: Request<object, ExpensesSheetResponse, object, OverviewQuery>, res: Response<ExpensesSheetResponse | { error: string }>) => {
  try {
    res.json(buildExpensesOverviewSheetResponse());
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
    if (!accountRaw || typeof accountRaw !== 'string') {
      res.status(400).json({ error: 'Invalid or missing account' });
      return;
    }

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

    const built = buildAdHocExpensesResponse({
      account: accountRaw,
      financialYear,
      minTotal,
      limit,
    });
    if ('error' in built) {
      res.status(400).json({ error: built.error });
      return;
    }
    res.json(built);
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
    const account = typeof req.query.account === 'string' ? req.query.account : undefined;
    const financialYear = typeof req.query.financialYear === 'string' ? req.query.financialYear : undefined;
    res.json(buildRecurringExpensesResponse({ account, financialYear }));
  } catch (error) {
    console.error('Error generating recurring expenses:', error);
    res.status(500).json({ error: 'Failed to generate recurring expenses' });
  }
});

export default router;
