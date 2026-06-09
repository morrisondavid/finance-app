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
  'emirates-islamic-gbp',
  'emirates-islamic-usd',
  'santander-everyday',
  'mbna'
]);

/**
 * Canonical list of supported account ids.
 * Derived from {@link AccountNameSchema} so adding a new account only requires
 * updating the schema — the literal tuple, the TS union type, and any runtime
 * iteration all follow automatically.
 */
export const ACCOUNTS = AccountNameSchema.options;

export const CurrencyCodeSchema = z.enum(['GBP', 'AED', 'USD']);
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Currencies that may appear on AISP feed payloads when they differ from
 * book {@link CurrencyCodeSchema} (e.g. EUR from an ES sandbox ASPSP).
 */
export const AispFeedCurrencyCodeSchema = z.enum(['GBP', 'AED', 'EUR']);
export type AispFeedCurrencyCode = z.infer<typeof AispFeedCurrencyCodeSchema>;

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

/**
 * Minimal Enable Banking slice on the dashboard account list — mirrors
 * `EnableBankingFeedConfigSchema` / `AispFeedConfigSchema` in
 * `server/domain/accounts/schema.ts` so Zod does not strip `aispFeed`
 * when parsing `GET /api/dashboard/accounts`.
 */
export const DashboardEnableBankingFeedSchema = z.object({
  accountId: z.string().min(1).optional(),
  institutionHint: z
    .object({
      institutionName: z.string().min(1),
      country: z.string().length(2),
    })
    .optional(),
  feedCurrency: AispFeedCurrencyCodeSchema.optional(),
});

/** Mirrors `TrueLayerFeedConfigSchema` on the dashboard surface */
export const DashboardTrueLayerFeedSchema = z.object({
  dataAccountId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  feedCurrency: AispFeedCurrencyCodeSchema.optional(),
});

export const DashboardAispFeedSchema = z.object({
  enableBanking: DashboardEnableBankingFeedSchema.optional(),
  trueLayer: DashboardTrueLayerFeedSchema.optional(),
});

export const AccountConfigSchema = z.object({
  name: AccountNameSchema,
  label: z.string(),
  type: AccountTypeSchema,
  currency: CurrencyCodeSchema,
  category: AccountCategorySchema,
  canMakeOutgoingPayments: z.boolean(),
  excludeTransfersFromIncome: z.boolean(),
  showTaxLiabilities: z.boolean(),
  /** First calendar month statement PDF/CSV are required; omitted = always required. */
  bankOpenedDate: IsoDateSchema.nullable().optional(),
  aispFeed: DashboardAispFeedSchema.optional(),
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

export const BalanceSemanticsSchema = z.enum([
  'cash',
  'credit-remaining',
  'debt-owed',
  'passthrough',
]);
export type BalanceSemantics = z.infer<typeof BalanceSemanticsSchema>;

export const AccountBalanceSchema = z.object({
  account: z.string().optional(),
  /**
   * How to interpret `openingBalance` / `currentBalance` for this account.
   * Prefer the explicit `cashBalance` / `credit*` / `debtOwed` fields for agents.
   */
  balanceSemantics: BalanceSemanticsSchema,
  /** Cash/savings/current native balance; null when `balanceSemantics` is not `cash`. */
  cashBalance: z.number().nullable(),
  /** Credit line limit; meaningful for `credit-remaining` (limit-seeded cards). */
  creditLimit: z.number().nullable(),
  /** Portion of the line currently used; meaningful for `credit-remaining`. */
  creditUsed: z.number().nullable(),
  /** Headroom left on the line; meaningful for `credit-remaining` (matches legacy `currentBalance`). */
  creditRemaining: z.number().nullable(),
  /** Positive balance owed (card debt); meaningful for `credit-remaining` / `debt-owed`. */
  debtOwed: z.number().nullable(),
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

export const LiquidityOverviewLineSchema = z.object({
  account: AccountNameSchema,
  label: z.string(),
  kind: z.enum(['cash', 'credit']),
  currency: CurrencyCodeSchema,
  amountNative: z.number(),
  amountGbp: z.number(),
});

export const LiquidityOverviewSchema = z.object({
  totalCashGbp: z.number(),
  totalCreditGbp: z.number(),
  totalAvailableGbp: z.number(),
  lines: z.array(LiquidityOverviewLineSchema),
});

export const LiquidityCommitmentLineSchema = z.object({
  label: z.string(),
  amountGbp: z.number(),
  source: z.enum(['obligation', 'recurring-fixed']),
  dueDate: z.string().nullable(),
  obligationId: z.string().optional(),
  /** True when amount is at or above the commitment `significantThresholdGbp` (save-ahead). */
  significant: z.boolean().optional().default(false),
});

export const LiquidityCommitmentsOverviewSchema = z.object({
  /** Inclusive start of projection (usually today). */
  horizonStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Inclusive end of projection (today + 12 calendar months). */
  horizonEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Human-readable horizon, e.g. "Next 12 months (to 7 May 2027)". */
  horizonLabel: z.string(),
  /** GBP amount at/above which a line is marked `significant`. */
  significantThresholdGbp: z.number(),
  totalCommittedGbp: z.number(),
  cashAfterCommitmentsGbp: z.number(),
  lines: z.array(LiquidityCommitmentLineSchema),
});

const FinancialSafetyRawMetricValueSchema = z.union([z.number(), z.string(), z.boolean(), z.null()]);

export const AiFinancialSafetyPillarSchema = z.object({
  id: z.enum(['A', 'B', 'C', 'D']),
  label: z.string(),
  contribution: z.number(),
  weight: z.number(),
  rawMetrics: z.record(z.string(), FinancialSafetyRawMetricValueSchema),
});

export const AiFinancialSafetyWarningAdjustmentSchema = z.object({
  pointsDeducted: z.number(),
  linkedWarnings: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      fingerprint: z.string().min(16).max(64).optional(),
    }),
  ),
  capApplied: z.number().nullable(),
});

/** §2.2 Financial Safety Score — MCP / dashboard parity with `GET /api/ai/financial-safety`. */
export const AiFinancialSafetyResponseSchema = z.object({
  generatedAt: z.string(),
  schemaVersion: z.string(),
  inputsRef: z
    .object({
      financialSnapshotGeneratedAt: z.string(),
    })
    .optional(),
  score: z.number(),
  formulaVersion: z.literal('1.0.0'),
  pillars: z.array(AiFinancialSafetyPillarSchema),
  warningAdjustment: AiFinancialSafetyWarningAdjustmentSchema,
  baseScoreBeforeWarnings: z.number(),
});
export type AiFinancialSafetyResponse = z.infer<typeof AiFinancialSafetyResponseSchema>;

/** GET /api/dashboard/summary — `scope=accounts` skips liquidity/all-balances/unused counts. */
export const DashboardSummaryScopeSchema = z.enum(['full', 'accounts']).default('full');
export type DashboardSummaryScope = z.infer<typeof DashboardSummaryScopeSchema>;

/** Bank-feed connection dot on account chips (Accounts tab). */
export const FeedLinkIndicatorStatusSchema = z.enum([
  'not_applicable',
  'disconnected',
  'connected',
  'expiring_soon',
]);
export type FeedLinkIndicatorStatus = z.infer<typeof FeedLinkIndicatorStatusSchema>;

export const FeedLinkIndicatorSchema = z.object({
  status: FeedLinkIndicatorStatusSchema,
  consentExpiresAt: z.string().nullable().optional(),
});
export type FeedLinkIndicator = z.infer<typeof FeedLinkIndicatorSchema>;

export const FeedLinkByAccountSchema = z.record(z.string(), FeedLinkIndicatorSchema);
export type FeedLinkByAccount = z.infer<typeof FeedLinkByAccountSchema>;

export const DashboardSummaryHttpQuerySchema = z.object({
  financialYear: z.string().optional(),
  account: z.string().optional(),
  scope: DashboardSummaryScopeSchema.optional(),
});

/** Accounts-tab subset of GET /api/dashboard/summary (`scope=accounts`). */
export const DashboardAccountsSummaryResponseSchema = z.object({
  totals: DashboardTotalsSchema,
  monthly: z.array(MonthlySummarySchema),
  byAccount: z.record(z.string(), AccountSummarySchema),
  currentAccountBalance: AccountBalanceSchema.optional(),
  taxLiabilities: TaxLiabilitiesSchema,
  transferCount: z.number(),
  financialYears: z.array(z.string()),
  selectedFinancialYear: z.string().nullable(),
  selectedAccount: AccountNameSchema.optional(),
  budgetComparisons: z.array(BudgetComparisonSchema).default([]),
  yearlyBudgetComparisons: z.array(YearlyBudgetComparisonSchema).default([]),
  budgetNudges: z.array(BudgetNudgeSchema).default([]),
  feedLinkByAccount: FeedLinkByAccountSchema,
});
export type DashboardAccountsSummaryResponse = z.infer<typeof DashboardAccountsSummaryResponseSchema>;

// GET /api/dashboard/summary
export const DashboardSummaryResponseSchema = z.object({
  totals: DashboardTotalsSchema,
  monthly: z.array(MonthlySummarySchema),
  byAccount: z.record(z.string(), AccountSummarySchema),
  balances: z.record(z.string(), AccountBalanceSchema).optional(),
  currentAccountBalance: AccountBalanceSchema.optional(),
  liquidityOverview: LiquidityOverviewSchema,
  liquidityCommitments: LiquidityCommitmentsOverviewSchema.nullable(),
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
  feedLinkByAccount: FeedLinkByAccountSchema,
  /** §2.2 — same payload as `GET /api/ai/financial-safety` when present. */
  financialSafety: AiFinancialSafetyResponseSchema.optional(),
  /** Future income + projected available (survival insights). */
  availableFunds: z.lazy(() => AiAvailableFundsResponseSchema).optional(),
});

export const AccountConfigsResponseSchema = z.array(AccountConfigSchema);

/** GET /api/dashboard/feed-toolbar-state — drive Connect vs Sync toolbar (no OAuth side effects). */
export const FeedToolbarHiddenReasonSchema = z.enum(['no-aisp-feed', 'no-feed-emitter']);
export type FeedToolbarHiddenReason = z.infer<typeof FeedToolbarHiddenReasonSchema>;

export const FeedToolbarStateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hidden'),
    account: AccountNameSchema,
    reason: FeedToolbarHiddenReasonSchema,
  }),
  z.object({
    kind: z.literal('sync'),
    account: AccountNameSchema,
    activeProvider: z.enum(['truelayer', 'enable']),
  }),
  z.object({
    kind: z.literal('connect'),
    account: AccountNameSchema,
    connectProvider: z.enum(['truelayer', 'enable']),
    /** True when a TrueLayer data account id is configured but the refresh token is missing. */
    reconnect: z.boolean().optional(),
  }),
]);
export type FeedToolbarState = z.infer<typeof FeedToolbarStateSchema>;

