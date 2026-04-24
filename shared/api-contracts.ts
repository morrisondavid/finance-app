/**
 * Shared API Contracts with Zod Schemas
 * 
 * This file defines all API contracts between backend and frontend using Zod.
 * - Provides compile-time TypeScript types (inferred from schemas)
 * - Provides runtime validation (via schema.parse())
 * - Single source of truth for all API contracts
 */

import { z } from 'zod';
import { CATEGORY_NAMES } from './category-names.js';

// ============================================
// Base Type Schemas
// ============================================

/**
 * Canonical category name, matched against the shared `CATEGORY_NAMES`
 * tuple so additions to the category enum are rejected by Zod without
 * a manual schema bump.
 */
export const CategoryNameSchema = z.enum(CATEGORY_NAMES);

export const TransactionTypeSchema = z.enum(['income', 'expense', 'transfer']);

export const TransactionSchema = z.object({
  date: z.string(),
  description: z.string(),
  amount: z.number(),
  account: z.string(),
  type: TransactionTypeSchema,
  category: z.string().optional(),
  occurrence: z.number().optional(),
  linkedTransactionId: z.number().optional()
});

export const AccountTypeSchema = z.enum(['current', 'savings', 'credit-card']);
export const AccountCategorySchema = z.enum(['business', 'personal']);
/** @deprecated Use AccountCategorySchema instead */
export const AccountOwnershipSchema = AccountCategorySchema;
export const AccountNameSchema = z.enum([
  'barclays-current',
  'barclays-savings',
  'capital-on-tap',
  'barclaycard',
  'wise-ltd',
  'natwest',
  'natwest-savings',
  'monzo-joint',
  'emirates-islamic',
  'santander-everyday'
]);

/**
 * Canonical list of supported account ids.
 * Derived from {@link AccountNameSchema} so adding a new account only requires
 * updating the schema — the literal tuple, the TS union type, and any runtime
 * iteration all follow automatically.
 */
export const ACCOUNTS = AccountNameSchema.options;

export const CurrencyCodeSchema = z.enum(['GBP', 'AED']);
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

/**
 * Canonical recurrence frequency enum.
 *
 * Single source of truth for every "how often does this happen" concept in the
 * app (obligations, recurring expenses, upcoming payments). Narrower surfaces
 * (e.g. the recurring-expense detector, which currently only tracks monthly /
 * annual cadences) derive a subset via `FrequencySchema.extract([...])` instead
 * of redeclaring literals — that way adding a new cadence here automatically
 * surfaces everywhere it's legal, and is a compile-time error everywhere it
 * isn't yet handled.
 */
export const FrequencySchema = z.enum(['monthly', 'quarterly', 'annual', 'one-off']);
export type Frequency = z.infer<typeof FrequencySchema>;

/**
 * Subset of {@link FrequencySchema} supported by the recurring-expense
 * detector and the expenses-overview sheet. Derived (not redeclared) so
 * extending `FrequencySchema` can't silently drift from this surface.
 */
export const RecurringFrequencySchema = FrequencySchema.extract(['monthly', 'annual']);

