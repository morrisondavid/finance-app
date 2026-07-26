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
  getDb,
  migrateCategoryBudgetsIfNeeded,
  migrateCategoryBudgetsBudgetPeriodIfNeeded,
  migrateDebtsMatchAmountsIfNeeded,
  migrateDebtsMatchTolerancePctIfNeeded,
  migrateDebtsMortgageFieldsIfNeeded,
  migrateFixedExpenseSimulationExclusionsIfNeeded,
  migrateTransactionsTypeDateIndexIfNeeded,
  migrateObligationsIfNeeded,
  migrateObligationDismissalsIfNeeded,
  migrateDeadlinesIfNeeded,
} from './connection.js';
import {
  ensureOpeningBalancesCsvExists,
  readOpeningBalancesFromCsv,
  applyOpeningBalancesToDb,
} from './opening-balances-csv.js';
import { applyFixedExpenseExclusionsCsvToDb } from './fixed-expense-simulation-exclusions-csv.js';
import { populateFromCSVs } from './repositories/files.js';
import { shouldSkipFullDatabaseRebuild, recomputeAndPersistDataManifest } from '../data-manifest.js';
import { detectTransfers, resetTransferClassification } from './repositories/transactions.js';
import { loadBudgetsFromFileIntoDb } from './repositories/budgets.js';
import { loadDebtsFromFileIntoDb, reconcileDebtOpeningDates } from './repositories/debts.js';
import { loadManualObligationsFromCsv } from './repositories/obligations.js';
import { loadDismissalsFromCsv } from './repositories/obligation-dismissals.js';
import { deriveAndInsertAutoObligations } from './repositories/vat-auto-seed.js';
import { deriveAndInsertAutoSaObligations } from './repositories/sa-auto-seed.js';
import { deriveAndInsertAutoCtObligations } from './repositories/ct-auto-seed.js';
import { deriveAndInsertAutoTtpObligations } from './repositories/hmrc-ttp-auto-seed.js';
import { deriveAndWriteAutoObligationStates } from './repositories/obligation-state-matcher.js';
import { loadDeadlinesFromCsv } from './repositories/deadlines.js';
import { syncContractRenewalDeadlines } from '../domain/contracts/deadline-seeder.js';
import { maybeCaptureNetWorthSnapshots } from '../domain/net-worth/snapshot.js';
import { loadWarningUserStateFromCsvIntoDb } from './warning-user-state-csv.js';
import { setDurableUploadsSuppressed } from '../storage/durable-fs.js';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';

// Re-export from connection
export { 
  getDb, 
  normalizeDescription, 
  generateTransactionHash,
  DB_PATH,
  STATEMENTS_DIR,
  BUDGETS_DIR,
  OBLIGATIONS_DIR,
  DEADLINES_DIR,
  NET_WORTH_DIR,
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
  resolveFinancialYearForTax,
  sumCorpTaxIncomeForRange,
  type TaxLiabilities,
  type TaxLiabilitiesFilters,
} from './repositories/tax.js';

// Re-export from balance repository
export {
  getOpeningBalance,
  setOpeningBalance,
  getAccountBalance,
  getAllAccountBalances,
  type AccountBalance
} from './repositories/balance.js';

function runSchemaMigrations(): void {
  migrateCategoryBudgetsIfNeeded();
  migrateCategoryBudgetsBudgetPeriodIfNeeded();
  migrateDebtsMatchAmountsIfNeeded();
  migrateDebtsMatchTolerancePctIfNeeded();
  migrateDebtsMortgageFieldsIfNeeded();
  migrateFixedExpenseSimulationExclusionsIfNeeded();
  migrateTransactionsTypeDateIndexIfNeeded();
}

/**
 * Initialize the database connection and populate from CSVs
 */
export async function initDatabase(): Promise<void> {
  console.log('[Database] Initializing...');

  setDurableUploadsSuppressed(true);
  try {
    await initDatabaseInner();
  } finally {
    setDurableUploadsSuppressed(false);
  }
}

