/**
 * Fixed expenses GET reads (`/api/expenses/*`) — Express + MCP (`fixed_expenses_*`).
 */

import type {
  AdHocExpensesResponse,
  AdHocMerchantSeriesResponse,
  ExpensesSheetResponse,
  RecurringExpensesResponse,
} from '../../../shared/api-contracts.js';
import type { AccountName } from '../../types.js';
import {
  getAvailableFinancialYears,
  getFinancialYearRange,
  getTransactions,
} from '../../db/index.js';
import { getFixedExpenseSimulationExclusions } from '../../db/repositories/fixed-expense-simulation-exclusions.js';
import { isValidAccountName } from '../../domain/accounts/index.js';
import {
  buildAdHocExpensesResponse,
  buildExpensesOverviewSheetResponse,
  buildRecurringExpensesResponse,
} from '../../domain/expenses/read-response-builders.js';
import { buildExpensePipelineForAccount, transactionRowToRaw } from '../../utils/expenses-overview-pipeline.js';
import {
  AD_HOC_DEFAULT_LIMIT,
  AD_HOC_DEFAULT_MIN_TOTAL,
  AD_HOC_MAX_LIMIT,
} from '../../utils/ad-hoc-expenses.js';
import {
  computeAdHocMerchantSeries,
  parseAdHocBucketKey,
} from '../../utils/ad-hoc-merchant-series.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

function formatUkLong(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function readFixedExpensesOverview(): JsonReadResult {
  try {
    const payload: ExpensesSheetResponse = buildExpensesOverviewSheetResponse();
    return jsonReadOk(payload);
  } catch (error) {
    console.error('Error generating expenses sheet overview:', error);
    return jsonReadFail(500, { error: 'Failed to generate expenses sheet overview' });
  }
}

export function readFixedExpensesSimulationExclusions(): JsonReadResult {
  try {
    return jsonReadOk({ lineKeys: getFixedExpenseSimulationExclusions() });
  } catch (error) {
    console.error('Error reading simulation exclusions:', error);
    return jsonReadFail(500, { error: 'Failed to read simulation exclusions' });
  }
}

interface AdHocQuery {
  account?: string;
  financialYear?: string;
  min?: string;
  limit?: string;
}

export function readFixedExpensesAdHocFromQuery(query: AdHocQuery): JsonReadResult {
  try {
    const accountRaw = query.account;
    if (!accountRaw || typeof accountRaw !== 'string') {
      return jsonReadFail(400, { error: 'Invalid or missing account' });
    }

    const fyRaw = query.financialYear;
    const financialYear = typeof fyRaw === 'string' && fyRaw.trim() !== '' ? fyRaw.trim() : null;

    if (financialYear !== null) {
      const validYears = getAvailableFinancialYears();
      if (!validYears.includes(financialYear)) {
        return jsonReadFail(400, { error: 'Invalid financial year' });
      }
    }

    const minTotal = Math.max(
      0,
      parseFloat(String(query.min ?? AD_HOC_DEFAULT_MIN_TOTAL)) || AD_HOC_DEFAULT_MIN_TOTAL,
    );
    const limit = clampInt(
      parseInt(String(query.limit ?? AD_HOC_DEFAULT_LIMIT), 10) || AD_HOC_DEFAULT_LIMIT,
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
      return jsonReadFail(400, { error: built.error });
    }
    const payload: AdHocExpensesResponse = built;
    return jsonReadOk(payload);
  } catch (error) {
    console.error('Error generating ad hoc expenses:', error);
    return jsonReadFail(500, { error: 'Failed to generate ad hoc expenses' });
  }
}

interface AdHocSeriesQuery {
  account?: string;
  financialYear?: string;
  bucketKey?: string;
}

export function readFixedExpensesAdHocSeriesFromQuery(query: AdHocSeriesQuery): JsonReadResult {
  try {
    const accountRaw = query.account;
    if (!accountRaw || typeof accountRaw !== 'string' || !isValidAccountName(accountRaw)) {
      return jsonReadFail(400, { error: 'Invalid or missing account' });
    }
    const account = accountRaw as AccountName;

    const fyRaw = query.financialYear;
    const financialYear = typeof fyRaw === 'string' && fyRaw.trim() !== '' ? fyRaw.trim() : null;

    if (financialYear !== null) {
      const validYears = getAvailableFinancialYears();
      if (!validYears.includes(financialYear)) {
        return jsonReadFail(400, { error: 'Invalid financial year' });
      }
    }

    const bucketKeyRaw = query.bucketKey;
    if (typeof bucketKeyRaw !== 'string' || bucketKeyRaw.trim() === '') {
      return jsonReadFail(400, { error: 'Missing or invalid bucketKey' });
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
      return jsonReadFail(400, { error: 'Invalid bucketKey for this account' });
    }

    let periodDescription: string;
    if (financialYear !== null) {
      const range = getFinancialYearRange(financialYear);
      periodDescription = `${formatUkLong(range.startDate)} – ${formatUkLong(range.endDate)} (${range.label})`;
    } else {
      periodDescription = 'All time';
    }

    const parsedKey = parseAdHocBucketKey(bucketKey, account);
    if (parsedKey === null) {
      return jsonReadFail(400, { error: 'Invalid bucketKey for this account' });
    }

    const payload: AdHocMerchantSeriesResponse = {
      account,
      financialYear,
      periodDescription,
      bucketKey,
      category: parsedKey.category,
      merchant: parsedKey.merchant,
      points,
    };
    return jsonReadOk(payload);
  } catch (error) {
    console.error('Error generating ad hoc merchant series:', error);
    return jsonReadFail(500, { error: 'Failed to generate ad hoc merchant series' });
  }
}

interface RecurringQuery {
  account?: string;
  financialYear?: string;
}

export function readFixedExpensesRecurringFromQuery(query: RecurringQuery): JsonReadResult {
  try {
    const account = typeof query.account === 'string' ? query.account : undefined;
    const financialYear = typeof query.financialYear === 'string' ? query.financialYear : undefined;
    const payload: RecurringExpensesResponse = buildRecurringExpensesResponse({ account, financialYear });
    return jsonReadOk(payload);
  } catch (error) {
    console.error('Error generating recurring expenses:', error);
    return jsonReadFail(500, { error: 'Failed to generate recurring expenses' });
  }
}

export interface FixedExpensesSnapshotQuery extends AdHocQuery, RecurringQuery {}

/** Single-call rollup for MCP — omits heavy ad-hoc series (needs bucketKey). */
export function readFixedExpensesSnapshotFromQuery(query: FixedExpensesSnapshotQuery): JsonReadResult {
  const overview = readFixedExpensesOverview();
  if (!overview.ok) return overview;

  const exclusions = readFixedExpensesSimulationExclusions();
  if (!exclusions.ok) return exclusions;

  const recurring = readFixedExpensesRecurringFromQuery(query);
  if (!recurring.ok) return recurring;

  const adHoc = readFixedExpensesAdHocFromQuery(query);
  if (!adHoc.ok) return adHoc;

  return jsonReadOk({
    overview: overview.body,
    simulationExclusions: exclusions.body,
    recurring: recurring.body,
    adHocSummary: adHoc.body,
  });
}
