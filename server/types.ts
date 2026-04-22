// ─── Wire types: re-exported from the single source of truth ─────────────────
// All JSON-serializable types that cross the HTTP boundary are defined as
// Zod schemas in shared/api-contracts.ts.  TypeScript types are derived via
// z.infer<> there.  We re-export them here for convenience so that server code
// can keep importing from '../types.js' without churn.

import type {
  AccountName,
  CurrencyCode,
  EntityId,
  Jurisdiction,
  Tbc,
} from '../shared/api-contracts.js';
import { ACCOUNTS } from '../shared/api-contracts.js';

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

export interface UploadResponse {
  message: string;
  files: import('../shared/api-contracts.js').UploadedFile[];
  account?: string;
  type?: string;
}

/**
 * Account type classification
 */
export type AccountType = 'current' | 'savings' | 'credit-card';

/**
 * Account category classification
 * - business: Company accounts used for business finances
 * - personal: Personal accounts for individual finances
 */
export type AccountCategory = 'business' | 'personal';

/** @deprecated Use AccountCategory instead */
export type AccountOwnership = AccountCategory;

/**
 * Per-tax-type configuration for business accounts, scoped by jurisdiction
 * (Roadmap 1.1 / Phase 4). Each business account declares:
 *
 *   - `jurisdiction`: which country's rules govern its income.
 *   - `vat.applicable`: whether the account's income is inside its
 *     jurisdiction's VAT net conceptually (false for UK credit cards /
 *     savings which hold no revenue).
 *   - `vat.rate`: the jurisdiction's standard rate (0.20 UK, 0.05 UAE).
 *   - `vat.registered`: whether the *entity* is currently VAT-registered
 *     in its jurisdiction. Obligation seeders require this to be `true`
 *     before emitting rows.
 *   - `corpTax.applicable`: whether the jurisdiction imposes a CT-style
 *     business income tax on this account's income.
 *   - `corpTax.qualifyingFreeZone`: UAE-only gate. `true` = QFZP (0%),
 *     `false` = non-QFZP (9% above threshold). For UK this is always
 *     `false` (UK has no free-zone regime). `'TBC'` means the UAE entity
 *     has not yet answered whether it qualifies — obligation seeders
 *     refuse to emit rows while this is `'TBC'`.
 *
 * This shape replaces the pre-Phase-4 flat booleans (`vatApplicable`,
 * `corpTaxApplicable`) so AED income can never silently leak into a UK
 * VAT or CT aggregate.
 */
export interface VatConfig {
  applicable: boolean;
  rate: number;
  registered: boolean;
}

export interface CorpTaxConfig {
  applicable: boolean;
  qualifyingFreeZone: boolean | Tbc;
}

export interface BusinessTaxConfig {
  jurisdiction: Jurisdiction;
  vat: VatConfig;
  corpTax: CorpTaxConfig;
}

interface BaseAccountConfig {
  name: AccountName;
  label: string;
  type: AccountType;
  currency: CurrencyCode;
  /**
   * Legal entity this account belongs to. `null` means the account is
   * personal and falls outside either corporate registry (Roadmap 1.1).
   * Business accounts MUST have a non-null entityId; personal accounts
   * MUST have `null`. Enforced by the runtime tests in types.test.ts.
   */
  entityId: EntityId | null;
  canMakeOutgoingPayments: boolean;
  excludeTransfersFromIncome: boolean;
  showTaxLiabilities: boolean;
  quarterOverlapMonths?: number;
}

export interface BusinessAccountConfig extends BaseAccountConfig {
  category: 'business';
  business: BusinessTaxConfig;
}

export interface PersonalAccountConfig extends BaseAccountConfig {
  category: 'personal';
}

export type AccountConfig = BusinessAccountConfig | PersonalAccountConfig;

/**
 * Configuration for all accounts
 */