/** GET /api/version — deploy/debug (no secrets). */
export const SourceHashManifestKindSchema = z.enum(['built', 'runtime-computed']);
export type SourceHashManifestKind = z.infer<
  typeof SourceHashManifestKindSchema
>;

export const ApiVersionResponseSchema = z.object({
  packageVersion: z.string(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceHashManifest: SourceHashManifestKindSchema,
  nodeEnv: z.string(),
});
export type ApiVersionResponse = z.infer<typeof ApiVersionResponseSchema>;

// GET /api/dashboard/transactions
export const TransactionsResponseSchema = z.array(TransactionSchema);

// GET /api/dashboard/balance/:account
// POST /api/dashboard/balance/:account (response)
export const AccountBalanceResponseSchema = AccountBalanceSchema;

/** MCP `analytics_get_balance_as_of` — running balance for one account on/before a date. */
export const AccountBalanceAsOfQuerySchema = z.object({
  account: AccountNameSchema,
  asOfDate: IsoDateSchema.optional(),
  financialYear: z.string().optional(),
});
export type AccountBalanceAsOfQuery = z.infer<typeof AccountBalanceAsOfQuerySchema>;

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
  /**
   * Back-reference to the debt row that produced this entry when the
   * recurring expense was driven by exact `matchAmounts` matching from
   * `debts.csv` (Fixed Expenses declaration-first path).
   */
  declaredDebtId: z.string().optional(),
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
  /** CT: marginal-relief / full-rate ceiling; equals `expectedAmount` when no accountant rate applies. */
  naiveAmount: z.number().nullable().optional(),
  adjustmentBasis: z.string().nullable().optional(),
  adjustmentSource: z.string().nullable().optional(),
  dueDate: z.string().nullable(),
  status: ObligationStatusSchema,
  paidAmount: z.number().nullable(),
  paidDate: z.string().nullable(),
  paidFromAccount: z.string().nullable(),
  /** Stable link to `transactions.hash` when settled from the ledger. */
  paidFromTxHash: z.string().nullable().optional(),
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
  /**
   * Optional FK to `properties/properties.csv`. Required for
   * `category === 'rental-income'` rows (locked at the registry gate);
   * optional for `category === 'insurance'` rows that happen to relate
   * to a property (landlord insurance). Anything else — payroll,
   * subscription, fixed-bill, tax-manual — leaves this null. See
   * §1.7 in ROADMAP.md for the rent ↔ mortgage join rationale.
   */
  propertyId: z.string().optional(),
  /**
   * When `false`, obligation is historical only — excluded from forward income
   * composition / leverage. Defaults to `true` when omitted in CSV.
   */
  active: z.boolean().default(true),
  /** ISO date when a recurring obligation ended (e.g. letting stopped). */
  endedAt: IsoDateSchema.optional(),
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
  /** Optional link to `transactions.hash`. When set, paid_* fields are derived from the transaction. */
  paidFromTxHash: z.string().nullable().optional(),
});

export const ObligationPaymentCandidateSchema = z.object({
  hash: z.string().min(1),
  date: z.string(),
  amount: z.number(),
  account: z.string(),
  description: z.string(),
});

export const ObligationPaymentCandidatesResponseSchema = z.object({
  candidates: z.array(ObligationPaymentCandidateSchema),
});

export const ObligationPaymentCandidatesQuerySchema = z.object({
  account: AccountNameSchema,
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export type ObligationPaymentCandidatesQuery = z.infer<typeof ObligationPaymentCandidatesQuerySchema>;

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

/**
 * Date-window fields for Hermes drill / MCP transaction listings (Roadmap Wave 03).
 *
 * **Precedence:** at most **one** of:
 * - ISO inclusive range `dateFrom` / `dateTo` (either may appear alone),
 * - `financialYear`,
 * - `year` with optional `month` (calendar bucket).
 *
 * Repository `getTransactions` still ANDs keys if callers send a contradictory mix;
 * validated HTTP/MCP handlers must rely on this schema instead.
 */
export const TransactionListingDateModesSchema = z
  .object({
    financialYear: z.string().min(1).optional(),
    year: z.string().regex(/^\d{4}$/).optional(),
    /** Calendar month when `year` is set (`1`–`12`, or zero-padded). */
    month: z.string().regex(/^(0?[1-9]|1[0-2])$/).optional(),
    dateFrom: IsoDateSchema.optional(),
    dateTo: IsoDateSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const hasMonth = v.month !== undefined;
    if (hasMonth && v.year === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '`month` requires `year`.',
        path: ['month'],
      });
      return;
    }

    const hasIso = v.dateFrom !== undefined || v.dateTo !== undefined;
    const fy = v.financialYear?.trim() ?? '';
    const hasFy = fy.length > 0;
    const hasYm = v.year !== undefined;

    let modeCount = 0;
    if (hasIso) modeCount++;
    if (hasFy) modeCount++;
    if (hasYm) modeCount++;

    if (modeCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Use exactly one window: ISO `dateFrom`/`dateTo`, `financialYear`, or `year` (+ optional `month`).',
      });
    }

    if (
      v.dateFrom !== undefined &&
      v.dateTo !== undefined &&
      v.dateFrom > v.dateTo
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '`dateFrom` must not be after `dateTo`.',
        path: ['dateTo'],
      });
    }
  });

export type TransactionListingDateModes = z.infer<typeof TransactionListingDateModesSchema>;

/**
 * Core transaction list filters (maps to repository `TransactionFilters` keys excluding `account`):
 * **`year`**, **`month`**, **`financialYear`**, **`type`**, **`includeTransfers`**, **`search`**,
 * **`merchantModalLabel`**. Composed by {@link AiTransactionDrillQuerySchema} (plus date-window
 * fields and optional **`account`**) and by {@link DashboardTransactionsQuerySchema} (plus HTTP
 * `account` / `category` coercion).
 */
export const TransactionListFilterFieldsSchema = z.object({
  year: z.string().optional(),
  month: z.string().optional(),
  financialYear: z.string().optional(),
  type: TransactionTypeSchema.optional(),
  includeTransfers: z.boolean().optional(),
  search: z.string().optional(),
  merchantModalLabel: z.string().optional(),
});
export type TransactionListFilterFields = z.infer<typeof TransactionListFilterFieldsSchema>;

function trimTransactionQueryField(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t !== undefined && t.length > 0 ? t : undefined;
}

export const DashboardTransactionsRawQuerySchema = z.object({
  account: z.string().optional(),
  category: z.string().optional(),
  year: z.string().optional(),
  month: z.string().optional(),
  financialYear: z.string().optional(),
  type: z.string().optional(),
  includeTransfers: z.union([z.boolean(), z.string()]).optional(),
  search: z.string().optional(),
  merchantModalLabel: z.string().optional(),
});

/**
 * Normalised `GET /api/dashboard/transactions` query — pass **`flattenExpressQuery(req.query)`**
 * from `server/utils/flatten-express-query.ts`.
 */
export const DashboardTransactionsQuerySchema = DashboardTransactionsRawQuerySchema.transform(raw => {
  const rawTypeTrimmed = trimTransactionQueryField(raw.type);
  let coercedType: z.infer<typeof TransactionTypeSchema> | undefined;
  if (rawTypeTrimmed !== undefined) {
    const typeParsed = TransactionTypeSchema.safeParse(rawTypeTrimmed);
    coercedType = typeParsed.success ? typeParsed.data : undefined;
  }
  return {
    account: trimTransactionQueryField(raw.account),
    category: trimTransactionQueryField(raw.category),
    year: trimTransactionQueryField(raw.year),
    month: trimTransactionQueryField(raw.month),
    financialYear: trimTransactionQueryField(raw.financialYear),
    search: trimTransactionQueryField(raw.search),
    merchantModalLabel: trimTransactionQueryField(raw.merchantModalLabel),
    type: coercedType,
    includeTransfers:
      raw.includeTransfers === true || raw.includeTransfers === 'true' ? true : undefined,
  };
});
export type DashboardTransactionsQueryParsed = z.infer<typeof DashboardTransactionsQuerySchema>;

/** §2.0 / Wave 03 — agent + MCP transaction drill (HTTP + `query_transactions`). */
export const AiTransactionDrillMatchModeSchema = z.enum(['none', 'search', 'merchant_modal']);
export type AiTransactionDrillMatchMode = z.infer<typeof AiTransactionDrillMatchModeSchema>;

export const AiTransactionDrillRowSchema = z.object({
  id: z.number().int(),
  date: IsoDateSchema,
  description: z.string(),
  amount: z.number(),
  account: z.string(),
  type: TransactionTypeSchema,
});
export type AiTransactionDrillRow = z.infer<typeof AiTransactionDrillRowSchema>;

