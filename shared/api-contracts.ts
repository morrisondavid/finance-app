/**
 * Shared API Contracts with Zod Schemas
 * 
 * This file defines all API contracts between backend and frontend using Zod.
 * - Provides compile-time TypeScript types (inferred from schemas)
 * - Provides runtime validation (via schema.parse())
 * - Single source of truth for all API contracts
 */

import { z } from 'zod';

// ============================================
// Base Type Schemas
// ============================================

export const TransactionTypeSchema = z.enum(['income', 'expense', 'transfer']);

export const TransactionSchema = z.object({
  date: z.string(),
  description: z.string(),
  amount: z.number(),
  account: z.string(),
  type: TransactionTypeSchema,
  occurrence: z.number().optional(),
  linkedTransactionId: z.number().optional()
});

export const AccountTypeSchema = z.enum(['current', 'savings', 'credit-card']);
export const AccountOwnershipSchema = z.enum(['business', 'personal']);
export const AccountNameSchema = z.enum([
  'barclays-current',
  'barclays-savings',
  'capital-on-tap',
  'barclaycard',
  'natwest'
]);

export const AccountConfigSchema = z.object({
  name: AccountNameSchema,
  label: z.string(),
  type: AccountTypeSchema,
  ownership: AccountOwnershipSchema,
  canMakeOutgoingPayments: z.boolean(),
  excludeTransfersFromIncome: z.boolean(),
  showTaxLiabilities: z.boolean()
});

export const ExtractedDateSchema = z.object({
  year: z.string(),
  month: z.string()
});

export const FileInfoSchema = z.object({
  filename: z.string(),
  size: z.number(),
  modified: z.string(),
  extractedDate: ExtractedDateSchema.nullable(),
  displayDate: z.string()
});

export const AccountStatementsSchema = z.object({
  pdf: z.array(FileInfoSchema),
  csv: z.array(FileInfoSchema)
});

export const AllStatementsSchema = z.record(z.string(), AccountStatementsSchema);

export const DashboardTotalsSchema = z.object({
  income: z.number(),
  expenses: z.number(),
  net: z.number(),
  vatLiability: z.number(),
  transfersIn: z.number(),
  transfersOut: z.number()
});

export const MonthlySummarySchema = z.object({
  month: z.string(),
  income: z.number(),
  expenses: z.number(),
  net: z.number(),
  vat: z.number()
});

export const AccountSummarySchema = z.object({
  income: z.number(),
  expenses: z.number(),
  transactionCount: z.number()
});

export const AccountBalanceSchema = z.object({
  account: z.string().optional(),
  openingBalance: z.number(),
  openingBalanceDate: z.string().nullable().optional(),
  transactionTotal: z.number(),
  currentBalance: z.number(),
  transactionCount: z.number(),
  oldestTransaction: z.string().nullable().optional(),
  newestTransaction: z.string().nullable().optional()
});

export const TaxLiabilitiesSchema = z.object({
  vatOwedThisQuarter: z.number().optional(),
  vatOutstanding: z.number().optional(),
  vatOnIncome: z.number().optional(),
  vatPaidLast4Quarters: z.number().optional(),
  vatPaid: z.number().optional(),
  vatRate: z.number().optional(),
  vatQuarter: z.object({
    label: z.string(),
    quarter: z.number(),
    startDate: z.string(),
    endDate: z.string(),
    dueDate: z.string()
  }).optional(),
  corporationTax: z.number(),
  corporationTaxRate: z.number(),
  taxableProfit: z.number(),
  davidTaxEstimate: z.number().optional(),
  davidPayments: z.object({
    total: z.number(),
    salary: z.number(),
    dividends: z.number()
  }).optional(),
  davidTaxBreakdown: z.object({
    dividendTax: z.number()
  }).optional(),
  heenaTaxEstimate: z.number().optional(),
  heenaPayments: z.object({
    total: z.number(),
    salary: z.number(),
    dividends: z.number()
  }).optional(),
  heenaTaxBreakdown: z.object({
    dividendTax: z.number()
  }).optional()
}).optional();

export const UploadedFileSchema = z.object({
  originalFilename: z.string().optional(),
  filename: z.string(),
  size: z.number(),
  path: z.string(),
  renamed: z.boolean().optional()
});

// ============================================
// API Response Schemas
// ============================================

// GET /api/dashboard/summary
export const DashboardSummaryResponseSchema = z.object({
  totals: DashboardTotalsSchema,
  monthly: z.array(MonthlySummarySchema),
  byAccount: z.record(z.string(), AccountSummarySchema),
  balances: z.record(z.string(), AccountBalanceSchema).optional(),
  currentAccountBalance: AccountBalanceSchema.optional(),
  taxLiabilities: TaxLiabilitiesSchema,
  transactionCount: z.number(),
  transferCount: z.number(),
  fileCount: z.number(),
  financialYears: z.array(z.string()),
  selectedFinancialYear: z.string().nullable(),
  selectedAccount: AccountNameSchema.optional()
});

// GET /api/dashboard/accounts
export const AccountConfigsResponseSchema = z.array(AccountConfigSchema);

// GET /api/dashboard/transactions
export const TransactionsResponseSchema = z.array(TransactionSchema);