/**
 * Re-derive transfer pairing and auto-seeded obligations from the current
 * `transactions` table. Idempotent — safe on every startup when the CSV
 * manifest is unchanged but SQLite already holds the latest rows.
 */
function refreshDerivedLedgerState(): number {
  resetTransferClassification();
  const transferPairs = detectTransfers();

  try {
    deriveAndWriteAutoObligationStates();
  } catch (err) {
    console.error('[Database] Obligation state auto-matcher failed:', err);
  }
  deriveAndInsertAutoObligations();
  try {
    deriveAndInsertAutoSaObligations();
  } catch (err) {
    console.error('[Database] Self Assessment auto-seed failed:', err);
  }
  try {
    deriveAndInsertAutoCtObligations();
  } catch (err) {
    console.error('[Database] Corporation Tax auto-seed failed:', err);
  }
  try {
    deriveAndInsertAutoTtpObligations();
  } catch (err) {
    console.error('[Database] HMRC TTP auto-seed failed:', err);
  }

  return transferPairs;
}

async function initDatabaseInner(): Promise<void> {
  // Validate the declared-obligations registry ownership splits early —
  // misconfigured rental shares would otherwise silently skew SA estimates.
  const {
    assertRentalOwnershipIntegrity,
    assertRentalMerchantsClassify,
  } = await import('../domain/obligations/rental-income.js');
  assertRentalOwnershipIntegrity();
  assertRentalMerchantsClassify();

  // Initialize connection
  initConnection();

  const allowManifestSkip =
    process.env.BANK_STATEMENTS_SKIP_INIT_WHEN_MANIFEST_UNCHANGED !== '0' &&
    process.env.BANK_STATEMENTS_SKIP_INIT_WHEN_MANIFEST_UNCHANGED !== 'false';

  if (allowManifestSkip && shouldSkipFullDatabaseRebuild()) {
    console.log('[Database] Skipping full rebuild (data manifest digest unchanged).');
    ensureOpeningBalancesCsvExists();
    applyOpeningBalancesToDb(getDb(), readOpeningBalancesFromCsv());
    loadWarningUserStateFromCsvIntoDb(getDb());
    runSchemaMigrations();
    migrateObligationsIfNeeded();
    migrateObligationDismissalsIfNeeded();
    migrateDeadlinesIfNeeded();
    const transferPairs = refreshDerivedLedgerState();
    console.log(`[Database] Refreshed derived ledger state (${transferPairs} transfer pair(s) detected)`);
    try {
      const nw = maybeCaptureNetWorthSnapshots();
      if (nw.skipped) {
        console.log(`[Database] Net-worth snapshot skipped (${nw.reason ?? 'unknown'}), period ${nw.periodKey}`);
      } else {
        console.log(`[Database] Net-worth snapshot captured: ${nw.rowsWritten} row(s), period ${nw.periodKey}`);
      }
    } catch (err) {
      console.error('[Database] Net-worth snapshot (§3.1) failed:', err);
    }
    return;
  }

  // Initialize schema (drops and recreates core tables)
  initSchema();

  runSchemaMigrations();

  loadWarningUserStateFromCsvIntoDb(getDb());

  ensureOpeningBalancesCsvExists();
  applyOpeningBalancesToDb(getDb(), readOpeningBalancesFromCsv());
  applyFixedExpenseExclusionsCsvToDb(getDb());

  // Populate from CSV files
  const result = await populateFromCSVs();

  loadBudgetsFromFileIntoDb();
  loadDebtsFromFileIntoDb();
  // Shift each debt's opening-balance date back before its earliest matching
  // transaction (balance-preserving). Ensures historical payments show up in
  // the card stats without inflating currentBalance. Idempotent.
  reconcileDebtOpeningDates();

  migrateObligationsIfNeeded();
  migrateObligationDismissalsIfNeeded();

  // Load dismissals BEFORE any auto-seeder runs so the first-pass seed
  // already respects hidden slots (otherwise the dismissed rows flash
  // into `financial_obligations` until the next mutation triggers a reseed).
  loadDismissalsFromCsv();
  loadManualObligationsFromCsv();
  const transferPairs = refreshDerivedLedgerState();

  migrateDeadlinesIfNeeded();
  loadDeadlinesFromCsv();

  // Contract-renewal deadline seeder — idempotent; see
  // server/domain/contracts/deadline-seeder.ts for the write semantics
  // (completed deadlines are never reopened).
  try {
    const seeded = syncContractRenewalDeadlines();
    if (seeded.length > 0) {
      console.log(`[Database] Seeded ${seeded.length} contract-renewal deadline(s)`);
    }
  } catch (err) {
    console.error('[Database] Contract-renewal deadline seed failed:', err);
  }

  console.log(`[Database] Ready: ${result.files} files, ${result.transactions} transactions (${result.duplicates} duplicates removed, ${transferPairs} transfer pairs detected)`);

  try {
    const nw = maybeCaptureNetWorthSnapshots();
    if (nw.skipped) {
      console.log(`[Database] Net-worth snapshot skipped (${nw.reason ?? 'unknown'}), period ${nw.periodKey}`);
    } else {
      console.log(`[Database] Net-worth snapshot captured: ${nw.rowsWritten} row(s), period ${nw.periodKey}`);
    }
  } catch (err) {
    console.error('[Database] Net-worth snapshot (§3.1) failed:', err);
  }

  recomputeAndPersistDataManifest();
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  closeConnection();
}