export const AiTransactionDrillAggregateByAccountSchema = z.object({
  account: z.string(),
  currency: CurrencyCodeSchema,
  rowCount: z.number().int().nonnegative(),
  sumAmount: z.number(),
});
export type AiTransactionDrillAggregateByAccount = z.infer<typeof AiTransactionDrillAggregateByAccountSchema>;

export const AiTransactionDrillTotalsByCurrencySchema = z.object({
  currency: CurrencyCodeSchema,
  rowCount: z.number().int().nonnegative(),
  sumAmount: z.number(),
});
export type AiTransactionDrillTotalsByCurrency = z.infer<typeof AiTransactionDrillTotalsByCurrencySchema>;

/**
 * Query surface for `GET /api/ai/transactions-drill` and MCP `query_transactions`.
 * Extends {@link TransactionListingDateModesSchema}: **exactly one** date window is required.
 *
 * **`account` optional** — When omitted, SQL does not add `AND account = ?` (matches **all** ledger
 * accounts that satisfy the other filters). **Prefer passing `account`** when the user names a
 * specific bank/card so results and transfer handling match that account’s registry config.
 *
 * **Transfers (cross-account, no `account`)** — With no `type` and no `includeTransfers`, the
 * repository **excludes `transfer` rows by default**. With `type: 'income'` or `type: 'expense'`
 * but still no `account`, you get plain type equality (no per-account “treat transfer as
 * income/expense” expansion). **`includeTransfers` is only meaningful when `account` is set**
 * to a valid account that supports that expansion in `getTransactions`.
 *
 * **Merchant modal (`merchantModalLabel`)** — Without `account`, there is no per-account transfer
 * expansion for expense drills; SQL modal predicates still apply.
 *
 * **Money** — Use `aggregatesByAccount` / `totalsByCurrency` in the response; **do not add amounts
 * across different `currency` values** as a single total without FX logic.
 */
export const AiTransactionDrillQuerySchema = TransactionListingDateModesSchema.merge(
  TransactionListFilterFieldsSchema.extend({
    account: AccountNameSchema.optional(),
    limit: z.number().int().positive().max(500).default(100),
    /** When false, `rows` is empty and only aggregates / counts are returned (faster for “how much” questions). */
    includeRows: z.boolean().default(true),
  }),
).superRefine((v, ctx) => {
  const searchT = v.search?.trim() ?? '';
  const merchT = v.merchantModalLabel?.trim() ?? '';
  if (searchT.length > 0 && merchT.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Use either `search` or `merchantModalLabel`, not both.',
    });
  }

  const hasIso = v.dateFrom !== undefined || v.dateTo !== undefined;
  const hasFy = v.financialYear !== undefined && v.financialYear.trim().length > 0;
  const hasYm = v.year !== undefined;
  if (!hasIso && !hasFy && !hasYm) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Specify exactly one date window: `dateFrom`/`dateTo`, `financialYear`, or `year` (+ optional `month`).',
      path: ['dateFrom'],
    });
  }
});

export type AiTransactionDrillQuery = z.infer<typeof AiTransactionDrillQuerySchema>;

/**
 * Drill result: row sample (maybe truncated), counts, and **`aggregatesByAccount`** /
 * **`totalsByCurrency`** (same match set as **`matchedRowCount`**). Prefer **`totalsByCurrency`** for
 * headline amounts **within** a currency; do not merge across currencies without FX.
 */
export const AiTransactionDrillResponseSchema = z.object({
  generatedAt: z.string(),
  schemaVersion: z.string(),
  matchMode: AiTransactionDrillMatchModeSchema,
  includeRows: z.boolean(),
  truncated: z.boolean(),
  /** Rows matching filters (before applying `limit`). */
  matchedRowCount: z.number().int().nonnegative(),
  returnedRowCount: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  /** Echo of effective drill inputs (after trims / defaults). */
  query: AiTransactionDrillQuerySchema,
  aggregatesByAccount: z.array(AiTransactionDrillAggregateByAccountSchema),
  totalsByCurrency: z.array(AiTransactionDrillTotalsByCurrencySchema),
  rows: z.array(AiTransactionDrillRowSchema),
});
export type AiTransactionDrillResponse = z.infer<typeof AiTransactionDrillResponseSchema>;

export const DebtKindSchema = z.enum(['consumer', 'mortgage']);
/**
 * API-facing debt classification for agents (roadmap §2.0.A). Derived from
 * stored {@link DebtKindSchema} rows — `consumer` → `amortising-loan`.
 */
export const DebtSemanticKindSchema = z.enum(['amortising-loan', 'revolving-credit', 'mortgage']);
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
  /** Normalised kind for autonomous consumers (prefer this over `kind`). */
  debtKind: DebtSemanticKindSchema,
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

/** §3.1 — one persisted net-worth snapshot row (CSV + AI history). */
export const NetWorthSnapshotEntityIdSchema = z.union([z.literal('global'), EntityIdSchema]);
export const NetWorthSnapshotRowSchema = z.object({
  periodKey: z.string().min(1),
  snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entityId: NetWorthSnapshotEntityIdSchema,
  reportingCurrency: z.literal('GBP'),
  cadence: z.enum(['weekly', 'daily']),
  totalCashGbp: z.number(),
  totalCreditGbp: z.number(),
  totalObligations12mGbp: z.number(),
  totalDebtGbp: z.number(),
  netGbp: z.number(),
  formulaVersion: z.string().min(1),
  capturedAt: z.string().min(1),
});
export type NetWorthSnapshotRow = z.infer<typeof NetWorthSnapshotRowSchema>;

/** GET /api/ai/net-worth-history */
export const AiNetWorthHistoryResponseSchema = z.object({
  generatedAt: z.string(),
  schemaVersion: z.string(),
  snapshots: z.array(NetWorthSnapshotRowSchema),
});
export type AiNetWorthHistoryResponse = z.infer<typeof AiNetWorthHistoryResponseSchema>;