// GET /api/dashboard/balance/:account
// POST /api/dashboard/balance/:account (response)
export const AccountBalanceResponseSchema = AccountBalanceSchema;

// GET /api/tax/vat-payments
export const VATPaymentsResponseSchema = z.object({
  payments: z.array(TransactionSchema)
});

// GET /api/statements
export const StatementsResponseSchema = AllStatementsSchema;

// GET /api/statements/years
export const StatementYearsResponseSchema = z.array(z.string());

// GET /api/statements/check-quarter
export const CheckQuarterResponseSchema = z.object({
  missingFiles: z.array(z.string())
});

// GET /api/statements/accounts
export const StatementAccountsResponseSchema = z.array(AccountConfigSchema);

// GET /api/statements/:account
export const AccountStatementResponseSchema = AccountStatementsSchema;

// GET /api/statements/invoices/list
export const InvoicesListResponseSchema = z.array(z.object({
  filename: z.string(),
  size: z.number(),
  modified: z.string()
}));

// POST /upload/:account/:type
// POST /upload/invoices
export const UploadResponseSchema = z.object({
  message: z.string(),
  files: z.array(UploadedFileSchema).optional(),
  account: z.string().optional(),
  type: z.string().optional(),
  // Error-specific fields
  error: z.string().optional(),
  details: z.array(z.object({
    filename: z.string(),
    errors: z.array(z.string())
  })).optional(),
  validFilesProcessed: z.number().optional(),
  duplicates: z.array(z.string()).optional()
});

// ============================================
// API Request Body Schemas
// ============================================

// POST /api/dashboard/balance/:account (request body)
export const SetBalanceRequestSchema = z.object({
  balance: z.number(),
  date: z.string().optional()
});

// POST /api/statements/download-selected (request body)
export const DownloadSelectedRequestSchema = z.object({
  files: z.array(z.object({
    account: z.string(),
    type: z.string(),
    filename: z.string()
  }))
});

// ============================================
// Inferred TypeScript Types
// ============================================

export type TransactionType = z.infer<typeof TransactionTypeSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type AccountType = z.infer<typeof AccountTypeSchema>;
export type AccountOwnership = z.infer<typeof AccountOwnershipSchema>;
export type AccountName = z.infer<typeof AccountNameSchema>;
export type AccountConfig = z.infer<typeof AccountConfigSchema>;
export type ExtractedDate = z.infer<typeof ExtractedDateSchema>;
export type FileInfo = z.infer<typeof FileInfoSchema>;
export type AccountStatements = z.infer<typeof AccountStatementsSchema>;
export type AllStatements = z.infer<typeof AllStatementsSchema>;
export type DashboardTotals = z.infer<typeof DashboardTotalsSchema>;
export type MonthlySummary = z.infer<typeof MonthlySummarySchema>;
export type AccountSummary = z.infer<typeof AccountSummarySchema>;
export type AccountBalance = z.infer<typeof AccountBalanceSchema>;
export type TaxLiabilities = z.infer<typeof TaxLiabilitiesSchema>;
export type UploadedFile = z.infer<typeof UploadedFileSchema>;

// API Response Types
export type DashboardSummaryResponse = z.infer<typeof DashboardSummaryResponseSchema>;
export type AccountConfigsResponse = z.infer<typeof AccountConfigsResponseSchema>;
export type TransactionsResponse = z.infer<typeof TransactionsResponseSchema>;
export type AccountBalanceResponse = z.infer<typeof AccountBalanceResponseSchema>;
export type VATPaymentsResponse = z.infer<typeof VATPaymentsResponseSchema>;
export type StatementsResponse = z.infer<typeof StatementsResponseSchema>;
export type StatementYearsResponse = z.infer<typeof StatementYearsResponseSchema>;
export type CheckQuarterResponse = z.infer<typeof CheckQuarterResponseSchema>;
export type StatementAccountsResponse = z.infer<typeof StatementAccountsResponseSchema>;
export type AccountStatementResponse = z.infer<typeof AccountStatementResponseSchema>;
export type InvoicesListResponse = z.infer<typeof InvoicesListResponseSchema>;
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

// API Request Body Types
export type SetBalanceRequest = z.infer<typeof SetBalanceRequestSchema>;
export type DownloadSelectedRequest = z.infer<typeof DownloadSelectedRequestSchema>;

// ============================================
// Validation Helper
// ============================================

/**
 * Generic helper to validate API responses with Zod schemas
 * Throws detailed error if validation fails
 */
export async function validateResponse<T>(
  response: Response,
  schema: z.ZodType<T>
): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[API] HTTP Error:', {
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      body: errorText
    });
    throw new Error(`API error ${response.status}: ${response.statusText}`);
  }
  
  let json;
  try {
    json = await response.json();
  } catch (error) {
    console.error('[API] Failed to parse JSON:', {
      url: response.url,
      error: error instanceof Error ? error.message : String(error)
    });
    throw new Error(`Failed to parse API response as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  try {
    return schema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('[API Validation] Response shape mismatch:', {
        url: response.url,
        errors: error.issues
      });
      const errorDetails = error.issues?.map(e => `${e.path.join('.')}: ${e.message}`)?.join(', ') || 'Unknown validation error';
      throw new Error(`API response validation failed: ${errorDetails}`);
    }
    console.error('[API Validation] Unexpected error:', {
      url: response.url,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
