/**
 * Transaction type
 */
export type TransactionType = 'income' | 'expense' | 'transfer';

/**
 * Normalized transaction from CSV parsing
 */
export interface Transaction {
  date: Date;
  description: string;
  amount: number;
  account: string;
  type: TransactionType;
  occurrence?: number; // For distinguishing split payments (1, 2, 3...)
}

/**
 * Transaction with date as string (for JSON responses)
 */
export interface TransactionJSON {
  date: string;
  description: string;
  amount: number;
  account: string;
  type: TransactionType;
  occurrence?: number;
  linkedTransactionId?: number;
}

/**
 * Extracted date info from filename
 */
export interface ExtractedDate {
  year: string;
  month: string;
}

/**
 * File info for statement listings
 */
export interface FileInfo {
  filename: string;
  size: number;
  modified: Date;
  extractedDate: ExtractedDate | null;
  displayDate: string;
}

/**
 * File info with type (pdf/csv)
 */
export interface FileInfoWithType extends FileInfo {
  type: 'pdf' | 'csv';
}

/**
 * Statements grouped by type for an account
 */
export interface AccountStatements {
  pdf: FileInfo[];
  csv: FileInfo[];
}

/**
 * All statements grouped by account
 */
export interface AllStatements {
  [account: string]: AccountStatements;
}

/**
 * CSV row from bank export
 */
export interface CSVRow {
  [key: string]: string;
}

/**
 * Result of header validation
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Bank-specific CSV parser configuration
 * 
 * ALL methods are REQUIRED so TypeScript catches missing implementations.
 * If you add a new parser and forget a method, tsc will fail.
 */
export interface BankParser {
  /** CSV column configuration - 'auto' to detect from header */
  columns: 'auto' | string[];
  
  /** The column name that contains the transaction date (case-insensitive lookup) */
  dateColumn: string;
  
  /** The column name that contains the transaction amount (case-insensitive lookup) */
  amountColumn: string;
  
  /** The column name that contains the transaction description (case-insensitive lookup) */
  descriptionColumn: string;
  
  /** Column headers for output CSVs (used when writing partitioned files) */
  headers: readonly string[];
  
  /** MINIMUM required headers for validation (case-insensitive matching) */
  requiredHeaders: readonly string[];
  
  /** Optional csv-parse options */
  parseOptions?: Record<string, unknown>;
  
  /** Preprocess raw CSV content before parsing */
  preprocess(content: string): string;
  
  /** Parse a date string from the CSV into a Date object */
  parseDate(dateStr: string): Date | null;
  
  /** Extract date from filename for normalization (returns YYYY-MM-DD or null) */
  extractFilenameDate(filename: string): string | null;
  
  /** Validate CSV headers - returns { valid, errors? } */
  validateHeaders(headers: string[]): ValidationResult;
  
  /** Transform a CSV row to a normalized Transaction */
  transform(row: CSVRow, account: string): Transaction | null;
}

/**
 * Map of account names to their parsers
 */
export interface ParserMap {
  [account: string]: BankParser;
}

/**
 * Result of filename normalization
 */
export interface NormalizeResult {
  original: string;
  normalized: string;
  renamed: boolean;
  newPath?: string;
}

/**
 * Monthly financial summary
 */
export interface MonthlySummary {
  month: string;
  income: number;
  expenses: number;
  net: number;
  vat: number;
}

/**
 * Account-level financial summary
 */
export interface AccountSummary {
  income: number;
  expenses: number;
  transactionCount: number;
  newestTransaction: string | null;
}

/**
 * Dashboard totals
 */
export interface DashboardTotals {
  income: number;
  expenses: number;
  net: number;
  vatLiability: number;
  transfersIn: number;
  transfersOut: number;
}

/**
 * Account balance summary
 */
export interface AccountBalance {
  openingBalance: number;
  openingBalanceDate?: string;
  transactionTotal: number;
  currentBalance: number;
  transactionCount: number;
  oldestTransaction?: string;
  newestTransaction?: string;
}

/**
 * Tax liabilities summary
 */