/** POST /api/ai/net-worth/snapshot */
export const NetWorthSnapshotCaptureBodySchema = z.object({
  force: z.boolean().optional(),
  snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type NetWorthSnapshotCaptureBody = z.infer<typeof NetWorthSnapshotCaptureBodySchema>;

export const NetWorthSnapshotCaptureResponseSchema = z.object({
  skipped: z.boolean(),
  reason: z.string().optional(),
  periodKey: z.string(),
  snapshotDate: z.string(),
  cadence: z.enum(['weekly', 'daily']),
  rowsWritten: z.number().int().nonnegative(),
});
export type NetWorthSnapshotCaptureResponse = z.infer<typeof NetWorthSnapshotCaptureResponseSchema>;

// §3.4 — Modular AISP feed: shared body / response schemas.
// HTTP (`POST /api/feed/sync`) and MCP (`sync_bank_feed` tool) share the
// exact same Zod surface so a single change here propagates to both.

const FeedSyncIsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const FeedSyncWindowSchema = z.object({
  dateFrom: FeedSyncIsoDateSchema,
  dateTo: FeedSyncIsoDateSchema,
});
export type FeedSyncWindow = z.infer<typeof FeedSyncWindowSchema>;

/**
 * Request body / MCP tool input. `dateFrom` is **required** by design:
 * we never invent a window start (cron passes today minus N, the UI
 * defaults from "day after last covered date", AI agents must specify).
 */
export const FeedSyncBodySchema = z.object({
  account: AccountNameSchema,
  dateFrom: FeedSyncIsoDateSchema,
  dateTo: FeedSyncIsoDateSchema.optional(),
  force: z.boolean().optional(),
  /**
   * Re-fetch the last N calendar days ending `dateTo` (inclusive), without
   * advancing past `latestCsvDate + 1`. Used by scheduled sync; manual UI
   * leaves this unset for incremental pulls.
   */
  lookbackDays: z.number().int().min(1).max(14).optional(),
});
export type FeedSyncBody = z.infer<typeof FeedSyncBodySchema>;

export const EnableFeedStartBodySchema = z.object({
  account: AccountNameSchema,
  country: z.string().length(2).optional(),
  aspspName: z.string().min(1).optional(),
  psuType: z.enum(['personal', 'business']).optional(),
});
export type EnableFeedStartBody = z.infer<typeof EnableFeedStartBodySchema>;

export const EnableFeedStartResponseSchema = z.object({
  url: z.string().url(),
  state: z.string().min(1),
});
export type EnableFeedStartResponse = z.infer<typeof EnableFeedStartResponseSchema>;

export const TrueLayerFeedStartBodySchema = z.object({
  account: AccountNameSchema,
  /** Overrides `aispFeed.trueLayer.providerId` when set */
  providerId: z.string().min(1).optional(),
  /** ISO 3166-1 alpha-2; defaults via auth link (`country_id`) when omitted */
  countryId: z.string().length(2).optional(),
});
export type TrueLayerFeedStartBody = z.infer<typeof TrueLayerFeedStartBodySchema>;

export const TrueLayerFeedStartResponseSchema = EnableFeedStartResponseSchema;
export type TrueLayerFeedStartResponse = z.infer<typeof TrueLayerFeedStartResponseSchema>;

export const FeedSyncIngestOutcomeSchema = z.enum(['ingested', 'invalid', 'duplicate']);
export type FeedSyncIngestOutcome = z.infer<typeof FeedSyncIngestOutcomeSchema>;

export const FeedSyncResponseSchema = z.object({
  account: AccountNameSchema,
  /** True when the adapter call was skipped (e.g. window already covered). */
  skipped: z.boolean(),
  /** Stable reason code for skips ('already_up_to_date' for v1). */
  reason: z.string().optional(),
  /** Effective window after `resolveWindow` (may differ from request). */
  window: FeedSyncWindowSchema,
  /** How many rows the AISP returned within the effective window. */
  rowsFetched: z.number().int().nonnegative(),
  /** True iff a CSV was actually written and handed to `ingestCsvFile`. */
  csvWritten: z.boolean(),
  /** Outcome of the shared ingest step. Absent when `csvWritten === false`. */
  ingestOutcome: FeedSyncIngestOutcomeSchema.optional(),
  /** Names of any monthly partitions written. */
  partitionedFiles: z.array(z.string()).default([]),
  /** True iff `initDatabase()` ran (only when ingest succeeded). */
  initDatabaseRan: z.boolean(),
  /** Set when ingest detected a duplicate of an existing `_originals/` file. */
  duplicateOriginalName: z.string().optional(),
  duplicateExistingPath: z.string().optional(),
});
export type FeedSyncResponse = z.infer<typeof FeedSyncResponseSchema>;

export const FeedSyncAispProviderSchema = z.enum(['truelayer', 'enable']);
export type FeedSyncAispProvider = z.infer<typeof FeedSyncAispProviderSchema>;

/** Relative path under repo root — last scheduled `feed:sync-all` run. */
export const FEED_SYNC_SCHEDULED_STATUS_REL_PATH = 'data/feed-sync-scheduled-status.json';

export const FeedSyncScheduledAccountResultSchema = z.discriminatedUnion('status', [
  z.object({
    account: AccountNameSchema,
    status: z.literal('ingested'),
    rowsFetched: z.number().int().nonnegative(),
    window: FeedSyncWindowSchema,
    ingestOutcome: z.literal('ingested'),
    initDatabaseRan: z.boolean(),
    partitionedFiles: z.array(z.string()).optional(),
  }),
  z.object({
    account: AccountNameSchema,
    status: z.literal('unchanged'),
    reason: z.string(),
    rowsFetched: z.number().int().nonnegative(),
    window: FeedSyncWindowSchema.optional(),
    ingestOutcome: FeedSyncIngestOutcomeSchema.optional(),
    duplicateOriginalName: z.string().optional(),
    duplicateExistingPath: z.string().optional(),
  }),
  z.object({
    account: AccountNameSchema,
    status: z.literal('skipped'),
    reason: z.string(),
  }),
  z.object({
    account: AccountNameSchema,
    status: z.literal('failed'),
    error: z.string(),
    code: z.string().optional(),
    stack: z.string().optional(),
    provider: FeedSyncAispProviderSchema.optional(),
  }),
]);
export type FeedSyncScheduledAccountResult = z.infer<typeof FeedSyncScheduledAccountResultSchema>;

export const FeedSyncScheduledStatusSchema = z.object({
  lastRunAt: z.string().datetime(),
  lastRunKind: z.enum(['scheduled', 'manual']),
  lookbackDays: z.number().int().min(1).max(14),
  accounts: z.array(FeedSyncScheduledAccountResultSchema),
});
export type FeedSyncScheduledStatus = z.infer<typeof FeedSyncScheduledStatusSchema>;

/** Relative path under repo root — append-only feed sync run history (newest first). */
export const FEED_SYNC_RUNS_REL_PATH = 'data/feed-sync-runs.json';

export const FeedSyncRunOutcomeSchema = z.enum(['ok', 'partial', 'failed', 'no_op']);
export type FeedSyncRunOutcome = z.infer<typeof FeedSyncRunOutcomeSchema>;

export const FeedSyncRunTriggerSchema = z.enum(['scheduled', 'manual']);
export type FeedSyncRunTrigger = z.infer<typeof FeedSyncRunTriggerSchema>;

export const FeedSyncRunSchema = z.object({
  id: z.string().min(1),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  trigger: FeedSyncRunTriggerSchema,
  lookbackDays: z.number().int().min(1).max(14),
  outcome: FeedSyncRunOutcomeSchema,
  durationMs: z.number().int().nonnegative(),
  accounts: z.array(FeedSyncScheduledAccountResultSchema),
  error: z.string().optional(),
  errorStack: z.string().optional(),
});
export type FeedSyncRun = z.infer<typeof FeedSyncRunSchema>;

/** Relative path under repo root — append-only operational feed sync event log. */
export const FEED_SYNC_EVENTS_REL_PATH = 'data/feed-sync-events.jsonl';

export const FeedSyncEventLevelSchema = z.enum(['info', 'warn', 'error']);
export type FeedSyncEventLevel = z.infer<typeof FeedSyncEventLevelSchema>;

export const FeedSyncEventKindSchema = z.enum([
  'run_start',
  'account_start',
  'window',
  'fetch_ok',
  'fetch_failed',
  'ingest',
  'run_end',
  'run_fatal',
]);
export type FeedSyncEventKind = z.infer<typeof FeedSyncEventKindSchema>;

export const FeedSyncEventDetailSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);
export type FeedSyncEventDetail = z.infer<typeof FeedSyncEventDetailSchema>;

export const FeedSyncEventSchema = z.object({
  at: z.string().datetime(),
  runId: z.string().min(1),
  trigger: FeedSyncRunTriggerSchema,
  level: FeedSyncEventLevelSchema,
  kind: FeedSyncEventKindSchema,
  message: z.string(),
  account: AccountNameSchema.optional(),
  provider: FeedSyncAispProviderSchema.optional(),
  detail: FeedSyncEventDetailSchema.optional(),
  stack: z.string().optional(),
  code: z.string().optional(),
});
export type FeedSyncEvent = z.infer<typeof FeedSyncEventSchema>;

/** `GET /api/feed/sync-runs/:runId/events` — operational events for one run. */
export const FeedSyncEventsResponseSchema = z.object({
  events: z.array(FeedSyncEventSchema),
});
export type FeedSyncEventsResponse = z.infer<typeof FeedSyncEventsResponseSchema>;

export const FeedSyncRunLogSchema = z.object({
  runs: z.array(FeedSyncRunSchema),
});
export type FeedSyncRunLog = z.infer<typeof FeedSyncRunLogSchema>;

/** `GET /api/feed/sync-runs` — run history + scheduler health. */
export const FeedSyncRunsResponseSchema = z.object({
  runs: z.array(FeedSyncRunSchema),
  lastRunAt: z.string().datetime().nullable(),
  overdue: z.boolean(),
  nextScheduledRunAt: z.string().datetime().nullable(),
});
export type FeedSyncRunsResponse = z.infer<typeof FeedSyncRunsResponseSchema>;

/** `POST /api/feed/sync-all` — idempotent guarded sync-all result. */
export const FeedSyncAllResponseSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('completed'),
    run: FeedSyncRunSchema,
  }),
  z.object({
    state: z.literal('deduped'),
    run: FeedSyncRunSchema,
  }),
  z.object({
    state: z.literal('in-progress'),
    startedAt: z.string().datetime(),
  }),
  z.object({
    state: z.literal('started'),
    runId: z.string().min(1),
    startedAt: z.string().datetime(),
  }),
]);
export type FeedSyncAllResponse = z.infer<typeof FeedSyncAllResponseSchema>;

/** Error payload from `POST /api/feed/sync` on non-2xx (see `server/routes/feed.ts`). */
export const FeedSyncHttpErrorBodySchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
});

/** §3.2 GET /api/ai/spend-by-currency — period + optional entity/account filters. */
export const AiSpendByCurrencyPeriodSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('calendarMonth'),
    yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  }),
  z.object({
    kind: z.literal('financialYear'),
    financialYear: z.string().min(1),
  }),
]);
export type AiSpendByCurrencyPeriod = z.infer<typeof AiSpendByCurrencyPeriodSchema>;

export const AiSpendByCurrencyResponseSchema = z.object({
  generatedAt: z.string(),
  schemaVersion: z.string(),
  period: AiSpendByCurrencyPeriodSchema,
  filters: z.object({
    entityId: EntityIdSchema.optional(),
    account: AccountNameSchema.optional(),
  }),
  totalsByCurrency: z.array(
    z.object({
      currency: CurrencyCodeSchema,
      expenseNative: z.number(),
      expenseGbp: z.number(),
      transactionCount: z.number().int().nonnegative(),
    }),
  ),
  fxNote: z.string(),
});
export type AiSpendByCurrencyResponse = z.infer<typeof AiSpendByCurrencyResponseSchema>;

/** §3.2 GET /api/ai/entity-liquidity-fx — household + per-entity liquidity overview lines. */
export const AiEntityLiquidityFxResponseSchema = z.object({
  generatedAt: z.string(),
  schemaVersion: z.string(),
  asOf: IsoDateSchema,
  global: LiquidityOverviewSchema,
  byEntity: z.record(EntityIdSchema, LiquidityOverviewSchema),
});
export type AiEntityLiquidityFxResponse = z.infer<typeof AiEntityLiquidityFxResponseSchema>;

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
  /**
   * How output VAT obligations are derived for this entity.
   * `standard` — accrual: sum issued-invoice `vat_amount` by tax point
   * (`invoice_date`). `cash` — sum bank income × VAT fraction by receipt
   * date (legacy proxy).
   */
  vat_scheme: z.enum(['standard', 'cash']).default('standard'),
  /**
   * Rolling average effective CT rate from filed years (0–1). When set,
   * auto CT obligations use it for `expectedAmount` while keeping the
   * marginal-relief `naiveAmount` alongside.
   */
  historical_effective_ct_rate: z.number().min(0).max(1).nullable().optional(),
  /**
   * Rolling average effective VAT rate from filed years (0–1). Reserved
   * for VAT obligation adjustments; CT uses
   * `historical_effective_ct_rate` today.
   */
  historical_effective_vat_rate: z.number().min(0).max(1).nullable().optional(),
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

// ─── Public holidays (§1.4) ─────────────────────────────────────────────────

export const PublicHolidaySchema = z.object({
  date: IsoDateSchema,
  name: z.string().min(1),
});
export type PublicHoliday = z.infer<typeof PublicHolidaySchema>;

