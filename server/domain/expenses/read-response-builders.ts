/**
 * Shared expense read-model builders for HTTP routes and AI composers.
 */

import type {
  AdHocExpensesResponse,
  ExpensesSheetResponse,
  RecurringExpensesResponse,
} from '../../../shared/api-contracts.js';
import { buildExpensesSheetResponse, applySimulationExclusions } from '../../../shared/expenses-sheet-build.js';
import {
  getTransactions,
  getAvailableFinancialYears,
  getFinancialYearRange,
} from '../../db/index.js';
import { buildExpensesSheetInputFromPipeline } from '../../utils/expenses-pipeline-to-sheet.js';
import {
  runExpensesOverviewPipeline,
  buildExpensePipelineForAccount,
  transactionRowToRaw,
} from '../../utils/expenses-overview-pipeline.js';
import { getFixedExpenseSimulationExclusions } from '../../db/repositories/fixed-expense-simulation-exclusions.js';
import type { AccountName } from '../../types.js';
import { ACCOUNTS } from '../../types.js';
import { isValidAccountName } from '../accounts/index.js';
import type { RawTransaction } from '../../utils/recurring-pipeline.js';
import {
  AD_HOC_DEFAULT_LIMIT,
  AD_HOC_DEFAULT_MIN_TOTAL,
  AD_HOC_MAX_LIMIT,
  computeAdHocExpenseGroups,
} from '../../utils/ad-hoc-expenses.js';

function oldestIsoDate(rows: RawTransaction[]): string {
  if (rows.length === 0) return '';
  return rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date);
}

function formatUkLong(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function buildExpensesOverviewSheetResponse(): ExpensesSheetResponse {
  const pipeline = runExpensesOverviewPipeline({ includeSimulationExcluded: true });
  const sheetInput = buildExpensesSheetInputFromPipeline(pipeline);
  const baseline = buildExpensesSheetResponse(sheetInput);
  const persisted = new Set(getFixedExpenseSimulationExclusions());
  return applySimulationExclusions(baseline, persisted);
}

export function buildRecurringExpensesResponse(opts?: {
  account?: string;
  financialYear?: string;
}): RecurringExpensesResponse {
  const selectedAccount = (opts?.account || ACCOUNTS[0]) as AccountName;
  const allYears = getAvailableFinancialYears();
  const selectedFY = opts?.financialYear || allYears[0] || '';

  const pipeline = buildExpensePipelineForAccount(
    selectedAccount,
    selectedFY || undefined,
  );

  return {
    monthly: pipeline.monthlyExpenseRecurring,
    annual: pipeline.annualExpenseRecurring,
    account: selectedAccount,
    financialYear: selectedFY,
    monthsCovered: pipeline.monthsCovered,
  };
}

export interface BuildAdHocExpensesResponseOpts {
  account: string;
  financialYear?: string | null;
  minTotal?: number;
  limit?: number;
}

export function buildAdHocExpensesResponse(
  opts: BuildAdHocExpensesResponseOpts,
): AdHocExpensesResponse | { error: string } {
  const { account: accountRaw, financialYear: fyOpt, minTotal: minOpt, limit: limitOpt } = opts;
  if (!isValidAccountName(accountRaw)) {
    return { error: 'Invalid or missing account' };
  }
  const account = accountRaw as AccountName;

  const financialYear =
    typeof fyOpt === 'string' && fyOpt.trim() !== '' ? fyOpt.trim() : null;

  if (financialYear !== null) {
    const validYears = getAvailableFinancialYears();
    if (!validYears.includes(financialYear)) {
      return { error: 'Invalid financial year' };
    }
  }

  const minTotal = Math.max(0, minOpt ?? AD_HOC_DEFAULT_MIN_TOTAL);
  const limit = clampInt(limitOpt ?? AD_HOC_DEFAULT_LIMIT, 1, AD_HOC_MAX_LIMIT);

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

  return {
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
}