export const ACCOUNT_CONFIG: Record<AccountName, AccountConfig> = {
  'barclays-current': {
    name: 'barclays-current',
    label: 'Barclays Current',
    type: 'current',
    currency: 'GBP',
    entityId: 'autonize-it-ltd',
    category: 'business',
    business: {
      jurisdiction: 'UK',
      vat: { applicable: true, rate: 0.2, registered: true },
      corpTax: { applicable: true, qualifyingFreeZone: false },
    },
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: true,
    showTaxLiabilities: true,
  },
  'barclays-savings': {
    name: 'barclays-savings',
    label: 'Barclays Savings',
    type: 'savings',
    currency: 'GBP',
    entityId: 'autonize-it-ltd',
    category: 'business',
    business: {
      jurisdiction: 'UK',
      vat: { applicable: false, rate: 0.2, registered: true },
      corpTax: { applicable: false, qualifyingFreeZone: false },
    },
    canMakeOutgoingPayments: false,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
  },
  'capital-on-tap': {
    name: 'capital-on-tap',
    label: 'Capital on Tap',
    type: 'credit-card',
    currency: 'GBP',
    entityId: 'autonize-it-ltd',
    category: 'business',
    business: {
      jurisdiction: 'UK',
      vat: { applicable: false, rate: 0.2, registered: true },
      corpTax: { applicable: false, qualifyingFreeZone: false },
    },
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
    quarterOverlapMonths: 1,
  },
  'barclaycard': {
    name: 'barclaycard',
    label: 'Barclaycard',
    type: 'credit-card',
    currency: 'GBP',
    entityId: 'autonize-it-ltd',
    category: 'business',
    business: {
      jurisdiction: 'UK',
      vat: { applicable: false, rate: 0.2, registered: true },
      corpTax: { applicable: false, qualifyingFreeZone: false },
    },
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
  },
  'natwest': {
    name: 'natwest',
    label: 'NatWest',
    type: 'current',
    currency: 'GBP',
    entityId: null,
    category: 'personal',
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
  },
  'natwest-savings': {
    name: 'natwest-savings',
    label: 'NatWest Savings',
    type: 'savings',
    currency: 'GBP',
    entityId: null,
    category: 'personal',
    canMakeOutgoingPayments: false,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
  },
  'monzo-joint': {
    name: 'monzo-joint',
    label: 'Monzo Joint',
    type: 'current',
    currency: 'GBP',
    entityId: null,
    category: 'personal',
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
  },
  'emirates-islamic': {
    name: 'emirates-islamic',
    label: 'Emirates Islamic',
    type: 'current',
    currency: 'AED',
    entityId: 'autonize-it-fzco',
    category: 'business',
    business: {
      jurisdiction: 'UAE',
      /**
       * UAE VAT is 5% and registration-gated. The FZCO is not yet VAT-
       * registered (per the La Fosse self-bill agreement); applicable
       * stays `true` so the Warnings Engine can surface threshold
       * breaches, but `registered: false` keeps VAT obligation seeders
       * silent until the status flips.
       */
      vat: { applicable: true, rate: 0.05, registered: false },
      /**
       * UAE CT applies in principle; `qualifyingFreeZone: 'TBC'` means
       * the FZCO has not yet formally elected QFZP status with its
       * accountant. CT obligation seeders treat `'TBC'` as a hard gate
       * and refuse to emit rows — this is a regression lock against
       * prematurely generating UAE CT liabilities.
       */
      corpTax: { applicable: true, qualifyingFreeZone: 'TBC' },
    },
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
  },
  'santander-everyday': {
    name: 'santander-everyday',
    label: 'Santander Everyday',
    type: 'credit-card',
    currency: 'GBP',
    entityId: null,
    category: 'personal',
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
  },
};

/**
 * Get account configuration
 */
export function getAccountConfig(account: AccountName): AccountConfig {
  return ACCOUNT_CONFIG[account];
}

/**
 * Check if a string is a valid account name
 */
export function isValidAccountName(account: string): account is AccountName {
  return ACCOUNTS.includes(account as AccountName);
}