export const PublicHolidaysResponseSchema = z.object({
  holidays: z.array(PublicHolidaySchema),
});
export type PublicHolidaysResponse = z.infer<typeof PublicHolidaysResponseSchema>;

// ─── Cash Flow Forecast (§1.5) ──────────────────────────────────────────────

export const ForecastDailyPointSchema = z.object({
  date: IsoDateSchema,
  balance: z.number(),
});
export type ForecastDailyPoint = z.infer<typeof ForecastDailyPointSchema>;

export const ForecastAccountSeriesSchema = z.object({
  account: AccountNameSchema,
  currency: CurrencyCodeSchema,
  entityId: EntityIdSchema.nullable(),
  daily: z.array(ForecastDailyPointSchema),
});
export type ForecastAccountSeries = z.infer<typeof ForecastAccountSeriesSchema>;

export const ForecastEntitySummarySchema = z.object({
  entityId: EntityIdSchema.nullable(),
  currency: CurrencyCodeSchema,
  current: z.number(),
  day30: z.number(),
  day60: z.number(),
  day90: z.number(),
});
export type ForecastEntitySummary = z.infer<typeof ForecastEntitySummarySchema>;

export const ForecastResponseSchema = z.object({
  today: IsoDateSchema,
  horizonDays: z.number().int().positive(),
  accounts: z.array(ForecastAccountSeriesSchema),
  entities: z.array(ForecastEntitySummarySchema),
});
export type ForecastResponse = z.infer<typeof ForecastResponseSchema>;

/** One currency within the household holistic block (GBP and AED headlines). */
export const RunwayHouseholdCurrencySchema = z.object({
  currency: CurrencyCodeSchema,
  runwayMonthsFullRecurring: z.number().nullable(),
  runwayMonthsMandatoryRecurring: z.number().nullable(),
  firstStressDateFullRecurring: z.string().nullable(),
  firstStressDateMandatoryRecurring: z.string().nullable(),
  totalCashCurrent: z.number(),
  totalAvailableCredit: z.number(),
});

export const RunwayHolisticGbpSchema = z.object({
  firstStressDateFullRecurring: z.string().nullable(),
  runwayMonthsFullRecurring: z.number().nullable(),
  firstStressDateMandatoryRecurring: z.string().nullable(),
  runwayMonthsMandatoryRecurring: z.number().nullable(),
});
export type RunwayHolisticGbp = z.infer<typeof RunwayHolisticGbpSchema>;

export const RunwayHouseholdSchema = z.object({
  GBP: RunwayHouseholdCurrencySchema.optional(),
  AED: RunwayHouseholdCurrencySchema.optional(),
});

export const RunwayStressBlockSchema = z.object({
  entities: z.array(ForecastEntitySummarySchema),
  accounts: z.array(ForecastAccountSeriesSchema).optional(),
});

export const RunwayResponseSchema = z.object({
  today: IsoDateSchema,
  horizonDays: z.number().int().positive(),
  household: RunwayHouseholdSchema,
  /** Merged GBP cash path (AED converted); primary “one date” runway. */
  holisticGbp: RunwayHolisticGbpSchema,
  insight: ExpensesInsightSchema,
  /** Explains scope/limitations of `insight` (e.g. rolling window, GBP-centric personal split). */
  insightNote: z.string(),
  stress: z.object({
    fullRecurring: RunwayStressBlockSchema,
    mandatoryRecurring: RunwayStressBlockSchema,
  }),
});

export type RunwayResponse = z.infer<typeof RunwayResponseSchema>;

// ============================================
// Income Composition (§1.7)
// ============================================
//
// Three single-mode-risk metrics over the existing income surface:
// `clientConcentration`, `activePassiveRatio`, `timeIndependence`. Plus a
// typed `riskSignals[]` array — discriminated union by `code`; each
// variant inlines its own primitive fields next to `code` and
// `severity` (no baked prose). Same convention as IncomingObligationSchema.

export const ActivityClassSchema = z.enum(['active', 'semi-passive', 'passive']);
export type ActivityClass = z.infer<typeof ActivityClassSchema>;

export const IncomeKindSchema = z.enum(['contract', 'rental-income', 'recurring-detected']);
export type IncomeKind = z.infer<typeof IncomeKindSchema>;

export const IncomeSourceSchema = z.object({
  kind: IncomeKindSchema,
  id: z.string(),
  label: z.string(),
  monthlyAmount: z.number(),
  currency: CurrencyCodeSchema,
  entityId: EntityIdSchema.nullable(),
  activityClass: ActivityClassSchema,
  propertyId: z.string().nullable(),
  clientId: z.string().nullable(),
});
export type IncomeSource = z.infer<typeof IncomeSourceSchema>;

const ClientConcentrationSchema = z.object({
  ratio: z.number(),
  topClientId: z.string().nullable(),
  topClientMonthly: z.number(),
  totalActiveMonthly: z.number(),
});

const PassiveByKindSchema = z.object({
  contract: z.number(),
  'rental-income': z.number(),
  'recurring-detected': z.number(),
});

const ActivePassiveRatioSchema = z.object({
  ratio: z.number(),
  passiveMonthly: z.number(),
  activeMonthly: z.number(),
  totalMonthly: z.number(),
  passiveByKind: PassiveByKindSchema,
});

const TimeIndependenceSchema = z.object({
  ratio: z.number(),
  passiveMonthly: z.number(),
  mandatoryMonthly: z.number(),
});

export const IncomeCompositionMetricsSchema = z.object({
  clientConcentration: ClientConcentrationSchema,
  activePassiveRatio: ActivePassiveRatioSchema,
  timeIndependence: TimeIndependenceSchema,
});
export type IncomeCompositionMetrics = z.infer<typeof IncomeCompositionMetricsSchema>;

const IncomeCompositionScopeSchema = z.object({
  entityId: EntityIdSchema.nullable(),
  currency: CurrencyCodeSchema,
  metrics: IncomeCompositionMetricsSchema,
});

export const RiskSignalSchema = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('client-concentration-extreme'),
    severity: z.literal('high'),
    currency: CurrencyCodeSchema,
    ratio: z.number(),
    topClientId: z.string(),
    topClientMonthly: z.number(),
    totalActiveMonthly: z.number(),
    threshold: z.number(),
  }),
  z.object({
    code: z.literal('client-concentration-elevated'),
    severity: z.literal('medium'),
    currency: CurrencyCodeSchema,
    ratio: z.number(),
    topClientId: z.string(),
    topClientMonthly: z.number(),
    totalActiveMonthly: z.number(),
    threshold: z.number(),
  }),
  z.object({
    code: z.literal('time-independence-low'),
    severity: z.literal('high'),
    currency: CurrencyCodeSchema,
    ratio: z.number(),
    passiveMonthly: z.number(),
    mandatoryMonthly: z.number(),
    targetRatio: z.number(),
    additionalPassiveNeeded: z.number(),
    mandatoryReductionNeeded: z.number(),
  }),
  z.object({
    code: z.literal('time-independence-elevated'),
    severity: z.literal('medium'),
    currency: CurrencyCodeSchema,
    ratio: z.number(),
    passiveMonthly: z.number(),
    mandatoryMonthly: z.number(),
    targetRatio: z.number(),
    additionalPassiveNeeded: z.number(),
    mandatoryReductionNeeded: z.number(),
  }),
  z.object({
    code: z.literal('mode-concentration-extreme'),
    severity: z.literal('high'),
    currency: CurrencyCodeSchema,
    activeShare: z.number(),
    passiveShare: z.number(),
    totalMonthly: z.number(),
    threshold: z.number(),
  }),
  z.object({
    code: z.literal('passive-income-zero'),
    severity: z.literal('high'),
    currency: CurrencyCodeSchema,
    passiveMonthly: z.literal(0),
    mandatoryMonthly: z.number(),
  }),
  z.object({
    code: z.literal('leveraged-passive-income'),
    severity: z.enum(['high', 'medium']),
    propertyId: z.string(),
    grossMonthly: z.number(),
    mortgageMonthly: z.number(),
    netMonthly: z.number(),
    netToGrossRatio: z.number(),
    threshold: z.number(),
  }),
]);
export type RiskSignal = z.infer<typeof RiskSignalSchema>;

export const IncomeCompositionHouseholdSchema = z.object({
  GBP: IncomeCompositionMetricsSchema.optional(),
  AED: IncomeCompositionMetricsSchema.optional(),
});

export const IncomeCompositionResponseSchema = z.object({
  today: IsoDateSchema,
  /** Per-currency household rollup. Currencies absent from the system are omitted. */
  household: IncomeCompositionHouseholdSchema,
  /** Per-(entityId | null, currency) drill-down. */
  byEntity: z.array(IncomeCompositionScopeSchema),
  /** Every income source consumed by the metrics, for transparency / debugging / AI consumers. */
  sources: z.array(IncomeSourceSchema),
  /** Typed risk signals — §1.8 lifts these directly onto the warnings tab. */
  riskSignals: z.array(RiskSignalSchema),
});
export type IncomeCompositionResponse = z.infer<typeof IncomeCompositionResponseSchema>;
export type RunwayHouseholdCurrency = z.infer<typeof RunwayHouseholdCurrencySchema>;

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
  /**
   * Human-readable engagement label (warnings, UI, email templates).
   * Not the agency PDF placement id — use {@link placement_ref} for self-bill ingest matching.
   */
  reference: z.string().min(1),
  /**
   * Agency placement / SOW code as printed on self-bill PDFs (La Fosse etc.).
   * Null when this engagement never uses that ingest path. Ingest matches
   * `parsed.placementRef` to this field, falling back to `reference` only for legacy rows.
   */
  placement_ref: z.string().nullable(),
  start_date: IsoDateSchema,
  end_date: IsoDateSchema,
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
  /**
   * Total working days for the entire contract lifecycle
   * (start_date → end_date, excluding weekends, leave, bank holidays).
   * `null` for open-ended contracts (no end_date).
   */
  total_contract_working_days: z.number().int().nonnegative().nullable(),
  /**
   * Total expected contract value (total_contract_working_days × day_rate).
   * `null` for open-ended contracts.
   */
  total_contract_value: z.number().nonnegative().nullable(),
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

