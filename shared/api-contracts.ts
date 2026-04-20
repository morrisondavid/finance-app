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
  'natwest',
  'natwest-savings',
  'monzo-joint',
  'emirates-islamic'
]);

export const CurrencyCodeSchema = z.enum(['GBP', 'AED']);
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

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
  frequency: z.enum(['monthly', 'annual']),
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
export const RecurringFrequencySchema = z.enum(['monthly', 'annual']);

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
   * Back-reference to the declared-commitment row that produced this entry,
   * when the recurring expense was driven by the commitments registry
   * (either by relaxing the detector with declared evidence, or by being
   * synthesised whole from a zero-transaction declaration). Downstream
   * surfaces that also read the commitments registry (e.g. the Obligations
   * tab) use this id to dedupe against their own projection of the same
   * commitment.
   */
  declaredCommitmentId: z.string().optional(),
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
// Obligations Schemas
// ============================================

export const ObligationSourceSchema = z.enum(['manual', 'auto']);
export const ObligationTypeSchema = z.enum([
  'vat', 'corporation-tax', 'self-assessment', 'hmrc-ttp', 'loan', 'subscription', 'insurance', 'other'
]);
export const ObligationRecurrenceSchema = z.enum(['quarterly', 'annual', 'monthly', 'one-off']);
export const ObligationStatusSchema = z.enum(['pending', 'paid', 'overdue', 'confirmed', 'not-yet-due', 'unpaid', 'insufficient-data']);

/**
 * Person identifier — matches the literal union type derived from
 * `server/config/people.ts`. Kept as a string enum here so the shared
 * package stays free of server-only imports; runtime validation defers
 * to {@link server/config/people.ts#isPersonId} where it matters.
 */
export const PersonIdSchema = z.enum(['david', 'heena']);

export const ObligationSchema = z.object({
  id: z.string(),
  source: ObligationSourceSchema,
  type: ObligationTypeSchema,
  name: z.string(),
  entity: z.string(),
  recurrence: ObligationRecurrenceSchema,
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
  obligations: z.array(ObligationSchema),
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
  obligations: z.array(ObligationSchema),
});

export const OverdueObligationsResponseSchema = z.object({
  obligations: z.array(ObligationSchema),
});

// ============================================
// Declared Commitments (canonical)
// ============================================
//
// A `DeclaredCommitment` is any user-declared recurring financial item,
// regardless of which UI surface it ultimately lands on. This replaces the
// four parallel sources that existed historically (FIXED_BILL_OVERRIDES,
// RENTAL_PROPERTIES, PAYROLL_ENTRIES, manual-obligations.csv). See
// docs/adr/0001-declared-commitments.md for the full decision record.
//
// Direction is split at the schema level — income and outgoings are
// different kinds of thing, so functions that operate on one direction
// can't be called with the other.

export const CadenceSchema = z.enum(['monthly', 'quarterly', 'annual', 'one-off']);

const CommitmentBase = z.object({
  id: z.string(),
  cadence: CadenceSchema,
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
 * Build a commitment variant schema for a given category. Uses two sequential
 * `.extend()` calls rather than spreading `extra` into one object literal —
 * spreading a generic `z.ZodRawShape` collapses the result's type to an index
 * signature and breaks `z.infer` for every field on `CommitmentBase`.
 *
 * The default `E = {}` is crucial: without it, variants with no extra fields
 * fall back to the `ZodRawShape` constraint (which carries an index signature)
 * and erase the discriminant.
 */
const commitmentCategory = <N extends string, E extends z.ZodRawShape = {}>(
  name: N,
  extra: E = {} as E,
) => CommitmentBase.extend(extra).extend({ category: z.literal(name) });

export const DeclaredIncomingSchema = z.discriminatedUnion('category', [
  commitmentCategory('rental-income', {
    ownership: z.record(PersonIdSchema, z.number()),
  }),
]);

export const DeclaredOutgoingSchema = z.discriminatedUnion('category', [
  commitmentCategory('fixed-bill'),
  commitmentCategory('subscription'),
  commitmentCategory('payroll', {
    personId: PersonIdSchema.optional(),
    amountTolerance: z.number().optional(),
  }),
  commitmentCategory('insurance', {
    dueDate: z.string().optional(),
  }),
  commitmentCategory('tax-manual', {
    personId: PersonIdSchema.optional(),
    dueDate: z.string().optional(),
    /**
     * Subtype of the tax obligation — mirrors the historical API `type` enum
     * values that all project down to the `tax-manual` commitment category.
     * Preserved so a `vat` obligation round-trips through
     * commitments.csv back to the Obligations tab as `type='vat'` (not
     * silently collapsed to `self-assessment`). Optional for backwards-
     * compatibility with rows written before this field existed.
     */
    taxType: z.enum(['vat', 'corporation-tax', 'self-assessment', 'hmrc-ttp']).optional(),
  }),
]);

export const UpcomingRecurringFrequencySchema = z.enum(['monthly', 'annual']);

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
  /** See {@link RecurringExpenseSchema.declaredCommitmentId}. */
  declaredCommitmentId: z.string().optional(),
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
  recurrence: ObligationRecurrenceSchema,
  expectedAmount: z.number().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  status: ObligationStatusSchema.optional(),
  notes: z.string().nullable().optional(),
  personId: PersonIdSchema.nullable().optional(),
});

export const UpdateObligationBodySchema = CreateObligationBodySchema.partial();

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
export type InvoicesListResponse = z.infer<typeof InvoicesListResponseSchema>;
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

// API Request Body Types
export type SetBalanceRequest = z.infer<typeof SetBalanceRequestSchema>;
export type DownloadSelectedRequest = z.infer<typeof DownloadSelectedRequestSchema>;

// Obligations Types
export type ObligationSource = z.infer<typeof ObligationSourceSchema>;
export type ObligationType = z.infer<typeof ObligationTypeSchema>;
export type PersonId = z.infer<typeof PersonIdSchema>;
export type ObligationRecurrence = z.infer<typeof ObligationRecurrenceSchema>;
export type ObligationStatus = z.infer<typeof ObligationStatusSchema>;
export type Obligation = z.infer<typeof ObligationSchema>;
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
export type Dismissal = z.infer<typeof DismissalSchema>;
export type CreateDismissalBody = z.infer<typeof CreateDismissalBodySchema>;
export type DismissalsListResponse = z.infer<typeof DismissalsListResponseSchema>;

// Declared Commitments Types
export type Cadence = z.infer<typeof CadenceSchema>;
export type DeclaredIncoming = z.infer<typeof DeclaredIncomingSchema>;
export type DeclaredOutgoing = z.infer<typeof DeclaredOutgoingSchema>;
export type DeclaredCommitment = DeclaredIncoming | DeclaredOutgoing;
export type DeclaredIncomingCategory = DeclaredIncoming['category'];
export type DeclaredOutgoingCategory = DeclaredOutgoing['category'];
export type DeclaredCommitmentCategory = DeclaredIncomingCategory | DeclaredOutgoingCategory;

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