export const AccountConfigSchema = z.object({
  name: AccountNameSchema,
  label: z.string(),
  type: AccountTypeSchema,
  currency: CurrencyCodeSchema,
  category: AccountCategorySchema,
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
  transfersOut: z.number(),
  passThroughIncome: z.number(),
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
  transactionCount: z.number(),
  newestTransaction: z.string().nullable()
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
  vatInProgressQuarter: z.object({
    label: z.string(),
    quarter: z.number(),
    startDate: z.string(),
    endDate: z.string(),
    dueDate: z.string()
  }).nullable().optional(),
  vatInProgressEstimate: z.number().optional(),
  corporationTax: z.number(),
  corporationTaxRate: z.number(),
  taxableProfit: z.number(),
  davidTaxEstimate: z.number().optional(),
  davidPayments: z.object({
    total: z.number(),
    salary: z.number(),
    dividends: z.number(),
    annualSalary: z.number()
  }).optional(),
  davidTaxBreakdown: z.object({
    dividendTax: z.number()
  }).optional(),
  heenaTaxEstimate: z.number().optional(),
  heenaPayments: z.object({
    total: z.number(),
    salary: z.number(),
    dividends: z.number(),
    annualSalary: z.number()
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

export const BudgetPeriodSchema = z.enum(['monthly', 'yearly']);
export type BudgetPeriod = z.infer<typeof BudgetPeriodSchema>;

export const BudgetMonthComparisonSchema = z.object({
  monthKey: z.string(),
  monthLabel: z.string(),
  budget: z.number(),
  spent: z.number(),
  /** spent minus budget (negative = under budget). */
  difference: z.number(),
});

export const BudgetComparisonSchema = z.object({
  category: z.string(),
  monthlyBudget: z.number(),
  months: z.array(BudgetMonthComparisonSchema).default([]),
});

export const YearlyBudgetComparisonSchema = z.object({
  category: z.string(),
  yearlyBudget: z.number(),
  spent: z.number(),
  /** spent minus yearlyBudget (negative = under budget). */
  difference: z.number(),
});

export const BudgetRowSchema = z.object({
  id: z.number(),
  account: AccountNameSchema,
  category: z.string(),
  /** Monthly cap or full FY cap depending on `period`. */
  amount: z.number(),
  period: BudgetPeriodSchema,
});

export const BudgetsListResponseSchema = z.object({
  budgets: z.array(BudgetRowSchema),
});

export const BudgetUpsertBodySchema = z.object({
  account: AccountNameSchema,
  category: z.string(),
  amount: z.number(),
  period: BudgetPeriodSchema,
});

export const BudgetCategoryNamesResponseSchema = z.object({
  categories: z.array(z.string()),
});

export const BudgetNudgeSchema = z.object({
  /** Display label (registry or cleaned merchant name); also used as drill-down `search` substring. */
  merchant: z.string(),
  suggestedCategory: z.string(),
  totalSpend: z.number(),
  transactionCount: z.number(),
  lastDate: z.string(),
  logoUrl: z.string().nullable(),
});

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
  selectedAccount: AccountNameSchema.optional(),
  budgetComparisons: z.array(BudgetComparisonSchema).default([]),
  yearlyBudgetComparisons: z.array(YearlyBudgetComparisonSchema).default([]),
  budgetNudges: z.array(BudgetNudgeSchema).default([]),
});

// GET /api/dashboard/accounts
export const AccountConfigsResponseSchema = z.array(AccountConfigSchema);

// GET /api/dashboard/transactions
export const TransactionsResponseSchema = z.array(TransactionSchema);

// GET /api/dashboard/balance/:account
// POST /api/dashboard/balance/:account (response)
export const AccountBalanceResponseSchema = AccountBalanceSchema;

// GET /api/tax/vat-payments — returns HMRC payment matches (not full Transaction rows)
export const HmrcPaymentMatchSchema = z.object({
  date: z.string(),
  amount: z.number(),
  account: z.string(),
  description: z.string(),
});

export const VATPaymentsResponseSchema = z.object({
  payments: z.array(HmrcPaymentMatchSchema)
});

// GET /api/dashboard/categories
export const CategoryBreakdownSchema = z.object({
  name: z.string(),
  total: z.number(),
  count: z.number(),
  percentage: z.number(),
  colour: z.string(),
});

export const CategoriesResponseSchema = z.object({
  categories: z.array(CategoryBreakdownSchema),
  totalExpenses: z.number(),
});

// GET /api/expenses/overview — household expenses sheet (monthly + separate annual)
export const ExpensesVariancePointSchema = z.object({
  period: z.string(),
  expected: z.number(),
  actual: z.number(),
});

export const ExpensesLineItemSchema = z.object({
  /** Stable id for simulation excludes: `expense|monthly|…` / `income|annual|…` + recurringKey. */
  lineKey: z.string(),
  merchant: z.string(),
  category: z.string(),
  amount: z.number(),
  frequency: RecurringFrequencySchema,
  sourceAccount: z.string(),
  accountCategory: AccountCategorySchema,
  isVariable: z.boolean(),
  billingDayOfMonth: z.number().nullable(),
  billingMonth: z.number().nullable(),
  variance: z.array(ExpensesVariancePointSchema),
  /** Native-currency figure for non-GBP bills (e.g. AED). `amount` is always GBP. */
  nativeAmount: z.number().optional(),
  nativeCurrency: CurrencyCodeSchema.optional(),
});

export const ExpensesSectionSchema = z.object({
  name: z.string(),
  colour: z.string(),
  subtotal: z.number(),
  items: z.array(ExpensesLineItemSchema),
});

export const ExpensesIncomeSplitSchema = z.object({
  items: z.array(ExpensesLineItemSchema),
  total: z.number(),
});

/** Morrison spreadsheet–aligned monthly insight (recurring fixed costs only). */
export const ExpensesInsightSchema = z.object({
  totalFixedMonthlyExpenses: z.number(),
  /** max(0, total fixed − passive); income still needed after rent/dividends etc. Fixed Expenses UI appends "(after tax)". */
  monthlyIncomeNeededAfterPassive: z.number(),
  /** Net after passive: shortfall (need) vs surplus (income exceeds costs) — both ≥ 0 */
  netExpensesSalaryIncludedShortfall: z.number(),
  netExpensesSalaryIncludedSurplus: z.number(),
  netExpensesSalaryExcludedShortfall: z.number(),
  netExpensesSalaryExcludedSurplus: z.number(),
  netPersonalExpensesSalaryExcludedShortfall: z.number(),
  netPersonalExpensesSalaryExcludedSurplus: z.number(),
  /**
   * How much must flow to the joint / household bills layer after passive, salary, and
   * business recurring are recognised — same as `netPersonalExpensesSalaryExcluded*` (shortfall
   * or surplus). Salaries are assumed to stay in personal accounts; this is what’s left to fund
   * joint bills from company dividends/transfers in the model.
   */
  moneyNeededJointAccount: z.number(),
  /** Surplus on the joint / household layer when income allocations exceed personal fixed costs. */
  jointAccountMonthlySurplus: z.number(),
  businessExpenses: z.number(),
  businessExpensesSalaryExcluded: z.number(),
  totalSalary: z.number(),
  /** Personal fixed recurring excluding debt (matches “Personal Expenses” hyphen row) */
  personalExpenses: z.number(),
  /** Recurring monthly outgoings on NatWest personal (same account as personal fixed subset). */
  natwestPersonalFixed: z.number(),
  qualityOfLifeExpenses: z.number(),
  billsExpenses: z.number(),
  totalPassiveIncome: z.number(),
  debtShortTerm: z.number(),
  debtMediumTerm: z.number(),
  debtTotal: z.number(),
  /** Optional split when dividend lines are labelled; null if not detected */
  dividendHeena: z.number().nullable(),
  dividendDavid: z.number().nullable(),
});

/** GET /api/expenses/overview — Fixed Expenses tab payload (fixed recurring monthly/annual, all accounts). */
export const ExpensesSheetResponseSchema = z.object({
  monthlyOutgoings: z.array(ExpensesSectionSchema),
  annualOutgoings: z.array(ExpensesSectionSchema),
  incomeMonthly: ExpensesIncomeSplitSchema,
  incomeAnnual: ExpensesIncomeSplitSchema,
  insight: ExpensesInsightSchema,
  summary: z.object({
    totalMonthlyOutgoings: z.number(),
    totalAnnualOutgoings: z.number(),
    totalMonthlyIncome: z.number(),
    totalAnnualIncome: z.number(),
    /** Monthly fixed income minus monthly fixed outgoings (positive = surplus) */
    netMonthlyFixed: z.number(),
    /** max(0, fixed outgoings − recurring income) — amount to cover from salary/other each month */
    needToEarnMonthly: z.number(),
    /** max(0, recurring income − fixed outgoings) */
    monthlySurplus: z.number(),
    personalMonthlyFixed: z.number(),
    businessMonthlyFixed: z.number(),
    /** Sum of recurring monthly items in Debt Repayment category */
    debtMonthlyFixed: z.number(),
    /** Annual recurring income minus annual recurring outgoings */
    netAnnualFixed: z.number(),
    /** 12 × monthly fixed recurring outgoings + sum of annual recurring outgoings (per-year amounts). */
    totalYearlyFixedOutgoings: z.number(),
    /** 12 × monthly passive recurring + annual recurring income lines counted as passive (non-salary). */
    totalYearlyPassiveIncome: z.number(),
    /** max(0, totalYearlyFixedOutgoings − totalYearlyPassiveIncome). Fixed Expenses UI appends "(after tax)". */
    yearlyIncomeNeededAfterPassive: z.number(),
    /** Human-readable window, e.g. "Last 24 months" */
    periodDescription: z.string(),
    monthsCovered: z.number(),
  }),
  /** Line keys excluded from totals (simulation); empty when none. */
  excludedLineKeys: z.array(z.string()).optional(),
});

export const SimulationExclusionsResponseSchema = z.object({
  lineKeys: z.array(z.string()),
});

export const SimulationExclusionsPutBodySchema = z.object({
  lineKeys: z.array(z.string()),
});

// GET /api/expenses/ad-hoc?account=&financialYear=&min=&limit=  (financialYear empty = all time)
export const AdHocExpenseItemSchema = z.object({
  /** `category|merchant|account|all` (merged bins) or legacy strict pipeline key for series. */
  bucketKey: z.string(),
  category: z.string(),
  merchant: z.string(),
  total: z.number(),
  count: z.number(),
  lastDate: z.string(),
  sampleDescription: z.string(),
});

export const AdHocExpensesResponseSchema = z.object({
  account: z.string(),
  /** Selected FY label (e.g. `2024/25`) or null for all time */
  financialYear: z.string().nullable(),
  /** Human-readable range, e.g. `1 May 2024 – 30 Apr 2025 (2024/25)` or `All time` */
  periodDescription: z.string(),
  /** Start of analysis window (FY start, or oldest expense date in all-time mode) */
  analysisCutoff: z.string(),
  pipelineMonths: z.number(),
  analysisMonths: z.number(),
  minTotal: z.number(),
  limit: z.number(),
  items: z.array(AdHocExpenseItemSchema),
});

// GET /api/expenses/ad-hoc/series?account=&financialYear=&bucketKey=
export const AdHocMerchantSeriesPointSchema = z.object({
  month: z.string(),
  total: z.number(),
  count: z.number(),
});

export const AdHocMerchantSeriesResponseSchema = z.object({
  account: z.string(),
  financialYear: z.string().nullable(),
  periodDescription: z.string(),
  /** Echo of request key: merged `…|all` or strict `…|amountBucket`. */
  bucketKey: z.string(),
  category: z.string(),
  merchant: z.string(),
  points: z.array(AdHocMerchantSeriesPointSchema),
});

// GET /api/expenses/recurring
// `RecurringFrequencySchema` is the canonical monthly / annual subset of
// {@link FrequencySchema}; it's declared at the top of this file so the
// expenses-overview sheet can also reference it.

export const RecurringExpenseSchema = z.object({
  merchant: z.string(),
  category: z.string(),
  colour: z.string(),
  amount: z.number(),
  frequency: RecurringFrequencySchema,
  monthsActive: z.number(),
  annualTotal: z.number(),
  logoUrl: z.string().nullable(),
  sourceAccount: z.string(),
  billingDayOfMonth: z.number().nullable(),
  billingMonth: z.number().nullable(),
  /** Native-currency figure for non-GBP bills (e.g. AED). `amount` is always GBP. */
  nativeAmount: z.number().optional(),
  nativeCurrency: CurrencyCodeSchema.optional(),
  /**
   * Back-reference to the obligation row that produced this entry,
   * when the recurring expense was driven by the obligations registry
   * (either by relaxing the detector with declared evidence, or by being
   * synthesised whole from a zero-transaction declaration). Downstream
   * surfaces that also read the obligations registry (e.g. the Obligations
   * tab) use this id to dedupe against their own projection of the same
   * obligation.
   */
  declaredObligationId: z.string().optional(),
});

export const RecurringExpensesResponseSchema = z.object({
  monthly: z.array(RecurringExpenseSchema),
  annual: z.array(RecurringExpenseSchema),
  account: z.string(),
  financialYear: z.string(),
  monthsCovered: z.number(),
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
// NB: this lists invoice-pdf uploads for the statements module (scanned
// docs living under `invoices/`); it is NOT the §1.3 invoice registry
// list. The domain `GET /api/invoices` uses `InvoicesListResponseSchema`
// defined near the other invoice schemas below.
export const StatementInvoiceUploadsListResponseSchema = z.array(z.object({
  filename: z.string(),
  size: z.number(),
  modified: z.string()
}));

// POST /upload/:account/:type
// POST /upload/invoices
export const InvoiceUploadIngestResultSchema = z.object({
  filename: z.string(),
  outcome: z.enum(['ingested', 'archived-only', 'failed']),
  code: z.string().optional(),
  invoiceId: z.string().optional(),
  message: z.string().optional(),
});

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
  duplicates: z.array(z.string()).optional(),
  invoiceIngestResults: z.array(InvoiceUploadIngestResultSchema).optional(),
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
// Obligations Schemas
// ============================================

export const ObligationSourceSchema = z.enum(['manual', 'auto']);
export const ObligationTypeSchema = z.enum([
  'vat', 'corporation-tax', 'self-assessment', 'hmrc-ttp', 'loan', 'subscription', 'insurance', 'other'
]);
/**
 * Frequency surface for the obligations registry / DB row.
 * Alias of the canonical {@link FrequencySchema} — preserved as a named
 * export for call-site clarity, but guaranteed to stay in lock-step by
 * construction.
 */
export const ObligationFrequencySchema = FrequencySchema;
export const ObligationStatusSchema = z.enum(['pending', 'paid', 'overdue', 'confirmed', 'not-yet-due', 'unpaid', 'insufficient-data']);

/**
 * Person identifier — matches the literal union type derived from
 * `server/domain/people/data.ts`. Kept as a string enum here so the
 * shared package stays free of server-only imports; runtime validation
 * defers to `server/domain/people/index.ts::isPersonId` where it matters.
 */
export const PersonIdSchema = z.enum(['david', 'heena']);

/**
 * Shape of a row in the `financial_obligations` DB table, surfaced to the
 * UI via `/api/obligations`. Distinct from the domain `Obligation` (the
 * user-declared source of truth) — this type is the *projection* of an
 * Obligation + per-occurrence state into a flat row for the Obligations tab.
 */
export const ObligationRowSchema = z.object({
  id: z.string(),
  source: ObligationSourceSchema,
  type: ObligationTypeSchema,
  name: z.string(),
  entity: z.string(),
  frequency: ObligationFrequencySchema,
  expectedAmount: z.number().nullable(),
  dueDate: z.string().nullable(),
  status: ObligationStatusSchema,
  paidAmount: z.number().nullable(),
  paidDate: z.string().nullable(),
  paidFromAccount: z.string().nullable(),
  notes: z.string().nullable(),
  personId: PersonIdSchema.nullable().optional(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const ObligationsListResponseSchema = z.object({
  obligations: z.array(ObligationRowSchema),
});

export const VatQuarterReconciliationSchema = z.object({
  quarterLabel: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  dueDate: z.string(),
  quarter: z.number(),
  expectedAmount: z.number(),
  paidAmount: z.number(),
  paidDate: z.string().nullable(),
  paidFromAccount: z.string().nullable(),
  status: ObligationStatusSchema,
});

export const VatReconciliationResponseSchema = z.object({
  quarters: z.array(VatQuarterReconciliationSchema),
});

export const UpcomingObligationsResponseSchema = z.object({
  obligations: z.array(ObligationRowSchema),
});

export const OverdueObligationsResponseSchema = z.object({
  obligations: z.array(ObligationRowSchema),
});

// ============================================
// Obligations (canonical declared source-of-truth)
// ============================================
//
// An `Obligation` is any user-declared recurring financial item — the
// single source of truth behind Fixed Expenses, the Obligations tab,
// Rental Income, Payroll, and every upcoming-payments feed. This replaces
// the four parallel sources that existed historically (FIXED_BILL_OVERRIDES,
// RENTAL_PROPERTIES, PAYROLL_ENTRIES, manual-obligations.csv). See
// docs/adr/0001-obligations.md for the full decision record.
//
// Not to be confused with {@link ObligationRow} — that's the DB row shape
// surfaced to the Obligations tab (a projection of an Obligation + state).
//
// Direction is split at the schema level — income and outgoings are
// different kinds of thing, so functions that operate on one direction
// can't be called with the other.
//
// {@link FrequencySchema} is the canonical recurrence enum and is defined
// at the top of this file; the obligations domain re-uses it verbatim.

const ObligationBase = z.object({
  id: z.string(),
  /** How often the obligation repeats. Canonical across the entire domain. */
  frequency: FrequencySchema,
  /** Value emitted by `normalizeMerchant(description)` used to match transactions. */
  merchant: z.string(),
  /**
   * Human-friendly label for UI. Falls back to `merchant` when absent. Used
   * for rental property names ("78 Hunters Square") and payroll labels
   * ("Director salary — David") that diverge from the normalised payee key.
   */
  displayName: z.string().optional(),
  /**
   * Source/destination account. Required for pipeline-driven categories
   * (fixed-bill, subscription, payroll, rental-income) that need to match
   * transactions. Optional for declaration-only categories (insurance,
   * tax-manual) where payment may come from any account.
   */
  account: z.string().optional(),
  amount: z.number(),
  currency: CurrencyCodeSchema.default('GBP'),
  notes: z.string().optional(),
});

/**
 * Build a obligation variant schema for a given category. Uses two sequential
 * `.extend()` calls rather than spreading `extra` into one object literal —
 * spreading a generic `z.ZodRawShape` collapses the result's type to an index
 * signature and breaks `z.infer` for every field on `ObligationBase`.
 *
 * The default `E = {}` is crucial: without it, variants with no extra fields
 * fall back to the `ZodRawShape` constraint (which carries an index signature)
 * and erase the discriminant.
 */
const obligationCategory = <N extends string, E extends z.ZodRawShape = {}>(
  name: N,
  extra: E = {} as E,
) => ObligationBase.extend(extra).extend({ category: z.literal(name) });

export const IncomingObligationSchema = z.discriminatedUnion('category', [
  obligationCategory('rental-income', {
    ownership: z.record(PersonIdSchema, z.number()),
  }),
]);

export const OutgoingObligationSchema = z.discriminatedUnion('category', [
  obligationCategory('fixed-bill'),
  obligationCategory('subscription'),
  obligationCategory('payroll', {
    /**
     * Canonical link to the person being paid. Required — payroll matching
     * uses `PEOPLE[personId].matchAliases` against raw descriptions rather
     * than relying on the inherited `merchant` string, so the id must be
     * authoritative.
     */
    personId: PersonIdSchema,
    amountTolerance: z.number().optional(),
  }),
  obligationCategory('insurance', {
    dueDate: z.string().optional(),
    /**
     * Optional per-row override for the obligation-state-matcher's default
     * amount-tolerance ratio when auto-matching renewal debits. Useful
     * for insurance policies whose premiums climb sharply year-over-year
     * and would otherwise fall outside the default tolerance window.
     * Expressed as a decimal fraction (e.g. 0.3 = ±30%).
     */
    amountTolerance: z.number().optional(),
  }),
  obligationCategory('tax-manual', {
    personId: PersonIdSchema.optional(),
    dueDate: z.string().optional(),
    /**
     * Subtype of the tax obligation — mirrors the historical API `type` enum
     * values that all project down to the `tax-manual` obligation category.
     * Preserved so a `vat` obligation round-trips through
     * obligations.csv back to the Obligations tab as `type='vat'` (not
     * silently collapsed to `self-assessment`). Optional for backwards-
     * compatibility with rows written before this field existed.
     */
    taxType: z.enum(['vat', 'corporation-tax', 'self-assessment', 'hmrc-ttp']).optional(),
  }),
]);

/**
 * Alias of {@link RecurringFrequencySchema}. The upcoming-payments feed
 * inherits the same cadence surface as the recurring-expense detector;
 * kept as a named export so call sites can signal intent.
 */
export const UpcomingRecurringFrequencySchema = RecurringFrequencySchema;

export const UpcomingRecurringSchema = z.object({
  merchant: z.string(),
  category: z.string(),
  colour: z.string(),
  logoUrl: z.string().nullable(),
  amount: z.number(),
  frequency: UpcomingRecurringFrequencySchema,
  sourceAccount: z.string(),
  nextExpectedDate: z.string(),
  lastChargeDate: z.string().nullable(),
  /** See {@link RecurringExpenseSchema.declaredObligationId}. */
  declaredObligationId: z.string().optional(),
});

/**
 * Merged upcoming-payments feed combining non-completed obligations with
 * predicted annual recurring charges. The Obligations page renders this single
 * list, sorted by soonest date, so monthly recurring items are deliberately
 * excluded upstream (they live in the Fixed Expenses / Budget surfaces).
 */
export const UpcomingPaymentItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('obligation'),
    id: z.string(),
    type: z.string(),
    name: z.string(),
    entity: z.string(),
    expectedAmount: z.number().nullable(),
    dueDate: z.string(),
    status: z.string(),
    source: z.string(),
    personId: PersonIdSchema.nullable().optional(),
  }),
  z.object({
    kind: z.literal('recurring'),
    merchant: z.string(),
    category: z.string(),
    colour: z.string(),
    logoUrl: z.string().nullable(),
    amount: z.number(),
    sourceAccount: z.string(),
    nextExpectedDate: z.string(),
  }),
]);

export const UpcomingPaymentsResponseSchema = z.object({
  items: z.array(UpcomingPaymentItemSchema),
});

export const CreateObligationBodySchema = z.object({
  type: ObligationTypeSchema,
  name: z.string().min(1),
  entity: z.string().min(1),
  frequency: ObligationFrequencySchema,
  expectedAmount: z.number().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  status: ObligationStatusSchema.optional(),
  notes: z.string().nullable().optional(),
  personId: PersonIdSchema.nullable().optional(),
});

export const UpdateObligationBodySchema = CreateObligationBodySchema.partial();

/**
 * Body of `POST /api/obligations/:id/state`. Lightweight write path used
 * by the Mark Paid UI (and any future explicit-override surface) to
 * publish a user-authored status override into `obligation-state.csv`.
 * Always writes a `source=user` row; auto-* ids are rejected server-side.
 */
export const ObligationStateUpsertBodySchema = z.object({
  status: ObligationStatusSchema,
  paidAmount: z.number().nullable().optional(),
  paidDate: z.string().nullable().optional(),
  paidFromAccount: z.string().nullable().optional(),
});

// ============================================
// Obligation Dismissals
// ============================================
//
// A dismissal records that the user has hidden a specific auto-seeded
// obligation slot (SA or VAT). Only ids prefixed `auto-` are valid — manual
// rows are managed by the regular delete endpoint, not dismissed.

/** Auto-row ids are `auto-<type>-...` by construction (see sa-auto-seed + vat-auto-seed). */
export const AutoObligationIdSchema = z.string().regex(/^auto-/, 'Obligation id must start with "auto-"');

export const DismissalSchema = z.object({
  obligationId: AutoObligationIdSchema,
  reason: z.string().nullable().optional(),
  dismissedAt: z.string(),
});

export const CreateDismissalBodySchema = z.object({
  obligationId: AutoObligationIdSchema,
  reason: z.string().max(500).nullable().optional(),
});

export const DismissalsListResponseSchema = z.object({
  dismissals: z.array(DismissalSchema),
});

// ============================================
// Debts (external creditors — see server/db/debts-csv.ts)
// ============================================

/** Slug: lowercase letters, digits, hyphens; must start with a letter or digit. */
export const DebtIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const DebtKindSchema = z.enum(['consumer', 'mortgage']);
export const RepaymentTypeSchema = z.enum(['repayment', 'interest-only']);

export const DebtSchema = z.object({
  id: DebtIdSchema,
  name: z.string().min(1),
  merchantPattern: z.string().min(1),
  sourceAccounts: z.array(AccountNameSchema).min(1),
  originalLoanAmount: z.number().positive(),
  originalLoanDate: IsoDateSchema.nullable(),
  openingBalance: z.number().min(0),
  openingBalanceDate: IsoDateSchema,
  archived: z.boolean(),
  /**
   * Payment amounts used to disambiguate debts that share the same merchant
   * pattern. Empty array = no amount filter.
   */
  matchAmounts: z.array(z.number().positive()),
  kind: DebtKindSchema,
  interestRate: z.number().positive().nullable(),
  fixedRateEndDate: IsoDateSchema.nullable(),
  repaymentType: RepaymentTypeSchema.nullable(),
  propertyValueEstimate: z.number().positive().nullable(),
  propertyId: z.string().nullable(),
  updatedAt: z.string(),
});

export const DebtSummarySchema = DebtSchema.extend({
  currentBalance: z.number(),
  paidSinceOpening: z.number(),
  lastPaymentDate: z.string().nullable(),
  lastPaymentAmount: z.number().nullable(),
  matchedTransactionCount: z.number().int().nonnegative(),
  /** 0..1, ratio of the original loan principal that has been paid off. */
  payoffProgress: z.number().min(0).max(1),
});

export const DebtSummariesResponseSchema = z.object({
  debts: z.array(DebtSummarySchema),
  consumerTotal: z.number(),
  mortgageTotal: z.number(),
  totalOutstanding: z.number(),
  totalPropertyValue: z.number(),
  netEquity: z.number(),
});

export const DebtCreateBodySchema = z.object({
  id: DebtIdSchema,
  name: z.string().min(1),
  merchantPattern: z.string().min(1),
  sourceAccounts: z.array(AccountNameSchema).min(1),
  originalLoanAmount: z.number().positive(),
  originalLoanDate: IsoDateSchema.nullable().optional(),
  openingBalance: z.number().min(0),
  openingBalanceDate: IsoDateSchema,
  matchAmounts: z.array(z.number().positive()).optional(),
  kind: DebtKindSchema.optional(),
  interestRate: z.number().positive().nullable().optional(),
  fixedRateEndDate: IsoDateSchema.nullable().optional(),
  repaymentType: RepaymentTypeSchema.nullable().optional(),
  propertyValueEstimate: z.number().positive().nullable().optional(),
  propertyId: z.string().nullable().optional(),
});

export const DebtUpdateBodySchema = z.object({
  name: z.string().min(1).optional(),
  merchantPattern: z.string().min(1).optional(),
  sourceAccounts: z.array(AccountNameSchema).min(1).optional(),
  originalLoanAmount: z.number().positive().optional(),
  originalLoanDate: IsoDateSchema.nullable().optional(),
  openingBalance: z.number().min(0).optional(),
  openingBalanceDate: IsoDateSchema.optional(),
  archived: z.boolean().optional(),
  matchAmounts: z.array(z.number().positive()).optional(),
  kind: DebtKindSchema.optional(),
  interestRate: z.number().positive().nullable().optional(),
  fixedRateEndDate: IsoDateSchema.nullable().optional(),
  repaymentType: RepaymentTypeSchema.nullable().optional(),
  propertyValueEstimate: z.number().positive().nullable().optional(),
  propertyId: z.string().nullable().optional(),
});

export const DebtOpeningBalanceBodySchema = z.object({
  balance: z.number().min(0),
  date: IsoDateSchema,
});

export const DebtResponseSchema = z.object({ debt: DebtSchema });

// ============================================
// Deadlines (non-financial reminders — see server/domain/deadlines/)
// ============================================
//
// A Deadline is a non-financial reminder with a due date (e.g. Companies
// House confirmation statement, MOT, EPC renewal). They share a
// presentation surface (the Deadlines tab + calendar) with financial
// obligations but never have an `amount`/`entity`, and their state is
// a simple `completedDate` rather than the richer `obligation-state.csv`
// override shape.

/** Slug: lowercase letters, digits, hyphens; must start with a letter or digit. */
export const DeadlineIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export const DeadlineTypeSchema = z.enum([
  'companies-house',
  'mot',
  'passport',
  'driving-license',
  'insurance-cert',
  'tax-filing',
  'contract-renewal',
  'other',
]);

export const DeadlineRecurrenceSchema = z.enum([
  'one-off',
  'annual',
  'every-5-years',
  'every-10-years',
]);

export const DeadlineSchema = z.object({
  id: DeadlineIdSchema,
  type: DeadlineTypeSchema,
  title: z.string().min(1),
  dueDate: IsoDateSchema,
  recurrence: DeadlineRecurrenceSchema,
  notes: z.string().nullable(),
  url: z.string().nullable(),
  completedDate: IsoDateSchema.nullable(),
  /** ISO timestamp; drives the ICS `SEQUENCE` so edits propagate to calendars. */
  updatedAt: z.string(),
});

export const DeadlineCreateBodySchema = z.object({
  id: DeadlineIdSchema.optional(),
  type: DeadlineTypeSchema,
  title: z.string().min(1),
  dueDate: IsoDateSchema,
  recurrence: DeadlineRecurrenceSchema,
  notes: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  completedDate: IsoDateSchema.nullable().optional(),
});

export const DeadlineUpdateBodySchema = DeadlineCreateBodySchema
  .omit({ id: true })
  .partial();

export const DeadlineCompleteBodySchema = z.object({
  completedDate: IsoDateSchema.optional(),
});

export const DeadlinesListResponseSchema = z.object({
  deadlines: z.array(DeadlineSchema),
});

export const DeadlineResponseSchema = z.object({ deadline: DeadlineSchema });

// ---- Unified deadline feed (obligations + deadlines) ----

export const UrgencyStatusSchema = z.enum(['overdue', 'due-soon', 'upcoming', 'completed']);

/**
 * Source tag: tells the UI (and any other consumer) whether the feed item
 * originated from the financial-obligations table or from the deadlines
 * CSV. Drives visual treatment (e.g. source badge colour) and click
 * behaviour (obligation rows deep-link to the Obligations tab).
 */
export const DeadlineFeedSourceSchema = z.enum(['obligation', 'deadline']);

export const DeadlineFeedItemSchema = z.object({
  id: z.string(),
  source: DeadlineFeedSourceSchema,
  title: z.string(),
  /** ISO date. All-day semantics — no time-of-day component. */
  dueDate: IsoDateSchema,
  /** Obligation type OR deadline type, depending on `source`. */
  type: z.string(),
  status: UrgencyStatusSchema,
  amount: z.number().nullable(),
  entity: z.string().nullable(),
  notes: z.string().nullable(),
  url: z.string().nullable(),
  /** ISO timestamp; drives the ICS `SEQUENCE`. */
  updatedAt: z.string(),
  /** Mirrors the `completed` input to urgency helpers so UIs don't re-derive it. */
  completed: z.boolean(),
});

export const DeadlineFeedResponseSchema = z.object({
  items: z.array(DeadlineFeedItemSchema),
});

// ============================================
// Company / Entity Registry (Roadmap 1.1)
// ============================================

/**
 * Canonical identifiers for the two legally-distinct entities this app
 * accounts for. The registry row (and every downstream FK on accounts,
 * contracts, invoices, obligations) uses these exact strings.
 */
export const EntityIdSchema = z.enum(['autonize-it-ltd', 'autonize-it-fzco']);
export type EntityId = z.infer<typeof EntityIdSchema>;

export const JurisdictionSchema = z.enum(['UK', 'UAE']);
export type Jurisdiction = z.infer<typeof JurisdictionSchema>;

export const EntityKindSchema = z.enum(['ltd', 'fzco', 'sole_trader', 'other']);
export type EntityKind = z.infer<typeof EntityKindSchema>;

/**
 * `TBC` is a first-class value in `autonize-it/company.csv` and is
 * preserved verbatim through every parse/serialize round-trip so the
 * Warnings Engine (1.8) can surface "this field is still unresolved"
 * items without the parser silently coercing it to `null`.
 */
export const TbcSchema = z.literal('TBC');
export type Tbc = z.infer<typeof TbcSchema>;

/** ISO yyyy-mm-dd, or the literal `TBC`. */
export const IsoDateOrTbcSchema = z.union([IsoDateSchema, TbcSchema]);

/** `true`, `false`, or the literal `TBC`. */
export const BooleanOrTbcSchema = z.union([z.boolean(), TbcSchema]);

/** Any non-empty string, or the literal `TBC`. Empty becomes `null` elsewhere. */
export const StringOrTbcSchema = z.union([z.string().min(1), TbcSchema]);

/**
 * Columns every company row carries regardless of jurisdiction.
 * Jurisdiction-specific identifiers live on the discriminated branches.
 */
const CompanyCommonFields = {
  id: EntityIdSchema,
  legal_name: z.string().min(1),
  trading_name: z.string().min(1),
  kind: EntityKindSchema,
  regulator: z.string().min(1),
  formation_date: IsoDateOrTbcSchema.nullable(),
  address: z.string().min(1),
  currency: CurrencyCodeSchema,
  email: z.string().min(1),
  logo_path: z.string().nullable(),
  accountant_name: StringOrTbcSchema.nullable(),
  accountant_email: StringOrTbcSchema.nullable(),
  /**
   * True iff the entity is VAT-registered in its own jurisdiction.
   * `TBC` allowed for entities whose registration status is still
   * pending accountant review.
   */
  vat_registered: BooleanOrTbcSchema,
  active: z.boolean(),
  /** ISO date the row was last touched. Allowed nullable for legacy rows. */
  updated_at: IsoDateSchema.nullable(),
} as const;

/**
 * UK-shaped company row. `company_number` + `vat_number` are required-
 * shaped fields (nullable only to cover pre-registration edge cases);
 * `license_number`, `registration_number`, `iban`, `swift_bic`, and
 * `qfzp_elected` are UAE-only and must be `null` on a UK row.
 */
export const UkCompanySchema = z.object({
  ...CompanyCommonFields,
  jurisdiction: z.literal('UK'),
  kind: z.literal('ltd'),
  company_number: z.string().min(1),
  vat_number: z.string().nullable(),
  license_number: z.null(),
  registration_number: z.null(),
  bank_sort_code: z.string().nullable(),
  bank_account_number: z.string().nullable(),
  iban: z.null(),
  swift_bic: z.null(),
  /**
   * UK CT registration is effectively automatic on company formation
   * (HMRC notifies the entity); we model it as a boolean for symmetry
   * with the UAE side, and allow `TBC` for documentation completeness.
   */
  ct_registered: BooleanOrTbcSchema,
  qfzp_elected: z.null(),
});
export type UkCompany = z.infer<typeof UkCompanySchema>;

/**
 * UAE-shaped (IFZA free-zone) company row. `license_number` +
 * `registration_number` are required; `iban` + `swift_bic` carry AED
 * bank details; `ct_registered` and `qfzp_elected` gate UAE CT
 * obligation emission — both must be explicit booleans before the CT
 * auto-seeder emits a single row.
 */
export const UaeCompanySchema = z.object({
  ...CompanyCommonFields,
  jurisdiction: z.literal('UAE'),
  kind: z.literal('fzco'),
  company_number: z.null(),
  vat_number: z.null(),
  license_number: z.string().min(1),
  registration_number: z.string().min(1),
  bank_sort_code: z.null(),
  bank_account_number: z.null(),
  iban: StringOrTbcSchema.nullable(),
  swift_bic: StringOrTbcSchema.nullable(),
  ct_registered: BooleanOrTbcSchema,
  qfzp_elected: BooleanOrTbcSchema.nullable(),
});
export type UaeCompany = z.infer<typeof UaeCompanySchema>;

/**
 * Discriminated union over `jurisdiction`. Downstream code that branches
 * on jurisdiction gets narrowed types for free (no casts, no asserts).
 */
export const CompanySchema = z.discriminatedUnion('jurisdiction', [
  UkCompanySchema,
  UaeCompanySchema,
]);
export type Company = z.infer<typeof CompanySchema>;

export const CompaniesListResponseSchema = z.object({
  companies: z.array(CompanySchema),
});
export type CompaniesListResponse = z.infer<typeof CompaniesListResponseSchema>;

// ============================================
// Clients, Master Agreements, Contracts (§1.2 Phase A)
// ============================================
//
// Three cooperating tables under `clients/`:
//
// - `clients.csv`         — who pays / who work happens for (direct | agency)
// - `master-agreements.csv` — the legal umbrella above SOWs (e.g. the DC
//                            contractor framework). Minimal columns only.
// - `contracts.csv`       — time-bounded engagement rows with commercial
//                            terms (`sow | single | extension`). `renewal`
//                            is positional — the 2nd+ row in a series for
//                            the same `(client_id, issuing_entity_id)` is
//                            the renewal; no dedicated `type`.

export const ClientIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export type ClientId = z.infer<typeof ClientIdSchema>;

export const ClientKindSchema = z.enum(['direct', 'agency']);
export type ClientKind = z.infer<typeof ClientKindSchema>;

/**
 * Template kinds — canonical list. `resolveTemplatePath()` uses this to
 * derive the template file path by convention: a per-client override
 * at `clients/templates/{client_id}/{kind}.hbs` if present, otherwise
 * the shared `clients/templates/{kind}.hbs`. Eliminates the per-client
 * template-path columns that appeared in the original §1.2 draft.
 */
export const TemplateKindSchema = z.enum([
  'leave',
  'sickness',
  'invoice-cover',
  'renewal',
  'timesheet',
]);
export type TemplateKind = z.infer<typeof TemplateKindSchema>;

/**
 * Columns every client row carries regardless of `kind`. Contact fields
 * at this level are the CLIENT-facing contacts — for agency-kind rows
 * these are the AGENCY's contacts; the end-client block below carries
 * the end-client's contacts.
 */
const ClientCommonFields = {
  id: ClientIdSchema,
  legal_name: z.string().min(1),
  trading_name: z.string().min(1),
  vat_number: StringOrTbcSchema.nullable(),
  billing_address: z.string().min(1),
  primary_contact_name: StringOrTbcSchema,
  primary_contact_email: StringOrTbcSchema,
  secondary_contact_name: StringOrTbcSchema.nullable(),
  secondary_contact_email: StringOrTbcSchema.nullable(),
  hr_contact_name: StringOrTbcSchema.nullable(),
  hr_contact_email: StringOrTbcSchema.nullable(),
  accounts_contact_name: StringOrTbcSchema.nullable(),
  accounts_contact_email: StringOrTbcSchema.nullable(),
  /** Comma-separated catch-all CC list; empty serialises to null. */
  cc_emails: z.string().nullable(),
  holiday_system_url: StringOrTbcSchema.nullable(),
  client_assigned_email: StringOrTbcSchema.nullable(),
  active: z.boolean(),
  updated_at: IsoDateSchema.nullable(),
} as const;

/**
 * Direct client — no agency in the middle. All `end_client_*` columns
 * must be `null` on a direct row.
 */
export const DirectClientSchema = z.object({
  ...ClientCommonFields,
  kind: z.literal('direct'),
  end_client_legal_name: z.null(),
  end_client_address: z.null(),
  end_client_primary_contact_name: z.null(),
  end_client_primary_contact_email: z.null(),
  end_client_secondary_contact_name: z.null(),
  end_client_secondary_contact_email: z.null(),
});
export type DirectClient = z.infer<typeof DirectClientSchema>;

/**
 * Agency client — the payer (and self-bill issuer) is an agency; the
 * actual end client (where the work is delivered) is captured in the
 * end-client block. `end_client_legal_name` + `_address` are required;
 * end-client contacts may start as TBC pending the user filling them in
 * after ship (Warnings Engine flags unresolved recipients).
 */
export const AgencyClientSchema = z.object({
  ...ClientCommonFields,
  kind: z.literal('agency'),
  end_client_legal_name: z.string().min(1),
  end_client_address: z.string().min(1),
  end_client_primary_contact_name: StringOrTbcSchema,
  end_client_primary_contact_email: StringOrTbcSchema,
  end_client_secondary_contact_name: StringOrTbcSchema.nullable(),
  end_client_secondary_contact_email: StringOrTbcSchema.nullable(),
});
export type AgencyClient = z.infer<typeof AgencyClientSchema>;

/**
 * Discriminated union over `kind`. Downstream code that branches on
 * client kind gets narrowed types for free.
 */
export const ClientSchema = z.discriminatedUnion('kind', [
  DirectClientSchema,
  AgencyClientSchema,
]);
export type Client = z.infer<typeof ClientSchema>;

export const ClientsListResponseSchema = z.object({
  clients: z.array(ClientSchema),
});
export type ClientsListResponse = z.infer<typeof ClientsListResponseSchema>;

/**
 * Update-patch schemas for `PUT /api/clients/:id`.
 *
 * Identity columns (`id`, `updated_at`) are server-managed and not
 * patchable — `id` is the URL parameter and `updated_at` is stamped on
 * write. Every other column is optional; callers send only the fields
 * that changed.
 *
 * `kind` stays required (and literal) so the discriminated union lines
 * up with `ClientSchema`. Flipping `direct` ↔ `agency` is out of scope:
 * it would invalidate every contract + template override pinned to the
 * row, so the route rejects a kind mismatch explicitly rather than
 * silently rewriting the discriminator.
 *
 * For `DirectClientUpdateSchema`, the `end_client_*` fields remain
 * `z.null()` (matching `DirectClientSchema`) — an update that tries to
 * set them is a kind-flip in disguise and fails validation here.
 */
export const DirectClientUpdateSchema = DirectClientSchema
  .omit({ id: true, updated_at: true })
  .partial()
  .extend({ kind: z.literal('direct') });
export type DirectClientUpdate = z.infer<typeof DirectClientUpdateSchema>;

export const AgencyClientUpdateSchema = AgencyClientSchema
  .omit({ id: true, updated_at: true })
  .partial()
  .extend({ kind: z.literal('agency') });
export type AgencyClientUpdate = z.infer<typeof AgencyClientUpdateSchema>;

export const ClientUpdateSchema = z.discriminatedUnion('kind', [
  DirectClientUpdateSchema,
  AgencyClientUpdateSchema,
]);
export type ClientUpdate = z.infer<typeof ClientUpdateSchema>;

export const ClientUpdateResponseSchema = z.object({
  client: ClientSchema,
});
export type ClientUpdateResponse = z.infer<typeof ClientUpdateResponseSchema>;

/**
 * Master-agreement id — slug shape identical to other registry ids so
 * they survive URL paths and filenames.
 */
export const MasterAgreementIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export type MasterAgreementId = z.infer<typeof MasterAgreementIdSchema>;

/**
 * Legal umbrella above individual SOWs. Intentionally minimal — no
 * commercial terms, no working-pattern columns, no invoice cadence.
 * Those live on the contract rows that reference this master by FK.
 */
export const MasterAgreementSchema = z.object({
  id: MasterAgreementIdSchema,
  client_id: ClientIdSchema,
  reference: z.string().min(1),
  start_date: IsoDateSchema,
  /** `null` = open-ended (master stays in force until terminated). */
  end_date: IsoDateSchema.nullable(),
  company_notice_weeks: z.number().int().nonnegative(),
  supplier_notice_weeks: z.number().int().nonnegative(),
  /** Governing law as free text (e.g. `England`, `Dubai`). */
  jurisdiction: z.string().min(1),
  signed_at: IsoDateSchema,
  docusign_envelope: z.string().nullable(),
  active: z.boolean(),
  updated_at: IsoDateSchema.nullable(),
});
export type MasterAgreement = z.infer<typeof MasterAgreementSchema>;

export const ContractIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export type ContractId = z.infer<typeof ContractIdSchema>;

export const InvoiceCadenceSchema = z.enum(['weekly', 'monthly']);
export type InvoiceCadence = z.infer<typeof InvoiceCadenceSchema>;

export const InvoiceMechanismSchema = z.enum(['supplier-issued', 'self-bill']);
export type InvoiceMechanism = z.infer<typeof InvoiceMechanismSchema>;

export const ConductRegsSchema = z.enum(['opted-in', 'opted-out']);
export type ConductRegs = z.infer<typeof ConductRegsSchema>;

export const EngagementTaxStatusSchema = z.enum([
  'outside-ir35',
  'inside-ir35',
]);
export type EngagementTaxStatus = z.infer<typeof EngagementTaxStatusSchema>;

/**
 * Engagement row with full commercial terms. Joins to `clients` via
 * `client_id`, to `company` via `issuing_entity_id`, and optionally to
 * `master-agreements` via `master_id` (nullable — agency engagements
 * like La Fosse typically have no master above them).
 *
 * There is deliberately no `type` column. "Is this under a master?" is
 * answered by `master_id !== null`; "is this a renewal / extension of
 * a prior engagement?" is positional (look up prior rows in the
 * `byClientAndEntity` index). Earlier drafts had a
 * `sow | single | extension` enum, but each value was either redundant
 * with `master_id` or derivable from positional ordering — an SOW
 * issued to follow a prior SOW is also an extension, so the partition
 * wasn't clean.
 *
 * `conduct_regs` + `engagement_tax_status` are nullable rather than
 * carrying magic `n-a` enum values — they apply to UK engagements only
 * and must be `null` on non-UK rows (enforced as a registry invariant,
 * not at the Zod level, to keep this schema orthogonal to jurisdiction).
 */
export const ContractSchema = z.object({
  id: ContractIdSchema,
  client_id: ClientIdSchema,
  issuing_entity_id: EntityIdSchema,
  master_id: MasterAgreementIdSchema.nullable(),
  /** Human reference from the paperwork (e.g. `DMORRISON02`). */
  reference: z.string().min(1),
  start_date: IsoDateSchema,
  end_date: IsoDateSchema.nullable(),
  works_monday: z.boolean(),
  works_tuesday: z.boolean(),
  works_wednesday: z.boolean(),
  works_thursday: z.boolean(),
  works_friday: z.boolean(),
  works_saturday: z.boolean(),
  works_sunday: z.boolean(),
  day_rate: z.number().nonnegative(),
  day_rate_currency: CurrencyCodeSchema,
  invoice_currency: CurrencyCodeSchema,
  invoice_cadence: InvoiceCadenceSchema,
  invoice_mechanism: InvoiceMechanismSchema,
  payment_terms_days: z.number().int().nonnegative(),
  company_notice_weeks: z.number().int().nonnegative(),
  supplier_notice_weeks: z.number().int().nonnegative(),
  renewal_warning_days: z.number().int().nonnegative(),
  job_title: z.string().min(1),
  job_description: z.string().nullable(),
  work_location: z.string().min(1),
  conduct_regs: ConductRegsSchema.nullable(),
  engagement_tax_status: EngagementTaxStatusSchema.nullable(),
  /** Governing law as free text (e.g. `England`). */
  jurisdiction: z.string().min(1),
  signed_at: IsoDateSchema,
  docusign_envelope: z.string().nullable(),
  active: z.boolean(),
  updated_at: IsoDateSchema.nullable(),
});
export type Contract = z.infer<typeof ContractSchema>;

export const ContractsListResponseSchema = z.object({
  contracts: z.array(ContractSchema),
});
export type ContractsListResponse = z.infer<typeof ContractsListResponseSchema>;

export const MasterAgreementsListResponseSchema = z.object({
  masterAgreements: z.array(MasterAgreementSchema),
});
export type MasterAgreementsListResponse = z.infer<typeof MasterAgreementsListResponseSchema>;

// ============================================
// Leave registry + Contracts tab (§1.2.E)
// ============================================
//
// A LeaveRow is a single calendar day of non-working time against one
// contract. Intentionally minimal: the outside-IR35 contractor doesn't
// invoice for leave, so there's no `paid` flag or `unpaid` subclass —
// every leave day is effectively unpaid by construction (no work → no
// line item). `type` is a personal-records-only classification (holiday
// vs sick) so the contractor can tally their own days; it does NOT feed
// back into the client-facing template body (see §1.2.B — the leave
// email says "I'll be out on these dates" regardless of reason).
//
// Calendar events that everybody is off for (public holidays, firm-wide
// closures) are NOT leave rows — they live in a separate
// `working-days/public-holidays.csv` that feeds `excludeDates` on the
// working-days iterator, keeping this registry focused on the
// contractor's own choices.

/** Slug: lowercase letters, digits, hyphens; must start with a letter or digit. */
export const LeaveIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export type LeaveId = z.infer<typeof LeaveIdSchema>;

export const LeaveTypeSchema = z.enum(['holiday', 'sick']);
export type LeaveType = z.infer<typeof LeaveTypeSchema>;

export const LeaveRowSchema = z.object({
  id: LeaveIdSchema,
  contract_id: ContractIdSchema,
  date: IsoDateSchema,
  type: LeaveTypeSchema,
  notes: z.string().nullable(),
  /**
   * True iff the leave has also been logged in the agency/end-client
   * HR system (e.g. La Fosse's holiday portal). Purely informational —
   * surfaces a tick in the leave log so the contractor can see which
   * entries still need double-booking into the client-side system.
   */
  external_logged: z.boolean(),
  created_at: IsoDateSchema,
  updated_at: IsoDateSchema,
});
export type LeaveRow = z.infer<typeof LeaveRowSchema>;

export const LeaveListResponseSchema = z.object({
  leave: z.array(LeaveRowSchema),
});
export type LeaveListResponse = z.infer<typeof LeaveListResponseSchema>;

/**
 * Body of `POST /api/contracts/:id/leave`. A single request books one
 * or more days of the same type against one contract; booking the same
 * range across multiple contracts is the frontend's job (it issues one
 * POST per selected contract and parallelises with `Promise.all`).
 */
export const LeaveRequestSchema = z.object({
  dates: z.array(IsoDateSchema).min(1),
  type: LeaveTypeSchema,
  notes: z.string().nullable().optional(),
  external_logged: z.boolean().optional(),
});
export type LeaveRequest = z.infer<typeof LeaveRequestSchema>;

export const LeaveCreateResponseSchema = z.object({
  leave: z.array(LeaveRowSchema),
  created: z.number().int().nonnegative(),
});
export type LeaveCreateResponse = z.infer<typeof LeaveCreateResponseSchema>;

/**
 * Body of `POST /api/contracts/:id/leave-preview`. Same shape as
 * {@link LeaveRequestSchema} minus `external_logged` (the preview never
 * writes); returns the rendered template that *would* be sent if the
 * caller then POSTed to `/leave`.
 */
export const TemplatePreviewRequestSchema = z.object({
  dates: z.array(IsoDateSchema).min(1),
  type: LeaveTypeSchema,
  notes: z.string().nullable().optional(),
});
export type TemplatePreviewRequest = z.infer<typeof TemplatePreviewRequestSchema>;

export const TemplatePreviewResponseSchema = z.object({
  subject: z.string(),
  body: z.string(),
  recipients: z.object({
    to: z.array(z.string()),
    cc: z.array(z.string()),
  }),
});
export type TemplatePreviewResponse = z.infer<typeof TemplatePreviewResponseSchema>;

/**
 * Per-contract income-accrual snapshot. Pure composition over the
 * contract row + its leave rows + `today`: no invoice or transaction
 * data — this is "what will the invoice say if the period ended now?".
 * See `server/domain/contracts/income-accrual.ts` for the algorithm.
 *
 * `period_start..period_end` is the Monday-Sunday week for weekly
 * cadence or the calendar month for monthly cadence, clipped to the
 * contract's `[start_date, end_date]`.
 */
/**
 * Per-contract accrual snapshot.
 *
 * Two windows live on this row because they answer different
 * questions:
 *
 *   - `owed_window_start` .. today (inclusive) is the **owed** window.
 *     It starts the day after the most recent matched invoice payment,
 *     falling back to the first of the current calendar month when no
 *     payment has been matched. `worked_days_to_date`,
 *     `accrued_to_date`, and `leave_days_in_period` are all counted
 *     across this window. This is the figure the tile surfaces as
 *     "worked / leave / accrued since last payment" and it is the
 *     user's mental model for "how much money is coming my way?".
 *
 *   - `period_start` .. `period_end` is the **projection** window —
 *     always the calendar month containing today, clipped to the
 *     contract's own `[start_date, end_date]`. `worked_days_remaining`
 *     and `projected_period_total` are computed across this window,
 *     independently of the owed window. The Retained / VAT / CT
 *     aggregate banner reads `projected_period_total` and therefore
 *     keeps its calendar-month semantics.
 *
 * `projected_period_total` is NOT `accrued + remaining` any more; the
 * two windows can straddle multiple months (e.g. the FZCO case where
 * an invoice has been issued but not yet paid) so summing them would
 * silently double-count.
 */
export const AccrualResponseSchema = z.object({
  contract_id: ContractIdSchema,
  period_start: IsoDateSchema,
  period_end: IsoDateSchema,
  owed_window_start: IsoDateSchema,
  owed_window_end: IsoDateSchema,
  worked_days_to_date: z.number().int().nonnegative(),
  accrued_to_date: z.number().nonnegative(),
  worked_days_remaining: z.number().int().nonnegative(),
  projected_period_total: z.number().nonnegative(),
  leave_days_in_period: z.number().int().nonnegative(),
  day_rate: z.number().nonnegative(),
  currency: CurrencyCodeSchema,
});
export type AccrualResponse = z.infer<typeof AccrualResponseSchema>;

/**
 * Aggregate accrual for the Contracts tab banner: one row per active
 * contract plus per-issuing-entity rollups so the UI can show "£X
 * projected across UK Ltd, £Y projected across UAE FZCO" without
 * re-deriving it from the per-contract rows.
 */
export const AggregateAccrualEntityRollupSchema = z.object({
  issuing_entity_id: EntityIdSchema,
  currency: CurrencyCodeSchema,
  accrued_to_date: z.number().nonnegative(),
  projected_period_total: z.number().nonnegative(),
  contract_count: z.number().int().nonnegative(),
  /**
   * Retained-after-claims figures derived from {@link calculateRetainedReserves}
   * — always reconcile as
   * `incoming_period_total === retained_period + vat_reserve_period + ct_reserve_period`.
   */
  incoming_period_total: z.number().nonnegative(),
  vat_reserve_period: z.number().nonnegative(),
  ct_reserve_period: z.number().nonnegative(),
  retained_period: z.number().nonnegative(),
});
export type AggregateAccrualEntityRollup = z.infer<
  typeof AggregateAccrualEntityRollupSchema
>;

/**
 * Cross-entity monthly totals for the Contracts tab hero tile — the
 * "how much am I actually keeping this month, across everything" view.
 *
 * Populated only when every per-entity rollup shares the same currency
 * (true today: La Fosse pays the FZCO in GBP under self-bill). When
 * currencies diverge — e.g. a future AED-invoiced contract — this
 * field is set to `null` because a meaningful single-currency sum
 * requires FX conversion, which is deferred to Roadmap 3.2.
 *
 * Reconciles by definition:
 * `incoming_period_total === retained_period + vat_reserve_period + ct_reserve_period`
 * and each field is the straight sum of the per-entity field it mirrors.
 */
export const AggregateAccrualTotalsSchema = z.object({
  currency: CurrencyCodeSchema,
  contract_count: z.number().int().nonnegative(),
  entity_count: z.number().int().nonnegative(),
  accrued_to_date: z.number().nonnegative(),
  projected_period_total: z.number().nonnegative(),
  incoming_period_total: z.number().nonnegative(),
  vat_reserve_period: z.number().nonnegative(),
  ct_reserve_period: z.number().nonnegative(),
  retained_period: z.number().nonnegative(),
});
export type AggregateAccrualTotals = z.infer<typeof AggregateAccrualTotalsSchema>;

export const AggregateAccrualResponseSchema = z.object({
  today: IsoDateSchema,
  contracts: z.array(AccrualResponseSchema),
  entities: z.array(AggregateAccrualEntityRollupSchema),
  totals: AggregateAccrualTotalsSchema.nullable(),
});
export type AggregateAccrualResponse = z.infer<typeof AggregateAccrualResponseSchema>;

// ============================================
// Invoices — Roadmap 1.3 (§1.3 Phase 1: domain registry only)
// ============================================
//
// The invoice domain is the second supplier-issued / self-bill path on
// top of the contracts spine. Phase 1 ships the registry + read-only
// list + seed fixtures; PDF generation (Phase 2), self-bill parsing
// (Phase 3), and payment reconciliation (Phase 4) land later.
//
// Column set mirrors `invoices/invoices.csv` verbatim — see
// ROADMAP.md §1.3.

/**
 * Invoice primary key. FZCO self-bills use `FZ-####`. Delta Capita
 * supplier invoices use the client series `DC-###` (same value as
 * `invoice_number`). Other UK Ltd clients may still use `UK-####`.
 */
export const InvoiceIdSchema = z
  .string()
  .regex(/^(?:(?:UK|FZ)-\d{4}|DC-\d{3})$/);
export type InvoiceId = z.infer<typeof InvoiceIdSchema>;

/**
 * Invoice lifecycle. `overdue` is intentionally NOT a stored status —
 * it is derived as `due_date < today AND status !== 'paid'` at read
 * time so a single source of truth (`due_date`) drives the flag.
 */
export const InvoiceStatusSchema = z.enum(['draft', 'issued', 'paid', 'partial']);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

/**
 * Reference to a rendered / received PDF relative to the `invoices/`
 * directory. `null` for historical rows seeded before we had a PDF
 * pipeline (including the 10 DC seed fixtures in Phase 1).
 */
export const InvoicePdfPathSchema = z.string().min(1).nullable();

export const InvoiceSchema = z.object({
  id: InvoiceIdSchema,
  contract_id: ContractIdSchema,
  client_id: ClientIdSchema,
  issuing_entity_id: EntityIdSchema,
  /**
   * Printed invoice number. For Delta Capita supplier invoices this
   * matches `id` (`DC-###`). FZCO rows typically use `FZ-####` to match
   * `id`. Self-bills may still round-trip the supplier’s series here.
   */
  invoice_number: z.string().min(1),
  /**
   * Reference the client cites on their deposit. For supplier-issued
   * invoices this is kept identical to `invoice_number` (writes align
   * them). Self-bills may still use the agency’s supplier ref here
   * (e.g. `SB-…`) for duplicate detection while `invoice_number` is
   * the internal series.
   */
  payment_reference: z.string().min(1),
  invoice_date: IsoDateSchema,
  period_start: IsoDateSchema,
  period_end: IsoDateSchema,
  days_billed: z.number().nonnegative(),
  /** Free-text narrative rendered on the PDF's Item cell. */
  description: z.string().min(1),
  /** Invoice-denominated currency (NOT necessarily deposit currency). */
  currency: CurrencyCodeSchema,
  subtotal: z.number().nonnegative(),
  vat_rate: z.number().nonnegative(),
  vat_amount: z.number().nonnegative(),
  total: z.number().nonnegative(),
  /** GBP/AED or other cross-pair captured at issue. `null` when same currency. */
  fx_rate_at_issue: z.number().positive().nullable(),
  /** Typically `GBP`. `null` when same currency. */
  fx_base_currency: CurrencyCodeSchema.nullable(),
  mechanism: InvoiceMechanismSchema,
  pdf_path: InvoicePdfPathSchema,
  status: InvoiceStatusSchema,
  due_date: IsoDateSchema,
  created_at: IsoDateSchema,
  updated_at: IsoDateSchema.nullable(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

/**
 * Settled payment row against an invoice. Phase 1 seeds the schema
 * + header-only CSV; Phase 4's reconciler is the first writer.
 */
export const InvoicePaymentIdSchema = z.string().min(1);
export type InvoicePaymentId = z.infer<typeof InvoicePaymentIdSchema>;

export const InvoicePaymentSchema = z.object({
  id: InvoicePaymentIdSchema,
  invoice_id: InvoiceIdSchema,
  /** FK to `transactions.id` in the bank-side ledger. */
  bank_transaction_id: z.string().min(1),
  payment_date: IsoDateSchema,
  /** In `deposit_currency` (may differ from `invoice.currency`). */
  amount_paid: z.number().nonnegative(),
  deposit_currency: CurrencyCodeSchema,
  fx_rate_at_payment: z.number().positive().nullable(),
  /** `amount_paid` converted back into `invoice.currency` for matching. */
  amount_in_invoice_currency: z.number().nonnegative(),
  /** Realised FX gain / loss between issue and payment. */
  fx_gain_loss: z.number(),
  /** `invoice.total - Σ(payments in invoice currency)`. */
  residual: z.number(),
  created_at: IsoDateSchema,
  updated_at: IsoDateSchema.nullable(),
});
export type InvoicePayment = z.infer<typeof InvoicePaymentSchema>;

/** Response shape of `GET /api/invoices`. */
export const InvoicesListResponseSchema = z.object({
  invoices: z.array(InvoiceSchema),
});
export type InvoicesListResponse = z.infer<typeof InvoicesListResponseSchema>;

// ============================================
// Warnings — Phase 7 / Roadmap 1.1 Entity Foundation slice
// ============================================
// These schemas are the minimal subset of the Warnings Engine (Roadmap
// 1.8) that Roadmap 1.1 needs to pay for itself: they surface the
// unresolved `TBC` fields, FZCO tax-registration blockers, UAE VAT
// threshold crossings, and unclassified inter-company movements that
// the Phase 1–6 work has now made detectable. The envelope shape
// (`id / code / severity / title / detail / recommended_action /
// sources`) is deliberately aligned with the full 1.8 spec so the
// future Warnings tab can consume this route verbatim without a
// schema migration.

export const WarningSeveritySchema = z.enum(['info', 'warn', 'critical']);
export type WarningSeverity = z.infer<typeof WarningSeveritySchema>;

export const EntityFoundationWarningCodeSchema = z.enum([
  'company-tbc-fields',
  'client-tbc-fields',
  'contract-ending-soon',
  'fzco-ct-status-unknown',
  'fzco-vat-voluntary-threshold-crossed',
  'fzco-vat-mandatory-threshold-crossed',
  'ifza-license-renewal-due',
  'inter-company-movement-unclassified',
  'payment-outside-contract-window',
]);
export type EntityFoundationWarningCode = z.infer<typeof EntityFoundationWarningCodeSchema>;

export const EntityFoundationWarningSchema = z.object({
  id: z.string().min(1),
  code: EntityFoundationWarningCodeSchema,
  severity: WarningSeveritySchema,
  title: z.string().min(1),
  detail: z.string().min(1),
  recommended_action: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
});
export type EntityFoundationWarning = z.infer<typeof EntityFoundationWarningSchema>;

export const EntityFoundationWarningsResponseSchema = z.object({
  warnings: z.array(EntityFoundationWarningSchema),
});
export type EntityFoundationWarningsResponse = z.infer<typeof EntityFoundationWarningsResponseSchema>;

// ============================================
// Transaction category overrides
// (Roadmap 1.1 Phase 8)
// ============================================
// Manual per-transaction category assignments, keyed by transaction
// hash. When present, these take precedence over the description-
// based pattern lookup in `server/utils/categorizer.ts`.
//
// The primary driver is inter-company classification (see
// `INTER_COMPANY_CATEGORIES`) — the user classifies a detected UK
// Ltd ↔ UAE FZCO pair via the Warnings tab and both hashes get an
// override row. The CSV is general-purpose, though: any future
// "recategorise this specific transaction" use case can write here.

export const TransactionCategoryOverrideRowSchema = z.object({
  hash: z.string().min(1),
  category: CategoryNameSchema,
  notes: z.string().nullable(),
  classified_at: IsoDateSchema,
});
export type TransactionCategoryOverrideRow = z.infer<
  typeof TransactionCategoryOverrideRowSchema
>;

// ============================================
// Inter-company movement pairs (response DTOs)
// ============================================

export const InterCompanyMovementTransactionSchema = z.object({
  hash: z.string().min(1),
  date: IsoDateSchema,
  account: z.string().min(1),
  amount: z.number(),
  description: z.string(),
  entityId: EntityIdSchema.nullable(),
});
export type InterCompanyMovementTransaction = z.infer<
  typeof InterCompanyMovementTransactionSchema
>;

export const InterCompanyMovementPairSchema = z.object({
  expense: InterCompanyMovementTransactionSchema,
  income: InterCompanyMovementTransactionSchema,
  /**
   * Resolved classification for the pair — non-null when at least
   * one side of the pair has an override row whose category is in
   * {@link INTER_COMPANY_CATEGORIES}. The expense side takes
   * precedence when both are classified.
   */
  classification: CategoryNameSchema.nullable(),
});
export type InterCompanyMovementPair = z.infer<typeof InterCompanyMovementPairSchema>;

export const InterCompanyMovementsResponseSchema = z.object({
  pairs: z.array(InterCompanyMovementPairSchema),
  classified: z.number().int().min(0),
  unclassified: z.number().int().min(0),
  total: z.number().int().min(0),
});
export type InterCompanyMovementsResponse = z.infer<
  typeof InterCompanyMovementsResponseSchema
>;

export const InterCompanyClassifyRequestSchema = z.object({
  expenseHash: z.string().min(1),
  incomeHash: z.string().min(1),
  /**
   * Null clears any existing classification for the pair (removes
   * both override rows). A non-null value must be in
   * `INTER_COMPANY_CATEGORIES` — general-purpose categories are
   * rejected at this endpoint even though the underlying CSV can
   * store them.
   */
  category: CategoryNameSchema.nullable(),
  notes: z.string().max(500).nullable().optional(),
});
export type InterCompanyClassifyRequest = z.infer<typeof InterCompanyClassifyRequestSchema>;

// ============================================
// Inferred TypeScript Types
// ============================================

export type TransactionType = z.infer<typeof TransactionTypeSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type AccountType = z.infer<typeof AccountTypeSchema>;
export type AccountCategory = z.infer<typeof AccountCategorySchema>;
/** @deprecated Use AccountCategory instead */
export type AccountOwnership = AccountCategory;
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
export type CategoryBreakdown = z.infer<typeof CategoryBreakdownSchema>;
export type CategoriesResponse = z.infer<typeof CategoriesResponseSchema>;
export type BudgetMonthComparison = z.infer<typeof BudgetMonthComparisonSchema>;
export type BudgetComparison = z.infer<typeof BudgetComparisonSchema>;
export type YearlyBudgetComparison = z.infer<typeof YearlyBudgetComparisonSchema>;
export type BudgetRow = z.infer<typeof BudgetRowSchema>;
export type BudgetsListResponse = z.infer<typeof BudgetsListResponseSchema>;
export type BudgetUpsertBody = z.infer<typeof BudgetUpsertBodySchema>;
export type BudgetCategoryNamesResponse = z.infer<typeof BudgetCategoryNamesResponseSchema>;
export type BudgetNudge = z.infer<typeof BudgetNudgeSchema>;
export type ExpensesVariancePoint = z.infer<typeof ExpensesVariancePointSchema>;
export type ExpensesLineItem = z.infer<typeof ExpensesLineItemSchema>;
export type ExpensesSection = z.infer<typeof ExpensesSectionSchema>;
export type ExpensesIncomeSplit = z.infer<typeof ExpensesIncomeSplitSchema>;
export type ExpensesInsight = z.infer<typeof ExpensesInsightSchema>;
export type ExpensesSheetResponse = z.infer<typeof ExpensesSheetResponseSchema>;
export type SimulationExclusionsResponse = z.infer<typeof SimulationExclusionsResponseSchema>;
export type AdHocExpenseItem = z.infer<typeof AdHocExpenseItemSchema>;
export type AdHocExpensesResponse = z.infer<typeof AdHocExpensesResponseSchema>;
export type AdHocMerchantSeriesPoint = z.infer<typeof AdHocMerchantSeriesPointSchema>;
export type AdHocMerchantSeriesResponse = z.infer<typeof AdHocMerchantSeriesResponseSchema>;
export type RecurringFrequency = z.infer<typeof RecurringFrequencySchema>;
export type RecurringExpense = z.infer<typeof RecurringExpenseSchema>;
export type RecurringExpensesResponse = z.infer<typeof RecurringExpensesResponseSchema>;

// API Response Types
export type DashboardSummaryResponse = z.infer<typeof DashboardSummaryResponseSchema>;
export type AccountConfigsResponse = z.infer<typeof AccountConfigsResponseSchema>;
export type TransactionsResponse = z.infer<typeof TransactionsResponseSchema>;
export type AccountBalanceResponse = z.infer<typeof AccountBalanceResponseSchema>;
export type HmrcPaymentMatch = z.infer<typeof HmrcPaymentMatchSchema>;
export type VATPaymentsResponse = z.infer<typeof VATPaymentsResponseSchema>;
export type StatementsResponse = z.infer<typeof StatementsResponseSchema>;
export type StatementYearsResponse = z.infer<typeof StatementYearsResponseSchema>;
export type CheckQuarterResponse = z.infer<typeof CheckQuarterResponseSchema>;
export type StatementAccountsResponse = z.infer<typeof StatementAccountsResponseSchema>;
export type AccountStatementResponse = z.infer<typeof AccountStatementResponseSchema>;
export type StatementInvoiceUploadsListResponse = z.infer<typeof StatementInvoiceUploadsListResponseSchema>;
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

// API Request Body Types
export type SetBalanceRequest = z.infer<typeof SetBalanceRequestSchema>;
export type DownloadSelectedRequest = z.infer<typeof DownloadSelectedRequestSchema>;

// Obligations Types
export type ObligationSource = z.infer<typeof ObligationSourceSchema>;
export type ObligationType = z.infer<typeof ObligationTypeSchema>;
export type PersonId = z.infer<typeof PersonIdSchema>;
export type ObligationFrequency = z.infer<typeof ObligationFrequencySchema>;
export type ObligationStatus = z.infer<typeof ObligationStatusSchema>;
export type ObligationRow = z.infer<typeof ObligationRowSchema>;
export type ObligationsListResponse = z.infer<typeof ObligationsListResponseSchema>;
export type VatQuarterReconciliation = z.infer<typeof VatQuarterReconciliationSchema>;
export type VatReconciliationResponse = z.infer<typeof VatReconciliationResponseSchema>;
export type UpcomingObligationsResponse = z.infer<typeof UpcomingObligationsResponseSchema>;
export type OverdueObligationsResponse = z.infer<typeof OverdueObligationsResponseSchema>;
export type UpcomingRecurring = z.infer<typeof UpcomingRecurringSchema>;
export type UpcomingPaymentItem = z.infer<typeof UpcomingPaymentItemSchema>;
export type UpcomingPaymentsResponse = z.infer<typeof UpcomingPaymentsResponseSchema>;
export type CreateObligationBody = z.infer<typeof CreateObligationBodySchema>;
export type UpdateObligationBody = z.infer<typeof UpdateObligationBodySchema>;
export type ObligationStateUpsertBody = z.infer<typeof ObligationStateUpsertBodySchema>;
export type Dismissal = z.infer<typeof DismissalSchema>;
export type CreateDismissalBody = z.infer<typeof CreateDismissalBodySchema>;
export type DismissalsListResponse = z.infer<typeof DismissalsListResponseSchema>;

// Obligation registry (declared source-of-truth) types
// Note: `Frequency` itself is exported alongside {@link FrequencySchema} near
// the top of this file (it's the canonical recurrence type).
export type IncomingObligation = z.infer<typeof IncomingObligationSchema>;
export type OutgoingObligation = z.infer<typeof OutgoingObligationSchema>;
export type Obligation = IncomingObligation | OutgoingObligation;
export type IncomingObligationCategory = IncomingObligation['category'];
export type OutgoingObligationCategory = OutgoingObligation['category'];
export type ObligationCategory = IncomingObligationCategory | OutgoingObligationCategory;

// Debts Types
export type DebtKind = z.infer<typeof DebtKindSchema>;
export type RepaymentType = z.infer<typeof RepaymentTypeSchema>;
export type DebtId = z.infer<typeof DebtIdSchema>;
export type Debt = z.infer<typeof DebtSchema>;
export type DebtSummary = z.infer<typeof DebtSummarySchema>;
export type DebtSummariesResponse = z.infer<typeof DebtSummariesResponseSchema>;
export type DebtCreateBody = z.infer<typeof DebtCreateBodySchema>;
export type DebtUpdateBody = z.infer<typeof DebtUpdateBodySchema>;
export type DebtOpeningBalanceBody = z.infer<typeof DebtOpeningBalanceBodySchema>;
export type DebtResponse = z.infer<typeof DebtResponseSchema>;

// Deadlines Types
export type DeadlineId = z.infer<typeof DeadlineIdSchema>;
export type DeadlineType = z.infer<typeof DeadlineTypeSchema>;
export type DeadlineRecurrence = z.infer<typeof DeadlineRecurrenceSchema>;
export type Deadline = z.infer<typeof DeadlineSchema>;
export type DeadlineCreateBody = z.infer<typeof DeadlineCreateBodySchema>;
export type DeadlineUpdateBody = z.infer<typeof DeadlineUpdateBodySchema>;
export type DeadlineCompleteBody = z.infer<typeof DeadlineCompleteBodySchema>;
export type DeadlinesListResponse = z.infer<typeof DeadlinesListResponseSchema>;
export type DeadlineResponse = z.infer<typeof DeadlineResponseSchema>;

// Deadline Feed Types
export type UrgencyStatus = z.infer<typeof UrgencyStatusSchema>;
export type DeadlineFeedSource = z.infer<typeof DeadlineFeedSourceSchema>;
export type DeadlineFeedItem = z.infer<typeof DeadlineFeedItemSchema>;
export type DeadlineFeedResponse = z.infer<typeof DeadlineFeedResponseSchema>;

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
