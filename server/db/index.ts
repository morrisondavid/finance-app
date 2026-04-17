/**
 * Database module - main entry point
 * 
 * This module re-exports all database functions from the repository files
 * for backward compatibility. The implementation is split into:
 * 
 * - connection.ts: DB connection, schema, utility functions
 * - utils/financial-year.ts: Financial year calculations
 * - repositories/transactions.ts: Transaction CRUD, transfer detection
 * - repositories/files.ts: File processing
 * - repositories/dashboard.ts: Dashboard summaries
 * - repositories/tax.ts: Tax calculations
 * - repositories/balance.ts: Account balance management
 */

import {
  initConnection,
  closeConnection,
  initSchema,
  migrateCategoryBudgetsIfNeeded,
  migrateCategoryBudgetsBudgetPeriodIfNeeded,
  migrateFixedExpenseSimulationExclusionsIfNeeded,
  migrateObligationsIfNeeded,
} from './connection.js';
import { populateFromCSVs } from './repositories/files.js';
import { detectTransfers } from './repositories/transactions.js';
import { loadBudgetsFromFileIntoDb } from './repositories/budgets.js';
import { loadManualObligationsFromCsv } from './repositories/obligations.js';
import { deriveAndInsertAutoObligations } from './repositories/vat-auto-seed.js';

// Re-export from connection
export { 
  getDb, 
  normalizeDescription, 
  generateTransactionHash,
  DB_PATH,
  STATEMENTS_DIR,
  BUDGETS_DIR,
  OBLIGATIONS_DIR
} from './connection.js';

export { formatDateISO } from '../../shared/date-format.js';

// Re-export from financial year utils
export {
  getFinancialYearRange,
  buildFYWhereClause,
  buildDashboardFilters,
  getAvailableFinancialYears,
  type FinancialYearRange,
  type DashboardFilters
} from './utils/financial-year.js';

// Re-export from transactions repository
export {
  insertTransaction,
  insertTransactions,
  detectTransfers,
  isTransferLikeDescription,
  isBouncedPayment,
  getTransactions,
  getExpensesForAccountSinceAsc,
  getTransactionCount,
  getTransferCount,
  type TransactionRow,
  type TransactionFilters
} from './repositories/transactions.js';

// Re-export from files repository
export {
  recordProcessedFile,
  getAllCSVFiles,
  populateFromCSVs,
  getFileCount,
  addTransactionsFromFile
} from './repositories/files.js';

// Re-export from dashboard repository
export {
  getDashboardTotals,
  getMonthlySummary,
  getAccountSummary
} from './repositories/dashboard.js';

// Re-export from tax repository
export {
  getTaxLiabilities,
  type TaxLiabilities
} from './repositories/tax.js';

// Re-export from balance repository
export {
  getOpeningBalance,
  setOpeningBalance,
  getAccountBalance,
  getAllAccountBalances,
  type AccountBalance
} from './repositories/balance.js';

/**
 * Initialize the database connection and populate from CSVs
 */
export async function initDatabase(): Promise<void> {
  console.log('[Database] Initializing...');
  
  // Initialize connection
  initConnection();
  
  // Initialize schema (drops and recreates tables)
  initSchema();

  migrateCategoryBudgetsIfNeeded();
  migrateCategoryBudgetsBudgetPeriodIfNeeded();
  migrateFixedExpenseSimulationExclusionsIfNeeded();

  // Populate from CSV files
  const result = await populateFromCSVs();
  
  // Detect and mark transfers
  const transferPairs = detectTransfers();

  loadBudgetsFromFileIntoDb();

  migrateObligationsIfNeeded();
  loadManualObligationsFromCsv();
  deriveAndInsertAutoObligations();
  
  console.log(`[Database] Ready: ${result.files} files, ${result.transactions} transactions (${result.duplicates} duplicates removed, ${transferPairs} transfer pairs detected)`);
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  closeConnection();
}
