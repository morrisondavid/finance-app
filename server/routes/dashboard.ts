import express, { Request, Response } from 'express';
import type { TransactionJSON, TransactionType, AccountConfig } from '../types.js';
import { ACCOUNTS, ACCOUNT_CONFIG, validateAccount } from '../types.js';
import type {
  DashboardSummaryResponse,
  AccountConfigsResponse,
  TransactionsResponse,
  AccountBalanceResponse,
  CategoriesResponse
} from '../../shared/api-contracts.js';
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
  setOpeningBalance,
  getTaxLiabilities
} from '../db/index.js';
import { categoryColour } from '../utils/categorizer.js';
import { transactionCategoryWithPayroll } from '../config/payroll.js';
import { getCategoryExpenseBreakdown } from '../utils/category-expense-totals.js';
import { getBudgetComparisonsForFy, listBudgets } from '../db/repositories/budgets.js';
import { normalizeFinancialYear } from '../db/utils/financial-year.js';
import { round2 } from '../utils/math.js';
import { buildExpensePipelineForAccount, transactionRowToRaw } from '../utils/expenses-overview-pipeline.js';
import { computeBudgetNudges } from '../utils/budget-nudges.js';

const router = express.Router();


interface SummaryQuery {
  financialYear?: string;
  account?: string;
}

// GET /api/dashboard/summary - Get financial summary for a specific account
router.get('/summary', (req: Request<object, DashboardSummaryResponse, object, SummaryQuery>, res: Response<DashboardSummaryResponse | { error: string }>) => {
  try {
    const { financialYear, account } = req.query;
    
    // Validate account - default to barclays-current if invalid or not specified
    const selectedAccount = validateAccount(account);
    
    // Get available financial years
    const financialYears = getAvailableFinancialYears();
    
    // Default to current (most recent) financial year if not specified
    const selectedFY = financialYear || (financialYears.length > 0 ? financialYears[0] : undefined);
    
    const filters = {
      account: selectedAccount,
      financialYear: selectedFY
    };

    const fyNormalized = selectedFY ? normalizeFinancialYear(selectedFY) : undefined;
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
      });
    }

    const summary = {
      totals: getDashboardTotals(filters),
      monthly: getMonthlySummary(filters),
      byAccount: getAccountSummary({ financialYear: selectedFY }),
      balances: getAllAccountBalances(),
      currentAccountBalance: getAccountBalance(selectedAccount),
      taxLiabilities: getTaxLiabilities(filters),
      transactionCount: getTransactionCount(filters),
      transferCount: getTransferCount(filters),
      fileCount: getFileCount(),
      financialYears,
      selectedFinancialYear: selectedFY || null,
      selectedAccount,
      budgetComparisons,
      yearlyBudgetComparisons,
      budgetNudges,
    };
    
    res.json(summary as DashboardSummaryResponse);
  } catch (error) {
    console.error('Error generating summary:', error);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

interface SetBalanceBody {
  balance: number;
  date?: string;
}

// GET /api/dashboard/balance/:account - Get balance for a specific account
router.get('/balance/:account', (req: Request<{ account: string }, AccountBalanceResponse, object, SummaryQuery>, res: Response<AccountBalanceResponse | { error: string }>) => {
  try {
    const { account } = req.params;
    const { financialYear } = req.query;
    
    const validatedAccount = validateAccount(account);
    const balance = getAccountBalance(validatedAccount, { financialYear });
    res.json(balance as AccountBalanceResponse);
  } catch (error) {
    console.error('Error fetching balance:', error);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// POST /api/dashboard/balance/:account - Set opening balance for an account
router.post('/balance/:account', (req: Request<{ account: string }, AccountBalanceResponse, SetBalanceBody>, res: Response<AccountBalanceResponse | { error: string }>) => {
  try {
    const { account } = req.params;
    const { balance, date } = req.body;
    
    if (typeof balance !== 'number') {
      res.status(400).json({ error: 'Balance must be a number' });
      return;
    }
    
    const validatedAccount = validateAccount(account);
    setOpeningBalance(validatedAccount, balance, date);
    
    // Return the updated balance info
    const updated = getAccountBalance(validatedAccount);
    res.json(updated as AccountBalanceResponse);
  } catch (error) {
    console.error('Error setting balance:', error);
    res.status(500).json({ error: 'Failed to set balance' });
  }
});

// GET /api/dashboard/accounts - Get account configuration
router.get('/accounts', (_req: Request, res: Response<AccountConfigsResponse | { error: string }>) => {
  try {
    // Return account config as an array for easier iteration
    const accounts: AccountConfig[] = ACCOUNTS.map(account => ACCOUNT_CONFIG[account]);
    res.json(accounts);
  } catch (error) {
    console.error('Error fetching account config:', error);
    res.status(500).json({ error: 'Failed to fetch account configuration' });
  }
});

interface CategoriesQuery {
  account?: string;
  financialYear?: string;
}

// GET /api/dashboard/categories - Get spending breakdown by category
router.get('/categories', (req: Request<object, CategoriesResponse, object, CategoriesQuery>, res: Response<CategoriesResponse | { error: string }>) => {
  try {
    const { account, financialYear } = req.query;
    const selectedAccount = validateAccount(account);

    const totals = getCategoryExpenseBreakdown(
      selectedAccount,
      financialYear || undefined,
    );

    const totalExpenses = Array.from(totals.values()).reduce((sum, e) => sum + e.total, 0);

    const categories = Array.from(totals.entries())
      .map(([name, { total, count }]) => ({
        name,
        total: round2(total),
        count,
        percentage: totalExpenses > 0 ? Math.round((total / totalExpenses) * 1000) / 10 : 0,
        colour: categoryColour(name),
      }))
      .sort((a, b) => b.total - a.total);

    res.json({ categories, totalExpenses: round2(totalExpenses) });
  } catch (error) {
    console.error('Error generating category breakdown:', error);
    res.status(500).json({ error: 'Failed to generate category breakdown' });
  }
});

interface TransactionsQuery {
  account?: string;
  year?: string;
  month?: string;
  type?: string;
  category?: string;
  includeTransfers?: string;
  financialYear?: string;
  search?: string;
}

// GET /api/dashboard/transactions - Get transactions for a specific account
router.get('/transactions', (req: Request<object, TransactionsResponse, object, TransactionsQuery>, res: Response<TransactionsResponse | { error: string }>) => {
  try {
    const { account, year, month, type, category, includeTransfers, financialYear, search } = req.query;
    
    const selectedAccount = validateAccount(account);
    
    const filters: {
      account: string;
      year?: string;
      month?: string;
      type?: TransactionType;
      includeTransfers?: boolean;
      financialYear?: string;
      search?: string;
    } = {
      account: selectedAccount
    };
    
    if (year) filters.year = year;
    if (month) filters.month = month;
    if (type === 'income' || type === 'expense' || type === 'transfer') {
      filters.type = type;
    }
    if (includeTransfers === 'true') {
      filters.includeTransfers = true;
    }
    if (financialYear) filters.financialYear = financialYear;
    if (search) filters.search = search;
    
    const transactions = getTransactions(filters);
    
    let result: TransactionJSON[] = transactions.map(t => ({
      date: t.date,
      description: t.description,
      amount: t.amount,
      account: t.account,
      type: t.type,
      category: transactionCategoryWithPayroll(t.description, t.amount, t.account, t.type),
      linkedTransactionId: t.linked_transaction_id ?? undefined
    }));

    if (category) {
      result = result.filter(t => t.category === category);
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

export default router;