// ---------------------------------------------------------------------------
// Expected receipts — shared by GET /api/contracts/expected-receipts + /api/ai/pipeline
// ---------------------------------------------------------------------------

export const ExpectedReceiptSourceSchema = z.enum(['accrual', 'invoice-receipt']);
export type ExpectedReceiptSource = z.infer<typeof ExpectedReceiptSourceSchema>;

export const ExpectedReceiptRowSchema = z.object({
  expectedDate: IsoDateSchema,
  amount: z.number(),
  currency: CurrencyCodeSchema,
  account: AccountNameSchema,
  source: ExpectedReceiptSourceSchema,
  contractId: ContractIdSchema.nullable(),
  invoiceId: z.string().nullable(),
});
export type ExpectedReceiptRow = z.infer<typeof ExpectedReceiptRowSchema>;

export const ExpectedReceiptsResponseSchema = z.object({
  asOf: IsoDateSchema,
  horizon: IsoDateSchema,
  receipts: z.array(ExpectedReceiptRowSchema),
});
export type ExpectedReceiptsResponse = z.infer<typeof ExpectedReceiptsResponseSchema>;

export const AiSpendRateSplitSchema = z.object({
  personalDiscretionary: z.number(),
  personalMandatory: z.number(),
  businessDiscretionary: z.number(),
  businessMandatory: z.number(),
});
export type AiSpendRateSplit = z.infer<typeof AiSpendRateSplitSchema>;

export const AiSpendRateResponseSchema = z.object({
  generatedAt: z.string(),
  schemaVersion: z.string(),
  windowDays: z.number().int().positive(),
  currency: z.literal('GBP'),
  perDay: z.number(),
  perWeek: z.number(),
  perMonth: z.number(),
  split: AiSpendRateSplitSchema,
});
export type AiSpendRateResponse = z.infer<typeof AiSpendRateResponseSchema>;

export const AiFutureIncomeMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amountGbp: z.number(),
});
export type AiFutureIncomeMonth = z.infer<typeof AiFutureIncomeMonthSchema>;

export const AiFutureIncomeClientSchema = z.object({
  clientId: z.string().nullable(),
  label: z.string(),
  /** Gross (before VAT/CT) total in GBP for this client in the window. */
  totalGbp: z.number(),
  /** After-tax retained total in GBP (matches the funds headline semantics). */
  retainedGbp: z.number(),
});
export type AiFutureIncomeClient = z.infer<typeof AiFutureIncomeClientSchema>;

/** @deprecated Use {@link AiFutureIncomeClientSchema} — breakdown is grouped by client, not contract. */
export const AiFutureIncomeContractSchema = AiFutureIncomeClientSchema;
export type AiFutureIncomeContract = AiFutureIncomeClient;

export const AiLastContractPaymentSchema = z.object({
  date: IsoDateSchema,
  amountGbp: z.number(),
  label: z.string(),
});
export type AiLastContractPayment = z.infer<typeof AiLastContractPaymentSchema>;

export const AiAvailableFundsResponseSchema = z.object({
  generatedAt: z.string(),
  schemaVersion: z.string(),
  months: z.number().int(),
  projectionEndDate: IsoDateSchema,
  availableNowGbp: z.number(),
  confirmedFutureIncomeGrossGbp: z.number(),
  confirmedFutureIncomeRetainedGbp: z.number(),
  futureIncomeVatReserveGbp: z.number(),
  futureIncomeCtReserveGbp: z.number(),
  futureIncome: z.array(ExpectedReceiptRowSchema),
  futureIncomeByMonth: z.array(AiFutureIncomeMonthSchema),
  futureIncomeByClient: z.array(AiFutureIncomeClientSchema),
  /** @deprecated Prefer {@link futureIncomeByClient}. */
  futureIncomeByContract: z.array(AiFutureIncomeClientSchema),
  nextIncomeDate: z.string().nullable(),
  lastConfirmedIncomeDate: z.string().nullable(),
  committedOutflowsGbp: z.number(),
  /** Full horizon-scoped committed-outflows breakdown so the dashboard panel re-scopes with the toggle. */
  committedOutflows: LiquidityCommitmentsOverviewSchema,
  totalFundsGbp: z.number(),
  netAfterCommitmentsGbp: z.number(),
  lastContractPayment: AiLastContractPaymentSchema.nullable(),
});
export type AiAvailableFundsResponse = z.infer<typeof AiAvailableFundsResponseSchema>;

export const AiUpcomingMonthBucketSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  expensesGbp: z.number(),
  incomeGbp: z.number(),
  net: z.number(),
});

export const AiUpcomingResponseSchema = z.object({
  generatedAt: z.string(),
  schemaVersion: z.string(),
  asOf: IsoDateSchema,
  months: z.number().int().positive(),
  buckets: z.array(AiUpcomingMonthBucketSchema),
  totals: z.object({
    expensesGbp: z.number(),
    incomeGbp: z.number(),
    net: z.number(),
  }),
});
export type AiUpcomingResponse = z.infer<typeof AiUpcomingResponseSchema>;

export const SurvivalEssentialOverrideSchema = z.object({
  category: z.string().optional(),
  merchant: z.string().optional(),
  weeklyAmountGbp: z.coerce.number().nonnegative().optional(),
  monthlyAmountGbp: z.coerce.number().nonnegative().optional(),
});

export const AiSurvivalGivenSchema = z.object({
  dailyDiscretionary: z.number(),
  survivalDateCashOnly: z.string().nullable(),
  survivalDateCreditIncluded: z.string().nullable(),
  daysOfSurvival: z.number().nullable(),
});

export const AiSurvivalResponseSchema = z.object({
  generatedAt: z.string(),
  schemaVersion: z.string(),
  today: IsoDateSchema,
  scope: z.enum(['personal', 'household']),
  essentialsMonthlyGbp: z.number(),
  confirmedFutureIncome: z.array(ExpectedReceiptRowSchema),
  availableCreditGbp: z.number(),
  given: AiSurvivalGivenSchema.optional(),
  solveForTarget: z.object({
    targetDate: IsoDateSchema,
    maxDailyDiscretionary: z.number(),
  }).optional(),
  appliedOverrides: z.array(SurvivalEssentialOverrideSchema),
  narrative: z.string(),
});
export type AiSurvivalResponse = z.infer<typeof AiSurvivalResponseSchema>;

export const AiSpendAllowancePlanSchema = z.object({
  startDate: IsoDateSchema,
  dailyAmount: z.number(),
  scope: z.enum(['personal', 'household']),
});

export const AiSpendAllowanceResponseSchema = z.object({
  generatedAt: z.string(),
  schemaVersion: z.string(),
  plan: AiSpendAllowancePlanSchema,
  period: z.enum(['today', 'week']),
  accruedAllowanceGbp: z.number(),
  spentGbp: z.number(),
  remainingGbp: z.number(),
  status: z.enum(['on-track', 'overspent', 'ahead']),
  tomorrowAllowanceGbp: z.number(),
});
export type AiSpendAllowanceResponse = z.infer<typeof AiSpendAllowanceResponseSchema>;

export const SurvivalPlanCommitBodySchema = z.object({
  startDate: IsoDateSchema,
  dailyAmount: z.coerce.number().nonnegative(),
  scope: z.enum(['personal', 'household']).default('personal'),
  note: z.string().default(''),
  confirmedInChat: z.literal(true),
  narrativeBasis: z.string().optional(),
});

export const SurvivalPlanGetResponseSchema = z.object({
  plan: AiSpendAllowancePlanSchema.extend({
    note: z.string(),
    active: z.boolean(),
  }).nullable(),
});
export type SurvivalPlanGetResponse = z.infer<typeof SurvivalPlanGetResponseSchema>;

/** MCP composite `household_financial_posture` — orchestration envelope (no HTTP route). */
export const HouseholdFinancialPostureDeltasCategorySchema = z.object({
  category: z.string(),
  current: z.number(),
  previous: z.number(),
  deltaPct: z.number().nullable(),
  flagged: z.boolean(),
});

export const HouseholdFinancialPostureDeltasSchema = z.object({
  income: z.object({ current: z.number(), previous: z.number(), deltaPct: z.number().nullable() }),
  expenses: z.object({ current: z.number(), previous: z.number(), deltaPct: z.number().nullable() }),
  byCategory: z.array(HouseholdFinancialPostureDeltasCategorySchema),
});
export type HouseholdFinancialPostureDeltas = z.infer<typeof HouseholdFinancialPostureDeltasSchema>;

export const HouseholdFinancialPostureResponseSchema = z.object({
  generatedAt: z.string(),
  financialSafety: AiFinancialSafetyResponseSchema,
  dashboardSummary: DashboardSummaryResponseSchema,
  balancesByAccount: z.record(z.string(), AccountBalanceSchema).optional(),
  runway: RunwayResponseSchema.optional(),
  incomeComposition: IncomeCompositionResponseSchema.optional(),
  spendRate: AiSpendRateResponseSchema.optional(),
  deltas: HouseholdFinancialPostureDeltasSchema.optional(),
});
export type HouseholdFinancialPostureResponse = z.infer<typeof HouseholdFinancialPostureResponseSchema>;

// ---------------------------------------------------------------------------
// §2.0.E AI slices (same leaf types as product routes; composition-only envelopes)
// ---------------------------------------------------------------------------

export const AiEntityBalancesSchema = z.object({
  entityId: EntityIdSchema,
  accountNames: z.array(AccountNameSchema),
  balances: z.record(z.string(), AccountBalanceSchema),
});

