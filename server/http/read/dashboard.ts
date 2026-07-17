import type { TransactionJSON } from '../../types.js';
import { ACCOUNTS } from '../../types.js';
import {
  validateAccount,
  getAccountConfig,
  accountBalanceForApi,
  allAccountBalancesForApi,
} from '../../domain/accounts/index.js';
import type { AccountConfig } from '../../domain/accounts/index.js';
import { buildLiquidityOverview } from '../../domain/accounts/liquidity-overview.js';
import { buildLiquidityCommitments } from '../../domain/accounts/liquidity-commitments.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import {
  DashboardSummaryResponseSchema,
  DashboardAccountsSummaryResponseSchema,
  DashboardSummaryHttpQuerySchema,
  DashboardTransactionsQuerySchema,
  FeedToolbarStateSchema,
} from '../../../shared/api-contracts.js';
import {
  getDashboardTotals,
  getMonthlySummary,
  getAccountSummary,
  getTransactionCount,
  getTransferCount,
  getFileCount,
  getTransactions,
  getAvailableFinancialYears,
  getAllAccountBalances,
  getAccountBalance,
  getTaxLiabilities,
  resolveFinancialYearForTax,
} from '../../db/index.js';
import { categoryColour } from '../../utils/categorizer.js';
import { transactionCategoryWithPayroll } from '../../domain/payroll/index.js';
import { getCategoryExpenseBreakdown } from '../../utils/category-expense-totals.js';
import { getBudgetComparisonsForFy, listBudgets } from '../../db/repositories/budgets.js';
import { listDebts } from '../../db/repositories/debts.js';
import { normalizeFinancialYear } from '../../db/utils/financial-year.js';
import { round2 } from '../../utils/math.js';
import { buildExpensePipelineForAccount, transactionRowToRaw } from '../../utils/expenses-overview-pipeline.js';
import { computeBudgetNudges } from '../../utils/budget-nudges.js';
import { feedToolbarStateForAccount } from '../../ingestion/feeds/feed-toolbar-state.js';
import { feedLinkIndicatorsForAllAccounts } from '../../ingestion/feeds/feed-link-indicator.js';
import { composeAiAvailableFunds } from '../../domain/ai/compose-available-funds.js';
import { flattenExpressQuery } from '../../utils/flatten-express-query.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';
import { withReadResponseCache } from '../read-response-cache.js';

interface SummaryQuery {
  financialYear?: string | undefined;
  account?: string | undefined;
  asOfDate?: string | undefined;
}

/** GET /api/dashboard/summary */
export function readDashboardSummaryFromQuery(
  query: Record<string, string | undefined>,
): JsonReadResult {
  return withReadResponseCache('dashboard_get_summary', query, () =>
    readDashboardSummaryFromQueryUncached(query),
  );
}

function readDashboardSummaryFromQueryUncached(
  query: Record<string, string | undefined>,
): JsonReadResult {
  try {
    const parsedQuery = DashboardSummaryHttpQuerySchema.safeParse(query);
    if (!parsedQuery.success) {
      return jsonReadFail(400, { error: 'invalid-params', issues: parsedQuery.error.issues });
    }

    const { financialYear, account, scope = 'full' } = parsedQuery.data;
    const selectedAccount = validateAccount(account);
    const financialYears = getAvailableFinancialYears();
    const selectedFY = financialYear || (financialYears.length > 0 ? financialYears[0] : undefined);

    const filters = {
      account: selectedAccount,
      financialYear: resolveFinancialYearForTax(selectedFY),
    };

    const fyNormalized = selectedFY !== undefined ? normalizeFinancialYear(selectedFY) : undefined;
    const budgetBlock =
      fyNormalized !== undefined
        ? getBudgetComparisonsForFy(selectedAccount, fyNormalized)
        : { monthly: [], yearly: [] };
    const budgetComparisons = budgetBlock.monthly;
    const yearlyBudgetComparisons = budgetBlock.yearly;

    let budgetNudges: ReturnType<typeof computeBudgetNudges> = [];
    if (fyNormalized !== undefined) {
      const pipeline = buildExpensePipelineForAccount(selectedAccount, fyNormalized);
      const expenseTxns = getTransactions({
        account: selectedAccount,
        financialYear: selectedFY,
        type: 'expense',
      });
      const expenseTransactions = expenseTxns.map(transactionRowToRaw);
      const budgetRows = listBudgets({ account: selectedAccount });
      const budgetedCategories = new Set(budgetRows.map(b => b.category));
      budgetNudges = computeBudgetNudges({
        expenseTransactions,
        pipeline,
        budgetedCategories,
        activeDebts: listDebts({ includeArchived: false }),
      });
    }

    const accountBalanceRow = getAccountBalance(selectedAccount);

    const sharedCore = {
      totals: getDashboardTotals(filters),
      monthly: getMonthlySummary(filters),
      byAccount: getAccountSummary({ financialYear: selectedFY }),
      feedLinkByAccount: feedLinkIndicatorsForAllAccounts(),
      currentAccountBalance: accountBalanceForApi(
        selectedAccount,
        accountBalanceRow,
      ),
      taxLiabilities: getTaxLiabilities(filters),
      transferCount: getTransferCount(filters),
      financialYears,
      selectedFinancialYear: selectedFY ?? null,
      selectedAccount,
      budgetComparisons,
      yearlyBudgetComparisons,
      budgetNudges,
    };

    if (scope === 'accounts') {
      return jsonReadOk(DashboardAccountsSummaryResponseSchema.parse(sharedCore));
    }

    const allBalances = getAllAccountBalances();
    const liquidityOverview = buildLiquidityOverview(allBalances);
    const liquidityCommitments = buildLiquidityCommitments({
      todayIso: todayIsoLocal(),
      totalCashGbp: liquidityOverview.totalCashGbp,
    });

    const summaryUnchecked = {
      ...sharedCore,
      balances: allAccountBalancesForApi(allBalances),
      liquidityOverview,
      liquidityCommitments,
      transactionCount: getTransactionCount(filters),
      fileCount: getFileCount(),
      availableFunds: composeAiAvailableFunds(),
    };

    return jsonReadOk(DashboardSummaryResponseSchema.parse(summaryUnchecked));
  } catch {
    console.error('Error generating dashboard summary');
    return jsonReadFail(500, { error: 'Failed to generate summary' });
  }
}

