/**
 * Frontend types - includes re-exports from shared API contracts
 */

import type {
  Transaction as TransactionContract,
  TransactionType as TransactionTypeContract,
  AccountType as AccountTypeContract,
  AccountCategory as AccountCategoryContract,
  AccountName as AccountNameContract,
  AccountConfig as AccountConfigContract,
  ExtractedDate as ExtractedDateContract,
  FileInfo as FileInfoContract,
  AccountStatements as AccountStatementsContract,
  AllStatements as AllStatementsContract,
  DashboardTotals as DashboardTotalsContract,
  MonthlySummary as MonthlySummaryContract,
  AccountSummary as AccountSummaryContract,
  AccountBalance as AccountBalanceContract,
  TaxLiabilities as TaxLiabilitiesContract,
  DashboardSummaryResponse,
  TransactionsResponse as TransactionsResponseContract,
  VATPaymentsResponse as VATPaymentsResponseContract,
  StatementsResponse as StatementsResponseContract
} from '../../shared/api-contracts.js';

// Re-export shared contract types for frontend use
export type Transaction = TransactionContract;
export type TransactionType = TransactionTypeContract;
export type AccountType = AccountTypeContract;
export type AccountCategory = AccountCategoryContract;
export type AccountName = AccountNameContract;
export type AccountConfig = AccountConfigContract;
export type ExtractedDate = ExtractedDateContract;
export type FileInfo = FileInfoContract;
export type AccountStatements = AccountStatementsContract;
export type AllStatements = AllStatementsContract;
export type DashboardTotals = DashboardTotalsContract;
export type MonthlySummary = MonthlySummaryContract;
export type AccountSummary = AccountSummaryContract;
export type AccountBalance = AccountBalanceContract;
export type TaxLiabilities = TaxLiabilitiesContract;
export type DashboardSummary = DashboardSummaryResponse;
export type TransactionsResponse = TransactionsResponseContract;
export type VATPaymentsResponse = VATPaymentsResponseContract;
export type StatementsResponse = StatementsResponseContract;

/**
 * Application state interface
 */
export interface AppState {
  summaryData: DashboardSummary | null;
  statementsData: AllStatements | null;
  monthlyChart: import('chart.js').Chart | null;
  selectedFinancialYear: string;
  selectedAccount: AccountName;
  accountConfig: Record<string, AccountConfig>;
  selectedFiles: Set<string>;
}

/**
 * Dashboard filter parameters
 */
export interface DashboardParams {
  financialYear?: string;
  account?: string;
}

/**
 * Statements filter parameters
 */
export interface StatementsFilters {
  search?: string;
  year?: string;
  month?: string;
  quarter?: string;
}

/**
 * Dropzone configuration
 */
export interface DropzoneConfig {
  dropzoneId: string;
  inputId: string;
  statusId: string;
  getUrl: () => string;
}

/**
 * File selection for download
 */
export interface SelectedFileInfo {
  account: string;
  type: 'pdf' | 'csv';
  filename: string;
}