export interface TaxLiabilities {
  vatOwedThisQuarter?: number;
  vatOutstanding?: number;
  vatOnIncome?: number;
  vatPaidLast4Quarters?: number;
  vatPaid?: number;
  vatQuarter?: {
    label: string;
    startDate: string;
    endDate: string;
    dueDate: string;
  };
  corporationTax: number;
  corporationTaxRate: number;
  taxableProfit: number;
  davidTaxEstimate?: number;
  davidPayments?: {
    total: number;
    salary: number;
    dividends: number;
  };
  davidTaxBreakdown?: {
    dividendTax: number;
  };
  heenaTaxEstimate?: number;
  heenaPayments?: {
    total: number;
    salary: number;
    dividends: number;
  };
  heenaTaxBreakdown?: {
    dividendTax: number;
  };
}

/**
 * Full dashboard summary response
 */
export interface DashboardSummary {
  totals: DashboardTotals;
  monthly: MonthlySummary[];
  byAccount: { [account: string]: AccountSummary };
  transactionCount: number;
  transferCount: number;
  fileCount: number;
  currentAccountBalance?: AccountBalance;
  taxLiabilities?: TaxLiabilities;
  selectedFinancialYear: string | null;
  financialYears: string[];
  selectedAccount?: string;
}

/**
 * Uploaded file info
 */
export interface UploadedFile {
  originalFilename?: string;
  filename: string;
  size: number;
  path: string;
  renamed?: boolean;
}

/**
 * Upload response
 */
export interface UploadResponse {
  message: string;
  files: UploadedFile[];
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
  'natwest'
] as const;

export type AccountName = typeof ACCOUNTS[number];

/**
 * Account type classification
 */
export type AccountType = 'current' | 'savings' | 'credit-card';

/**
 * Account ownership classification
 * - business: Company accounts used for business finances
 * - personal: Personal accounts for individual finances
 */
export type AccountOwnership = 'business' | 'personal';

/**
 * Account configuration with behavior settings
 */
export interface AccountConfig {
  name: AccountName;
  label: string;
  type: AccountType;
  ownership: AccountOwnership;              // business or personal
  canMakeOutgoingPayments: boolean;         // can pay bills? (savings accounts can't)
  excludeTransfersFromIncome: boolean;      // true = don't count transfers as income
  showTaxLiabilities: boolean;              // true = show tax panel
  quarterOverlapMonths?: number;            // extra months before quarter start to include in exports (default 0)
}

/**
 * Configuration for all accounts
 */
export const ACCOUNT_CONFIG: Record<AccountName, AccountConfig> = {
  'barclays-current': {
    name: 'barclays-current',
    label: 'Barclays Current',
    type: 'current',
    ownership: 'business',
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: true,   // Primary business account
    showTaxLiabilities: true,
  },
  'barclays-savings': {
    name: 'barclays-savings',
    label: 'Barclays Savings',
    type: 'savings',
    ownership: 'business',
    canMakeOutgoingPayments: false,     // Savings accounts can't pay bills
    excludeTransfersFromIncome: false,  // Show transfers as income
    showTaxLiabilities: false,
  },
  'capital-on-tap': {
    name: 'capital-on-tap',
    label: 'Capital on Tap',
    type: 'credit-card',
    ownership: 'business',
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,  // Show payments as income
    showTaxLiabilities: false,
    quarterOverlapMonths: 1,            // mid-month billing: include 1 extra month before quarter start
  },
  'barclaycard': {
    name: 'barclaycard',
    label: 'Barclaycard',
    type: 'credit-card',
    ownership: 'business',
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
  },
  'natwest': {
    name: 'natwest',
    label: 'NatWest',
    type: 'current',
    ownership: 'personal',
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,  // Legacy/secondary account
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

/**
 * Get business accounts that can make outgoing payments (for VAT, Corp Tax, etc.)
 */
export function getBusinessPaymentAccounts(): AccountName[] {
  return ACCOUNTS.filter(account => {
    const config = ACCOUNT_CONFIG[account];
    return config.ownership === 'business' && config.canMakeOutgoingPayments;
  });
}

/**
 * Get personal accounts that can make outgoing payments (for personal tax, etc.)
 */
export function getPersonalPaymentAccounts(): AccountName[] {
  return ACCOUNTS.filter(account => {
    const config = ACCOUNT_CONFIG[account];
    return config.ownership === 'personal' && config.canMakeOutgoingPayments;
  });
}

/**
 * Check if an account is a credit card
 */
export function isCreditCard(account: AccountName): boolean {
  return ACCOUNT_CONFIG[account].type === 'credit-card';
}
