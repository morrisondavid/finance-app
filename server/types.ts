// ─── Wire types: re-exported from the single source of truth ─────────────────
// All JSON-serializable types that cross the HTTP boundary are defined as
// Zod schemas in shared/api-contracts.ts.  TypeScript types are derived via
// z.infer<> there.  We re-export them here for convenience so that server code
// can keep importing from '../types.js' without churn.

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
 * List of supported accounts
 */
export const ACCOUNTS = [
  'barclays-current',
  'barclays-savings',
  'capital-on-tap',
  'barclaycard',
  'natwest',
  'monzo-joint'
] as const;

export type AccountName = typeof ACCOUNTS[number];

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
 * Per-tax-type flags for business accounts.
 * Only business accounts can have these — enforced by the discriminated union below.
 */
export interface BusinessTaxConfig {
  vatApplicable: boolean;
  corpTaxApplicable: boolean;
}

interface BaseAccountConfig {
  name: AccountName;
  label: string;
  type: AccountType;
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
    category: 'business',
    business: { vatApplicable: true, corpTaxApplicable: true },
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: true,
    showTaxLiabilities: true,
  },
  'barclays-savings': {
    name: 'barclays-savings',
    label: 'Barclays Savings',
    type: 'savings',
    category: 'business',
    business: { vatApplicable: false, corpTaxApplicable: false },
    canMakeOutgoingPayments: false,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
  },
  'capital-on-tap': {
    name: 'capital-on-tap',
    label: 'Capital on Tap',
    type: 'credit-card',
    category: 'business',
    business: { vatApplicable: false, corpTaxApplicable: false },
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
    quarterOverlapMonths: 1,
  },
  'barclaycard': {
    name: 'barclaycard',
    label: 'Barclaycard',
    type: 'credit-card',
    category: 'business',
    business: { vatApplicable: false, corpTaxApplicable: false },
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
  },
  'natwest': {
    name: 'natwest',
    label: 'NatWest',
    type: 'current',
    category: 'personal',
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
  },
  'monzo-joint': {
    name: 'monzo-joint',
    label: 'Monzo Joint',
    type: 'current',
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
 * Type guard: narrows AccountConfig to BusinessAccountConfig.
 */
export function isBusinessConfig(c: AccountConfig): c is BusinessAccountConfig {
  return c.category === 'business';
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
 * Get personal accounts that can make outgoing payments (for personal tax, etc.)
 */
export function getPersonalPaymentAccounts(): AccountName[] {
  return ACCOUNTS.filter(account => {
    const config = ACCOUNT_CONFIG[account];
    return config.category === 'personal' && config.canMakeOutgoingPayments;
  });
}

/**
 * Accounts whose income is subject to VAT.
 * Double gate: must be category === 'business' AND business.vatApplicable === true.
 */
export function getVatApplicableAccounts(): AccountName[] {
  return ACCOUNTS.filter(a => {
    const c = ACCOUNT_CONFIG[a];
    return isBusinessConfig(c) && c.business.vatApplicable;
  });
}

/**
 * Accounts whose income is subject to Corporation Tax.
 * Double gate: must be category === 'business' AND business.corpTaxApplicable === true.
 */
export function getCorpTaxApplicableAccounts(): AccountName[] {
  return ACCOUNTS.filter(a => {
    const c = ACCOUNT_CONFIG[a];
    return isBusinessConfig(c) && c.business.corpTaxApplicable;
  });
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
 * Cross-account transfer pairing (same amount / opposite sign) is only for business-to-business
 * movements. Payouts to personal accounts (e.g. director salary/dividends) stay as expense/income.
 */
export function isCrossAccountBusinessToBusinessTransfer(
  expenseAccount: string,
  incomeAccount: string,
): boolean {
  if (expenseAccount === incomeAccount) return false;
  return isBusinessAccount(expenseAccount) && isBusinessAccount(incomeAccount);
}