/** Validate account or fall back to barclays-current. Shared by all route handlers. */
export function validateAccount(account: string | undefined): AccountName {
  if (account && ACCOUNTS.includes(account as AccountName)) {
    return account as AccountName;
  }
  return 'barclays-current';
}

/**
 * Get business accounts that can make outgoing payments (for VAT, Corp Tax, etc.)
 */
export function getBusinessPaymentAccounts(): AccountName[] {
  return ACCOUNTS.filter(account => {
    const config = ACCOUNT_CONFIG[account];
    return config.category === 'business' && config.canMakeOutgoingPayments;
  });
}

/**
 * Get every account that belongs to a specific legal entity (Roadmap 1.1).
 * Pass `null` to enumerate personal (non-entity) accounts.
 */
export function getAccountsByEntity(entityId: EntityId | null): AccountName[] {
  return ACCOUNTS.filter(a => ACCOUNT_CONFIG[a].entityId === entityId);
}

/**
 * Resolve the legal entity an account belongs to, or `null` if the
 * account is personal (Roadmap 1.1).
 */
export function getEntityIdForAccount(account: AccountName): EntityId | null {
  return ACCOUNT_CONFIG[account].entityId;
}

/**
 * Get personal accounts that can make outgoing payments (for personal tax, etc.)
 */
export function getPersonalPaymentAccounts(): AccountName[] {
  return ACCOUNTS.filter(account => {
    const config = ACCOUNT_CONFIG[account];
    return config.category === 'personal' && config.canMakeOutgoingPayments;
  });
}

/**
 * Every account that can make outgoing payments regardless of category.
 *
 * Self Assessment is personal tax but is legitimately paid from either
 * business or personal accounts (directors sometimes route SA through the
 * company card, sometimes via their personal current account). Restricting
 * the matcher to business-only accounts silently orphans every personal-
 * account SA payment, so anything that wants to match SA-style narratives
 * needs the union.
 */
export function getBusinessAndPersonalPaymentAccounts(): AccountName[] {
  return ACCOUNTS.filter(account => ACCOUNT_CONFIG[account].canMakeOutgoingPayments);
}

/**
 * Check if an account is a credit card
 */
export function isCreditCard(account: AccountName): boolean {
  return ACCOUNT_CONFIG[account].type === 'credit-card';
}

/**
 * True if the account id is configured as a business-owned account.
 */
export function isBusinessAccount(account: string): boolean {
  if (!isValidAccountName(account)) return false;
  return ACCOUNT_CONFIG[account as AccountName].category === 'business';
}

/**
 * Cross-account transfer pairing (same amount / opposite sign) is only
 * valid for movements **within the same legal entity**. Pairing an
 * expense on one entity's account against an income on another entity's
 * account would silently net the two rows out and destroy audit-critical
 * information: that a genuine cross-border money movement happened,
 * which has to be classified (loan / capital contribution / inter-
 * company service fee) by a human or the Warnings Engine (Roadmap 1.1 /
 * Phase 5, feeding Roadmap 1.8).
 *
 * Rules (short-circuit in this exact order):
 *   1. Same account pair → `false` (nothing to pair).
 *   2. Either side not a business account → `false` (director payouts
 *      stay as expense/income).
 *   3. Both business BUT `entityId` differs → `false` (inter-company
 *      movement; Phase 8 Warnings Engine surfaces the pair for
 *      per-transaction classification via category override instead).
 *   4. Both business AND same `entityId` → `true`.
 */
export function isCrossAccountBusinessToBusinessTransfer(
  expenseAccount: string,
  incomeAccount: string,
): boolean {
  if (expenseAccount === incomeAccount) return false;
  if (!isBusinessAccount(expenseAccount) || !isBusinessAccount(incomeAccount)) return false;
  const fromEntity = ACCOUNT_CONFIG[expenseAccount as AccountName].entityId;
  const toEntity = ACCOUNT_CONFIG[incomeAccount as AccountName].entityId;
  return fromEntity !== null && toEntity !== null && fromEntity === toEntity;
}

