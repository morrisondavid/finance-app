// ─── Wire types: re-exported from the single source of truth ─────────────────
// All JSON-serializable types that cross the HTTP boundary are defined as
// Zod schemas in shared/api-contracts.ts.  TypeScript types are derived via
// z.infer<> there.  We re-export them here for convenience so that server code
// can keep importing from '../types.js' without churn.
//
// Account-related runtime logic (ACCOUNT_CONFIG, getAccountConfig,
// isCreditCard, isBusinessAccount, isCrossAccountBusinessToBusinessTransfer,
// VAT/CT filter helpers, etc.) now lives in `server/domain/accounts/` — the
// canonical config registry. This file has shrunk to just type re-exports +
// server-internal shapes (Transaction, BankParser, FileInfo, etc.).

import type {
  AccountName,
  CurrencyCode,
  EntityId,
  Jurisdiction,
} from '../shared/api-contracts.js';
import { ACCOUNTS } from '../shared/api-contracts.js';
import type { InternalFeedTransactions } from './ingestion/feeds/model.js';

export type {
  MonthlySummary,
  AccountSummary,
  DashboardTotals,
  AccountBalance,
  TaxLiabilities,
  DashboardSummaryResponse as DashboardSummary,
  UploadedFile,
  TransactionsResponse,
} from '../shared/api-contracts.js';

export type { AccountName, CurrencyCode, EntityId, Jurisdiction };
export { ACCOUNTS };

// ─── Internal types (never serialised over HTTP) ─────────────────────────────

export type TransactionType = 'income' | 'expense' | 'transfer';

/** Server-side transaction with native Date (not JSON-safe). */
export interface Transaction {
  date: Date;
  description: string;
  amount: number;
  account: string;
  type: TransactionType;
  occurrence?: number;
  /** Provider-native id (e.g. Monzo `Transaction ID`) for dedup when present. */
  externalId?: string;
}

/** JSON-safe transaction (date as string). */
export interface TransactionJSON {
  date: string;
  description: string;
  amount: number;
  account: string;
  type: TransactionType;
  category?: string;
  occurrence?: number;
  linkedTransactionId?: number;
}

export interface ExtractedDate {
  year: string;
  month: string;
}

export interface FileInfo {
  filename: string;
  size: number;
  modified: string;
  extractedDate: ExtractedDate | null;
  displayDate: string;
}

export interface FileInfoWithType extends FileInfo {
  type: 'pdf' | 'csv';
}

export interface AccountStatements {
  pdf: FileInfo[];
  csv: FileInfo[];
}

export interface AllStatements {
  [account: string]: AccountStatements;
}

export interface CSVRow {
  [key: string]: string;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Result of transcoding a non-CSV upload into a CSV the rest of the pipeline
 * can consume. `filenameHint` is used as the on-disk name for the converted
 * file so the generic filename normaliser can still pick up the statement
 * period (useful for banks whose raw download filenames only carry the
 * request date, not the statement date).
 */
export interface TranscodedUpload {
  csv: string;
  filenameHint: string;
}

export interface BankParser {
  columns: 'auto' | string[];
  dateColumn: string;
  amountColumn: string;
  descriptionColumn: string;
  /** When set, non-empty values in this CSV column dedupe by id (e.g. Monzo `Transaction ID`). */
  externalIdColumn?: string;
  headers: readonly string[];
  requiredHeaders: readonly string[];
  parseOptions?: Record<string, unknown>;
  preprocess(content: string): string;
  parseDate(dateStr: string): Date | null;
  extractFilenameDate(filename: string): string | null;
  validateHeaders(headers: string[]): ValidationResult;
  transform(row: CSVRow, account: string): Transaction | null;

  /**
   * Extra file extensions this parser can ingest beyond `.csv` (e.g. `['.xls']`
   * for banks that export HTML tables disguised as Excel). When set, the
   * upload route will accept matching files and delegate transcoding to
   * `transcodeUpload` before the rest of the CSV pipeline runs.
   */
  acceptedUploadExtensions?: readonly string[];

  /**
   * Convert raw uploaded bytes (in an extension listed in
   * `acceptedUploadExtensions`) into CSV text. Bank-specific knowledge about
   * byte encoding, sheet layout, and statement-period naming lives here so
   * `server/routes/upload.ts` stays account-agnostic.
   */
  transcodeUpload?: (raw: Buffer, originalFilename: string) => TranscodedUpload;

  /**
   * Convert provider-neutral {@link InternalFeedTransactions} into CSV text
   * shaped exactly like this bank's native export — same `headers`, same
   * sign convention as `transform` expects.
   *
   * The emitted CSV is the **only** path automated feeds use to add data:
   * `runFeedSync` writes it to a temp file and calls the same `ingestCsvFile`
   * the manual upload route uses, so feed and upload share validation,
   * `_originals/` save, normalisation, partitioning, and DB rebuild.
   *
   * Optional because some accounts may never receive automated feeds;
   * `runFeedSync` fails fast with a typed error if invoked for an account
   * whose parser has not implemented this method.
   */
  emitFeedTransactionsAsCsv?: (tx: InternalFeedTransactions) => string;
}

export interface ParserMap {
  [account: string]: BankParser;
}

export interface NormalizeResult {
  original: string;
  normalized: string;
  renamed: boolean;
  newPath?: string;
}

export interface InvoiceUploadIngestResult {
  filename: string;
  outcome: 'ingested' | 'archived-only' | 'failed';
  code?: string;
  invoiceId?: string;
  message?: string;
}

export interface UploadResponse {
  message: string;
  files: import('../shared/api-contracts.js').UploadedFile[];
  account?: string;
  type?: string;
  /** Present on `POST /api/upload/invoices` when self-bill ingestion was attempted per file. */
  invoiceIngestResults?: InvoiceUploadIngestResult[];
}

// ─── Legacy block removed ────────────────────────────────────────────────────
// AccountType, AccountCategory, VatConfig, CorpTaxConfig, BusinessTaxConfig,
// BusinessAccountConfig, PersonalAccountConfig, AccountConfig, ACCOUNT_CONFIG,
// getAccountConfig, isValidAccountName, validateAccount,
// getBusinessPaymentAccounts, getAccountsByEntity, getEntityIdForAccount,
// getPersonalPaymentAccounts, getBusinessAndPersonalPaymentAccounts,
// isCreditCard, isBusinessAccount, and isCrossAccountBusinessToBusinessTransfer
// have all moved to `server/domain/accounts/` (the canonical config registry).
//
// Import those names from `server/domain/accounts/index.js` going forward —
// type-only imports of AccountType/AccountCategory/AccountOwnership should use
// `shared/api-contracts.js`, which has been the single source of truth for
// those enums since Phase 4.