// ---------------------------------------------------------------------------
// Background DB rebuild via child process
// ---------------------------------------------------------------------------

let dbInitializing = false;

/** True while a background `initDatabase()` child process is running. */
export function isDbInitializing(): boolean {
  return dbInitializing;
}

/**
 * Run `initDatabase()` in a separate child process so the main Node event
 * loop stays free to serve HTTP requests. Sets {@link isDbInitializing} to
 * `true` for the duration; resolves when the child exits successfully,
 * then reopens the DB connection in the main process.
 *
 * Falls back to inline `initDatabase()` when `BANK_STATEMENTS_DB_INIT_BACKGROUND`
 * is set to `0` or `false` (tests, local dev).
 */
export async function initDatabaseInBackground(): Promise<void> {
  const allowBackground =
    process.env.BANK_STATEMENTS_DB_INIT_BACKGROUND !== '0' &&
    process.env.BANK_STATEMENTS_DB_INIT_BACKGROUND !== 'false';

  if (!allowBackground) {
    await initDatabase();
    return;
  }

  if (dbInitializing) {
    return;
  }

  dbInitializing = true;
  try {
    closeConnection();
    await new Promise<void>((resolve, reject) => {
      const workerPath = fileURLToPath(new URL('init-worker.ts', import.meta.url));
      const child = fork(workerPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, BANK_STATEMENTS_SKIP_INIT_WHEN_MANIFEST_UNCHANGED: '0' },
      });

      let stdoutBuffer = '';

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
      });

      child.on('error', (err: Error) => {
        reject(err);
      });

      child.on('exit', (code: number | null) => {
        if (code === 0) {
          resolve();
        } else {
          let message = `init-worker exited with code ${String(code ?? '?')}`;
          try {
            const parsed = JSON.parse(stdoutBuffer.trim().split('\n').pop() ?? '') as { ok: boolean; error?: string };
            if (parsed.ok === false && parsed.error !== undefined) {
              message = parsed.error;
            }
          } catch {
            // ignore parse errors — use generic message
          }
          reject(new Error(message));
        }
      });
    });

    initConnection();
  } finally {
    dbInitializing = false;
  }
}