export const AiLiquidityResponseSchema = z.object({
  today: IsoDateSchema,
  balances: z.record(z.string(), AccountBalanceSchema),
  liquidityOverview: LiquidityOverviewSchema,
  liquidityCommitments: LiquidityCommitmentsOverviewSchema.nullable(),
  taxLiabilities: TaxLiabilitiesSchema,
  byEntity: z.record(EntityIdSchema, AiEntityBalancesSchema).optional(),
});
export type AiLiquidityResponse = z.infer<typeof AiLiquidityResponseSchema>;

export const AiPipelineRowSchema = z.object({
  date: IsoDateSchema,
  amount: z.number(),
  currency: CurrencyCodeSchema,
  account: AccountNameSchema,
  kind: z.enum(['obligation', 'expected-receipt']),
  label: z.string(),
  obligationId: z.string().nullable(),
  /** Set for `expected-receipt` rows; null for obligations. */
  receiptSource: ExpectedReceiptSourceSchema.nullable(),
  obligationType: ObligationTypeSchema.nullable(),
  contractId: ContractIdSchema.nullable(),
  invoiceId: z.string().nullable(),
});
export type AiPipelineRow = z.infer<typeof AiPipelineRowSchema>;

export const AiPipelineResponseSchema = z.object({
  asOf: IsoDateSchema,
  horizon: IsoDateSchema,
  rows: z.array(AiPipelineRowSchema),
});
export type AiPipelineResponse = z.infer<typeof AiPipelineResponseSchema>;

export const AiSnapshotResponseSchema = z.object({
  generatedAt: z.string(),
  schemaVersion: z.string(),
  liquidity: AiLiquidityResponseSchema,
  pipeline: AiPipelineResponseSchema,
  runway: RunwayResponseSchema,
});
export type AiSnapshotResponse = z.infer<typeof AiSnapshotResponseSchema>;

/** Near-term obligation outflows from the AI pipeline (GBP). */
export const AiFinancialSnapshotCommitmentWindowSchema = z.object({
  days: z.number().int().positive(),
  endDate: IsoDateSchema,
  /** Sum of obligation rows due in [today, endDate], converted to GBP. */
  committedOutflowsGbp: z.number(),
});

/** §2.1 discretionary headline — complements 12‑month `liquidityCommitments`. */
export const AiFinancialSnapshotDiscretionarySchema = z.object({
  totalCashGbp: z.number(),
  cashAfter12MonthCommitmentsGbp: z.number(),
  /**
   * `totalCashGbp − committedOutflowsGbp` for the near-term window (obligation
   * pipeline rows only — excludes recurring items not on the pipeline).
   */
  cashAfterNearTermWindowGbp: z.number(),
  nearTermWindowDays: z.number().int().positive(),
  note: z.string(),
});

export const AiFinancialSnapshotIncomeSchema = z.object({
  outstandingInvoices: z.object({
    count: z.number().int().nonnegative(),
    totalOutstandingGbp: z.number(),
  }),
  accrual: z.object({
    today: IsoDateSchema,
    entityRollupCount: z.number().int().nonnegative(),
    totals: AggregateAccrualTotalsSchema.nullable(),
  }),
  /** Worked-but-not-invoiced accrual (owed window, capped today), retained after VAT/CT, GBP. */
  retainedAccruedToDateGbp: z.number(),
  /** Earned-but-unbanked income: unpaid invoices (full) + retainedAccruedToDateGbp. GBP. */
  earnedReceivablesGbp: z.number(),
});

export const AiFinancialSnapshotSpendVsBudgetSchema = z.object({
  financialYear: z.string().nullable(),
  selectedAccount: AccountNameSchema.optional(),
  budgetNudgeCount: z.number().int().nonnegative(),
  topNudges: z.array(BudgetNudgeSchema),
  insightNote: z.string(),
});

export const AiFinancialSnapshotVerdictSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('safe'),
    reasons: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('runway_stressed'),
    reasons: z.array(z.string()),
    firstStressDateFullRecurring: z.string().nullable(),
    runwayMonthsFullRecurring: z.number().nullable(),
    deficitInDays: z.number().int().nonnegative().nullable(),
  }),
  z.object({
    kind: z.literal('deficit_imminent'),
    reasons: z.array(z.string()),
    firstStressDateFullRecurring: z.string(),
    runwayMonthsFullRecurring: z.number().nullable(),
    deficitInDays: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('negative_after_commitments'),
    reasons: z.array(z.string()),
    cashAfter12MonthCommitmentsGbp: z.number(),
    /** cashAfter12MonthCommitmentsGbp + earnedReceivablesGbp; still < 0 in this branch. */
    resourcesAfterCommitmentsGbp: z.number(),
  }),
]);

/** §2.1 single composed read for affordability / commitment questions. */
export const AiFinancialSnapshotResponseSchema = z.object({
  generatedAt: z.string(),
  schemaVersion: z.string(),
  liquidity: AiLiquidityResponseSchema,
  commitmentWindow: AiFinancialSnapshotCommitmentWindowSchema,
  runway: RunwayResponseSchema,
  income: AiFinancialSnapshotIncomeSchema,
  discretionary: AiFinancialSnapshotDiscretionarySchema,
  spendVsBudget: AiFinancialSnapshotSpendVsBudgetSchema,
  verdict: AiFinancialSnapshotVerdictSchema,
});
export type AiFinancialSnapshotResponse = z.infer<typeof AiFinancialSnapshotResponseSchema>;
export type AiFinancialSnapshotVerdict = z.infer<typeof AiFinancialSnapshotVerdictSchema>;

export const AiManifestSliceSchema = z.object({
  method: z.literal('GET'),
  path: z.string(),
  queryParams: z.array(z.string()),
  responseSchemaExport: z.string(),
  /** MCP tool name that mirrors this slice with the same validation (Hermes clients). */
  mcpTool: z.string().optional(),
});

export const AiManifestResponseSchema = z.object({
  schemaVersion: z.string(),
  description: z.string(),
  slices: z.array(AiManifestSliceSchema),
  /** Zod schema export names in `shared/api-contracts.ts` that define slice wire shapes. */
  contractSchemaExports: z.array(z.string()),
});
export type AiManifestResponse = z.infer<typeof AiManifestResponseSchema>;

/** §1.9 debt-strategy read bundle (`GET /api/debt-strategy/state`, AI mirror). */
export const DebtStrategyStateResponseSchema = z.record(z.string(), z.unknown());
export type DebtStrategyStateResponse = z.infer<typeof DebtStrategyStateResponseSchema>;

/** Default overview + recurring + ad-hoc spend (`GET /api/ai/spend-context`). */
export const AiSpendContextResponseSchema = z.object({
  overview: ExpensesSheetResponseSchema,
  recurring: RecurringExpensesResponseSchema,
  adHoc: AdHocExpensesResponseSchema,
});
export type AiSpendContextResponse = z.infer<typeof AiSpendContextResponseSchema>;

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
 * Invoice primary key. La Fosse self-bills use `EG-####` (Edwin Group
 * end client). Delta Capita supplier invoices use `DC-###`. FZCO-only
 * flows may use `FZ-####`; other UK Ltd clients may use `UK-####`.
 */
export const InvoiceIdSchema = z
  .string()
  .regex(/^(?:(?:UK|FZ|EG)-\d{4}|DC-\d{3})$/);
export type InvoiceId = z.infer<typeof InvoiceIdSchema>;

/**
 * Invoice lifecycle. `overdue` is intentionally NOT a stored status —
 * it is derived as `due_date < today AND status !== 'paid'` at read
 * time so a single source of truth (`due_date`) drives the flag.
 */
export const InvoiceStatusSchema = z.enum(['draft', 'issued', 'paid', 'partial']);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

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
  /**
   * FK to the bank-side ledger via the stable content `transactions.hash`
   * (not the volatile autoincrement `transactions.id`, which is reassigned
   * on every feed re-sync).
   */
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

/** Invoice row plus whether an archived PDF exists on disk (list API only). */
export const InvoiceListItemSchema = InvoiceSchema.extend({
  stored_pdf_available: z.boolean(),
});
export type InvoiceListItem = z.infer<typeof InvoiceListItemSchema>;

/** Response shape of `GET /api/invoices`. */
export const InvoicesListResponseSchema = z.object({
  invoices: z.array(InvoiceListItemSchema),
});
export type InvoicesListResponse = z.infer<typeof InvoicesListResponseSchema>;

/** One missing calendar month for a monthly supplier-issued contract. */
export const SupplierMonthGapSchema = z.object({
  contract_id: ContractIdSchema,
  client_id: ClientIdSchema,
  month_start: IsoDateSchema,
  month_end: IsoDateSchema,
});
export type SupplierMonthGap = z.infer<typeof SupplierMonthGapSchema>;

export const SupplierMonthGapsResponseSchema = z.object({
  gaps: z.array(SupplierMonthGapSchema),
});
export type SupplierMonthGapsResponse = z.infer<
  typeof SupplierMonthGapsResponseSchema
>;

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

export const ReportingRegimeSchema = z.enum(['vat', 'corporation_tax']);
export type ReportingRegime = z.infer<typeof ReportingRegimeSchema>;

export const ReportingDocTypeSchema = z.enum(['pdf', 'csv']);
export type ReportingDocType = z.infer<typeof ReportingDocTypeSchema>;

/** One missing/present document slot in a reporting readiness report. */
export const ReportingReadinessItemSchema = z.object({
  account: AccountNameSchema,
  accountLabel: z.string().min(1),
  monthKey: z.string().regex(/^\d{4}-\d{2}$/),
  docType: ReportingDocTypeSchema,
});
export type ReportingReadinessItem = z.infer<typeof ReportingReadinessItemSchema>;