/** GET /api/dashboard/balance/:account */
export function readDashboardBalance(
  accountParam: string | undefined,
  query: Pick<SummaryQuery, 'financialYear' | 'asOfDate'>,
): JsonReadResult {
  try {
    if (accountParam === undefined || accountParam === '') {
      return jsonReadFail(400, { error: 'Missing account' });
    }
    const validatedAccount = validateAccount(accountParam);
    const { financialYear, asOfDate } = query;
    const balance = getAccountBalance(validatedAccount, {
      financialYear,
      ...(asOfDate !== undefined && asOfDate !== '' ? { asOfDate } : {}),
    });
    return jsonReadOk(accountBalanceForApi(validatedAccount, balance));
  } catch {
    console.error('Error fetching balance');
    return jsonReadFail(500, { error: 'Failed to fetch balance' });
  }
}



export function readDashboardAccounts(): JsonReadResult {
  try {
    const accounts: AccountConfig[] = ACCOUNTS.map(account => getAccountConfig(account));
    return jsonReadOk(accounts);
  } catch {
    console.error('Error fetching account config');
    return jsonReadFail(500, { error: 'Failed to fetch account configuration' });
  }
}

/** GET /api/dashboard/feed-toolbar-state */
export function readDashboardFeedToolbarStateFromQuery(query: Pick<SummaryQuery, 'account'>): JsonReadResult {
  try {
    const selectedAccount = validateAccount(query.account);
    const payload = feedToolbarStateForAccount(selectedAccount);
    return jsonReadOk(FeedToolbarStateSchema.parse(payload));
  } catch {
    console.error('Error resolving feed-toolbar-state');
    return jsonReadFail(500, { error: 'Failed to resolve feed toolbar state' });
  }
}

interface CategoriesHttpQuery {
  account?: string | undefined;
  financialYear?: string | undefined;
}

/** GET /api/dashboard/categories */
export function readDashboardCategoriesFromQuery(q: CategoriesHttpQuery): JsonReadResult {
  try {
    const { account, financialYear } = q;
    const selectedAccount = validateAccount(account);

    const totals = getCategoryExpenseBreakdown(selectedAccount, financialYear ?? undefined);

    const totalExpenses = Array.from(totals.values()).reduce((sum, e) => sum + e.total, 0);

    const categoriesUnchecked = {
      categories: Array.from(totals.entries())
        .map(([name, { total, count }]) => ({
          name,
          total: round2(total),
          count,
          percentage: totalExpenses > 0 ? Math.round((total / totalExpenses) * 1000) / 10 : 0,
          colour: categoryColour(name),
        }))
        .sort((a, b) => b.total - a.total),
      totalExpenses: round2(totalExpenses),
    };

    return jsonReadOk(categoriesUnchecked);
  } catch {
    console.error('Error generating category breakdown');
    return jsonReadFail(500, { error: 'Failed to generate category breakdown' });
  }
}

/** GET /api/dashboard/transactions */
export function readDashboardTransactionsFromQuery(queryUnknown: Record<string, unknown>): JsonReadResult {
  try {
    const parsed = DashboardTransactionsQuerySchema.safeParse(flattenExpressQuery(queryUnknown));
    if (!parsed.success) {
      return jsonReadFail(400, { error: 'invalid-params', issues: parsed.error.issues });
    }
    const q = parsed.data;
    const selectedAccount = validateAccount(q.account);

    const filters = {
      account: selectedAccount,
      ...(q.year !== undefined ? { year: q.year } : {}),
      ...(q.month !== undefined ? { month: q.month } : {}),
      ...(q.type !== undefined ? { type: q.type } : {}),
      ...(q.includeTransfers !== undefined ? { includeTransfers: q.includeTransfers } : {}),
      ...(q.financialYear !== undefined ? { financialYear: q.financialYear } : {}),
      ...(q.search !== undefined ? { search: q.search } : {}),
      ...(q.merchantModalLabel !== undefined ? { merchantModalLabel: q.merchantModalLabel } : {}),
    };

    const transactions = getTransactions(filters);

    let result: TransactionJSON[] = transactions.map(t => ({
      date: t.date,
      description: t.description,
      amount: t.amount,
      account: t.account,
      type: t.type,
      category: transactionCategoryWithPayroll(t.description, t.amount, t.account, t.type, t.hash),
      linkedTransactionId: t.linked_transaction_id ?? undefined,
    }));

    if (q.category) {
      result = result.filter(t => t.category === q.category);
    }

    return jsonReadOk(result);
  } catch {
    console.error('Error fetching dashboard transactions');
    return jsonReadFail(500, { error: 'Failed to fetch transactions' });
  }
}