/** Per-account rollup for dashboards (includes complete accounts, not only gaps). */
export const ReportingAccountOverviewSchema = z.object({
  account: AccountNameSchema,
  accountLabel: z.string().min(1),
  ready: z.boolean(),
  missingDocCount: z.number().int().nonnegative(),
});
export type ReportingAccountOverview = z.infer<typeof ReportingAccountOverviewSchema>;

export const ReportingReadinessResponseSchema = z.object({
  entityId: EntityIdSchema,
  regime: ReportingRegimeSchema,
  periodLabel: z.string().min(1),
  periodStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ready: z.boolean(),
  accountsOverview: z.array(ReportingAccountOverviewSchema),
  present: z.array(ReportingReadinessItemSchema),
  missing: z.array(ReportingReadinessItemSchema),
  invoices: z.object({
    requiredCount: z.number().int().nonnegative(),
    presentCount: z.number().int().nonnegative(),
    missingInvoiceNumbers: z.array(z.string()),
  }),
  generatedAt: z.string(),
});
export type ReportingReadinessResponse = z.infer<typeof ReportingReadinessResponseSchema>;

export const FinancialYearReadinessOverviewSchema = z.object({
  entityId: EntityIdSchema,
  financialYear: z.string().min(1),
  corporationTax: ReportingReadinessResponseSchema,
  vatQuarters: z.array(
    z.object({
      periodLabel: z.string().min(1),
      readiness: ReportingReadinessResponseSchema,
    }),
  ),
  aggregate: z.object({
    ready: z.boolean(),
    missingDocCount: z.number().int().nonnegative(),
    missingInvoiceCount: z.number().int().nonnegative(),
    missingInvoiceNumbers: z.array(z.string()),
  }),
  recommendedNextSteps: z.array(z.string()),
  generatedAt: z.string(),
});
export type FinancialYearReadinessOverview = z.infer<typeof FinancialYearReadinessOverviewSchema>;

export const EntityFoundationWarningCodeSchema = z.enum([
  // §1.1 + earlier
  'company-tbc-fields',
  'client-tbc-fields',
  'contract-ending-soon',
  'fzco-ct-status-unknown',
  'fzco-vat-voluntary-threshold-crossed',
  'fzco-vat-mandatory-threshold-crossed',
  'ifza-license-renewal-due',
  'inter-company-movement-unclassified',
  'payment-outside-contract-window',
  'invoice-stale-payment-reference',
  'invoice-overdue',
  'invoice-period-invalid',
  'invoice-unmatched-deposit',
  'invoice-reference-amount-mismatch',
  'invoice-reference-ambiguous',
  'invoice-days-mismatch',
  // §1.6 (runway thresholds)
  'runway-low',
  'runway-mandatory-low',
  'trapped-cash',
  // §1.7 (income composition risk signals)
  'client-concentration-extreme',
  'client-concentration-elevated',
  'time-independence-low',
  'time-independence-elevated',
  'mode-concentration-extreme',
  'passive-income-zero',
  'leveraged-passive-income',
  // §1.8 new
  'tax-reserve-underfunded',
  'tax-reserve-trajectory-missing',
  'tax-reserve-pool-underfunded',
  'ad-hoc-spend-escalating',
  'warning-improved',
  'warning-cleared',
  // §1.9 — Debt Strategy Advisor
  'account-credit-card-config-missing',
  'credit-card-recurring-spend',
  'plan-blocked-incomplete-budgets',
  'plan-blocked-fzco-no-savings-account',
  'mortgage-rate-reset-soon',
  'debt-unregistered',
  'plan-feasibility-degraded',
  'plan-budget-blown',
  'plan-transfer-not-set-up',
  'plan-transfer-missed',
  'plan-standing-order-can-be-stopped',
  'plan-infeasible',
  'plan-target-reached',
  // reporting readiness packs
  'accountant-pack-incomplete-vat',
  'accountant-pack-incomplete-ct',
  // scheduled AISP feed sync (in-process scheduler)
  'feed-sync-scheduled-failed',
  'feed-sync-overdue',
]);
export type EntityFoundationWarningCode = z.infer<typeof EntityFoundationWarningCodeSchema>;

/**
 * Primitive types accepted in `EntityFoundationWarning.context`.
 *
 * `context` carries the raw numbers/strings the warning was derived from
 * (numerator, denominator, threshold, ratio, propertyId, merchant, etc.)
 * so AI/MCP/future consumers can reason about the warning without
 * parsing the rendered prose. Existing UI keeps reading
 * `title/detail/recommended_action` strings; nothing breaks.
 *
 * Kept deliberately flat (no nested objects) so JSON consumers don't
 * have to walk a tree to find primitives.
 */
const WarningContextValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.null(),
]);

/** §2.3 — machine-actionable handles (nullable where unused). */
export const WarningLinksSchema = z.object({
  obligationId: z.string().nullable().optional(),
  contractId: z.string().nullable().optional(),
  invoiceId: z.string().nullable().optional(),
  debtId: z.string().nullable().optional(),
  planId: z.string().nullable().optional(),
  movementId: z.string().nullable().optional(),
});
export type WarningLinks = z.infer<typeof WarningLinksSchema>;

/** §2.3 — normalised urgency for agents (no prose parsing). */
export const WarningUrgencySchema = z.object({
  band: z.enum(['overdue', 'due_soon', 'stress_soon', 'routine']),
  dueDate: z.string().nullable().optional(),
  daysOverdue: z.number().int().nullable().optional(),
  stressDate: z.string().nullable().optional(),
});
export type WarningUrgency = z.infer<typeof WarningUrgencySchema>;

/** §2.3 — small hint enum; maps to product routes / future MCP tools. */
export const WarningActionHintSchema = z.enum([
  'open_obligations',
  'open_deadlines',
  'review_contracts',
  'reconcile_invoices',
  'open_debt_strategy',
  'review_budgets',
  'review_tax_reserve',
  'review_company_settings',
  'review_clients',
  'record_bank_payment',
  'review_runway_forecast',
  'classify_transactions',
]);
export type WarningActionHint = z.infer<typeof WarningActionHintSchema>;

export const WarningUserStateSchema = z.object({
  snoozedUntil: z.string().nullable().optional(),
  acknowledgedAt: z.string().nullable().optional(),
  surface: z.enum(['dashboard', 'agent', 'both']).nullable().optional(),
});
export type WarningUserState = z.infer<typeof WarningUserStateSchema>;

/** §2.3 — upsert body for `PUT /api/warnings/user-state`. */
export const WarningUserStateUpsertBodySchema = z.object({
  fingerprint: z.string().min(16).max(64),
  snoozedUntil: z.string().nullable().optional(),
  acknowledgedAt: z.string().nullable().optional(),
  surface: z.enum(['dashboard', 'agent', 'both']).nullable().optional(),
  /** When true, clears `snoozedUntil` (keeps other fields). */
  clearSnooze: z.boolean().optional(),
});
export type WarningUserStateUpsertBody = z.infer<typeof WarningUserStateUpsertBodySchema>;

export const EntityFoundationWarningSchema = z.object({
  id: z.string().min(1),
  code: EntityFoundationWarningCodeSchema,
  severity: WarningSeveritySchema,
  title: z.string().min(1),
  detail: z.string().min(1),
  recommended_action: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
  /**
   * Optional. When present, the entity this warning is scoped to (or
   * `null` for explicitly household-level warnings). Drives the entity
   * filter on the Warnings tab. Omitted by legacy emitters that don't
   * carry an entity discriminator — those rows fall through any filter.
   */
  entityId: EntityIdSchema.nullable().optional(),
  /**
   * Optional. Flat dictionary of the primitive values the warning was
   * derived from (e.g. `{ ratio: 1.0, topClientId: 'delta-capita',
   * threshold: 0.8 }`). Same convention as 1.7's `RiskSignal` data
   * fields — the canonical place for AI / future surfaces to read the
   * numbers without parsing prose. Optional for backward compatibility;
   * legacy emitters keep populating only the strings.
   */
  context: z.record(z.string(), WarningContextValueSchema).optional(),
  /** §2.3 — stable identity; same algorithm as `warning_snapshots` fingerprint. */
  fingerprint: z.string().min(16).max(64).optional(),
  links: WarningLinksSchema.optional(),
  urgency: WarningUrgencySchema.optional(),
  actionHints: z.array(WarningActionHintSchema).optional(),
  firstSeenAt: z.string().optional(),
  lastActiveAt: z.string().optional(),
  userState: WarningUserStateSchema.optional(),
});
export type EntityFoundationWarning = z.infer<typeof EntityFoundationWarningSchema>;

/**
 * Forward-naming alias. As the warnings spine consolidates more sources
 * (1.6 runway, 1.7 risk signals, tax reserve, ad-hoc spend) the
 * `EntityFoundationWarning` name no longer reflects the scope. New code
 * should import `Warning` / `WarningSchema`; the legacy names stay for
 * back-compat and are removed in a future cleanup pass.
 */
export const WarningSchema = EntityFoundationWarningSchema;
export type Warning = EntityFoundationWarning;

export const EntityFoundationWarningsResponseSchema = z.object({
  warnings: z.array(EntityFoundationWarningSchema),
});
export type EntityFoundationWarningsResponse = z.infer<typeof EntityFoundationWarningsResponseSchema>;

export const WarningsResponseSchema = EntityFoundationWarningsResponseSchema;
export type WarningsResponse = EntityFoundationWarningsResponse;

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
export type LiquidityCommitmentLine = z.infer<typeof LiquidityCommitmentLineSchema>;
export type LiquidityCommitmentsOverview = z.infer<typeof LiquidityCommitmentsOverviewSchema>;
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
export type ObligationPaymentCandidate = z.infer<typeof ObligationPaymentCandidateSchema>;
export type ObligationPaymentCandidatesResponse = z.infer<typeof ObligationPaymentCandidatesResponseSchema>;
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
export type DebtSemanticKind = z.infer<typeof DebtSemanticKindSchema>;
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
