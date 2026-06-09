/**
 * Shared accumulation + classification pipeline used by both /overview and /recurring routes.
 * Eliminates ~200 lines of duplication by parameterising the differences:
 *   - which transactions to scope (rolling window vs FY)
 *   - which transactions to attach for all-time annual detection
 *   - whether to include income accumulators
 *   - whether to filter pass-through IDs
 */

import { getAccountConfig, isValidAccountName } from '../domain/accounts/index.js';
import { categorizeTransaction, categoryColour } from './categorizer.js';
import type { CategoryName } from './categorizer.js';
import { normalizeMerchant } from './merchant-normalizer.js';
import { classifyRecurring } from './recurring-detector.js';
import type { RecurringCandidate, TransactionDetail } from './recurring-detector.js';
import { getMerchantLogoUrl } from './merchant-logos.js';
import type { RecurringExpense } from '../../shared/api-contracts.js';
import { round2, monthKeyFromIsoDate } from './math.js';
import { SPECIAL_CATEGORY } from './category-constants.js';
import { resolveExpenseCategoryWithPayroll, type PayrollEntry } from '../domain/payroll/index.js';
import { convertAmountSync } from '../config/exchange-rates.js';
import type { CurrencyCode } from '../types.js';
import { getObligationRegistry, type ObligationRegistry } from '../domain/obligations/registry.js';
import type { OutgoingObligation, IncomingObligation } from '../../shared/api-contracts.js';
import { obligationActiveForProjection } from '../domain/obligations/obligation-active.js';
import { assertNever } from './assert-never.js';
import { findMatchingDebt, type DebtMatchable } from '../domain/debts/match-transaction.js';
import { readDebtsFromCsvFile, getDebtsCsvPath } from '../db/debts-csv.js';
import { DEBTS_DIR } from '../db/connection.js';

type RentalIncomeObligation = Extract<IncomingObligation, { category: 'rental-income' }>;

function loadActiveDebtsFromCsv(): readonly DebtMatchable[] {
  return readDebtsFromCsvFile(getDebtsCsvPath(DEBTS_DIR)).filter(d => !d.archived);
}

/** Same payee rule as {@link sumRentalIncomeForPerson}: `description LIKE %merchant%`. */
function rentalTxnMatchesObligation(
  description: string,
  obligation: RentalIncomeObligation,
  account: string,
): boolean {
  if (obligation.account !== account) return false;
  return description.toUpperCase().includes(obligation.merchant.toUpperCase());
}

function rentalCandidatesForTxn(
  registry: ObligationRegistry,
  description: string,
  account: string,
  activeOnly: boolean,
): readonly RentalIncomeObligation[] {
  return registry
    .listByCategory('rental-income')
    .filter(c => (activeOnly ? obligationActiveForProjection(c) : !obligationActiveForProjection(c)))
    .filter(c => rentalTxnMatchesObligation(description, c, account));
}

/**
 * Amount-aware rental selector: a single payee on one account can host
 * multiple rental properties (multi-unit portfolios), so we pick the one
 * whose declared amount is closest to the observed transaction.
 */
function closestRentalIncome(
  registry: ObligationRegistry,
  description: string,
  account: string,
  amount: number,
): RentalIncomeObligation | null {
  const candidates = rentalCandidatesForTxn(registry, description, account, true);
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestDiff = Math.abs(amount - best.amount);
  for (let i = 1; i < candidates.length; i++) {
    const diff = Math.abs(amount - candidates[i].amount);
    if (diff < bestDiff) {
      best = candidates[i];
      bestDiff = diff;
    }
  }
  return best;
}

export interface RawTransaction {
  id: number;
  /** Stable hash — optional for legacy callers; enables per-transaction category overrides. */
  hash?: string;
  date: string;
  description: string;
  amount: number;
  account: string;
  type: 'income' | 'expense' | 'transfer';
}

export interface Accumulator {
  merchant: string;
  category: CategoryName;
  sourceAccount: string;
  accountCategory: 'personal' | 'business';
  monthlyTotals: Map<string, number>;
  annualTotal: number;
  transactions: TransactionDetail[];
  /**
   * Declared obligation id linked at accumulation time. Payroll matching
   * is person-driven (via description aliases, not merchant equality), so
   * the accumulator's display merchant ("Director salary — David") does
   * not equal the obligation's merchant ("David Morrison"). Stashing the
   * id directly here lets {@link partitionExpenseAccumulators} recognise
   * the accumulator as already declared without a second fuzzy lookup.
   */
  obligationId?: string;
  /**
   * Debt id linked at accumulation time when the transaction matches an
   * exact `matchAmounts` entry from `debts.csv`.
   */
  debtId?: string;
}

export interface PipelineResult {
  expenseCandidates: RecurringCandidate[];
  incomeCandidates: RecurringCandidate[];
  expenseAccumulators: Map<string, Accumulator>;
  incomeAccumulators: Map<string, Accumulator>;
  monthlyExpenseRecurring: RecurringExpense[];
  annualExpenseRecurring: RecurringExpense[];
  monthlyIncomeRecurring: RecurringExpense[];
  annualIncomeRecurring: RecurringExpense[];
  monthsCovered: number;
}

export interface PipelineConfig {
  scopedTransactions: RawTransaction[];
  allTimeTransactions: RawTransaction[];
  passThroughIds?: Set<number>;
  includeIncome: boolean;
  /**
   * Restrict declared-outgoing emission to these accounts. When undefined
   * (all-accounts overview mode), every declared outgoing obligation is
   * surfaced. When provided (single-account view), only obligations whose
   * `account` is in this list appear on Fixed Expenses. Prevents cross-
   * account leakage (e.g. Orient Insurance on emirates-islamic appearing
   * on a Barclays-only view).
   */
  accountScope?: readonly string[];
  /**
   * Active debts for exact-amount matching. When omitted, loaded from the
   * debts registry ({@link listDebts}). Tests inject fixtures here.
   */
  debts?: readonly DebtMatchable[];
}

export function amountBucket(amount: number): number {
  if (amount < 1) return 0;
  return Math.round(Math.log(amount) * 5);
}

export function accKey(category: string, merchant: string, account: string, amount: number): string {
  return `${category}|${merchant}|${account}|${amountBucket(amount)}`;
}

export function recurringKey(e: RecurringExpense): string {
  const skipAmount =
    e.declaredDebtId !== undefined
    || e.category === SPECIAL_CATEGORY.property
    || e.category === SPECIAL_CATEGORY.payroll;
  return accKey(e.category, e.merchant, e.sourceAccount, skipAmount ? 0 : e.amount);
}

/** Classify a transaction as expense, income, or null (zero-amount transfer). */
export function classifyTransactionSide(txn: { type: string; amount: number }): 'expense' | 'income' | null {
  if (txn.type === 'expense' || (txn.type === 'transfer' && txn.amount < 0)) return 'expense';
  if (txn.type === 'income' || (txn.type === 'transfer' && txn.amount > 0)) return 'income';
  return null;
}

interface AccumulationRow {
  category: CategoryName;
  displayMerchant: string;
  keyAmount: number;
  /** Obligation id when the transaction maps to a declared outgoing obligation. */
  obligationId?: string;
  /** Debt id when the transaction matches a declared debt payment amount. */
  debtId?: string;
}

/** Registry category + payroll config override + rental display (same loop as Pass 1 / Pass 2). */
function rowForAccumulation(
  txn: RawTransaction,
  side: 'expense' | 'income',
  debts: readonly DebtMatchable[],
): AccumulationRow | null {
  const merchant = normalizeMerchant(txn.description);
  const absAmount = Math.abs(txn.amount);
  const account = txn.account;

  let category = categorizeTransaction(txn.description, txn.hash ? { hash: txn.hash } : undefined);
  let payrollHit: PayrollEntry | null = null;
  if (side === 'expense') {
    const resolved = resolveExpenseCategoryWithPayroll(
      txn.description,
      account,
      absAmount,
      category,
    );
    category = resolved.category;
    payrollHit = resolved.payrollHit;
  }
  if (category === SPECIAL_CATEGORY.transfers) return null;

  let displayMerchant = merchant;
  let keyAmount = absAmount;
  let obligationId: string | undefined;
  let debtId: string | undefined;
  if (payrollHit) {
    displayMerchant = payrollHit.displayName ?? payrollHit.merchant;
    keyAmount = 0;
    obligationId = payrollHit.id;
  }

  // Registry-first rental-income resolution: a matching `rental-income`
  // obligation drives both the category and display, even when the
  // string heuristic missed. Ended lets (`active=false`) are excluded
  // from Fixed Expenses forward income — historical SA sums still use
  // {@link sumRentalIncomeForPerson}. Boot-time {@link assertRentalMerchantsClassify}
  // keeps the two sources from diverging silently.
  if (side === 'income') {
    const registry = getObligationRegistry();
    if (rentalCandidatesForTxn(registry, txn.description, account, false).length > 0) {
      return null;
    }
    const prop = closestRentalIncome(registry, txn.description, account, absAmount);
    if (prop) {
      category = SPECIAL_CATEGORY.property;
      displayMerchant = prop.displayName ?? prop.merchant;
      keyAmount = 0;
      obligationId = prop.id;
    }
  }

  if (side === 'expense' && obligationId === undefined) {
    const matchedDebt = findMatchingDebt(
      { description: txn.description, account, amount: txn.amount, type: txn.type },
      debts,
    );
    // Mortgages only — consumer debts (BBL, BPF, etc.) keep the heuristic
    // detector so gradually-drifting payments still cluster by amount bucket.
    if (matchedDebt !== null && matchedDebt.kind === 'mortgage') {
      category = 'Housing';
      displayMerchant = matchedDebt.name;
      keyAmount = 0;
      debtId = matchedDebt.id;
    }
  }

  if (side === 'expense' && obligationId === undefined && debtId === undefined) {
    // Amount-aware lookup so two obligations sharing a (merchant, account)
    // pair (e.g. two Orient Insurance policies) route to the right one.
    const declared = getObligationRegistry().matchByMerchantAccount(merchant, account, absAmount);
    if (declared !== null && declared.category !== 'rental-income' && showOnFixedExpenses(declared)) {
      obligationId = declared.id;
      if (declared.category === 'fixed-bill') {
        keyAmount = 0;
      }
    }
  }

  return { category, displayMerchant, keyAmount, obligationId, debtId };
}

export interface AccumulationBucket {
  key: string;
  category: CategoryName;
  displayMerchant: string;
  keyAmount: number;
  obligationId?: string;
  debtId?: string;
}

/** Same bucketing as Pass 1 / Pass 2; use for tooling that must stay aligned with the pipeline. */
export function accumulationFromTxn(
  txn: RawTransaction,
  side: 'expense' | 'income',
  debts: readonly DebtMatchable[] = [],
): AccumulationBucket | null {
  const row = rowForAccumulation(txn, side, debts);
  if (!row) return null;
  return {
    key: accKey(row.category, row.displayMerchant, txn.account, row.keyAmount),
    category: row.category,
    displayMerchant: row.displayMerchant,
    keyAmount: row.keyAmount,
    obligationId: row.obligationId,
    debtId: row.debtId,
  };
}

export function accumulatorKeyForTxn(
  txn: RawTransaction,
  side: 'expense' | 'income',
  debts: readonly DebtMatchable[] = [],
): string | null {
  return accumulationFromTxn(txn, side, debts)?.key ?? null;
}

/**
 * Named routing filter for Fixed Expenses. Every outgoing category is
 * enumerated so adding a new category forces a routing decision at
 * compile time (see ADR 0001 §5). The sibling filter
 * {@link showOnObligationsTab} lives in `obligation-projection.ts`.
 *
 * Subscriptions and insurance surface on both views by design.
 */
export function showOnFixedExpenses(c: OutgoingObligation): boolean {
  switch (c.category) {
    case 'fixed-bill': return true;
    case 'subscription': return true;
    case 'insurance': return true;
    case 'payroll': return true;
    case 'tax-manual': return false;
    default: return assertNever(c);
  }
}

/**
 * Split expense accumulators into those satisfying a declared outgoing
 * obligation (so the declaration pass emits their row, enriched with
 * observed transaction context) and residual ones (passed to the detector
 * as unseen merchants). The link is established at accumulation time via
 * `Accumulator.obligationId` — no fuzzy re-matching here. An obligation is
 * claimed by at most one accumulator; when multiple map to the same id,
 * the first wins (deterministic by Map insertion order).
 */
function partitionExpenseAccumulators(
  accumulators: Map<string, Accumulator>,
): {
  declaredByObligationId: Map<string, Accumulator>;
  declaredByDebtId: Map<string, Accumulator>;
  residual: Map<string, Accumulator>;
} {
  const declaredByObligationId = new Map<string, Accumulator>();
  const declaredByDebtId = new Map<string, Accumulator>();
  const residual = new Map<string, Accumulator>();
  for (const [key, acc] of accumulators) {
    if (acc.obligationId !== undefined && !declaredByObligationId.has(acc.obligationId)) {
      declaredByObligationId.set(acc.obligationId, acc);
    } else if (acc.debtId !== undefined && !declaredByDebtId.has(acc.debtId)) {
      declaredByDebtId.set(acc.debtId, acc);
    } else {
      residual.set(key, acc);
    }
  }
  return { declaredByObligationId, declaredByDebtId, residual };
}

function partitionIncomeAccumulators(
  accumulators: Map<string, Accumulator>,
): {
  declaredByObligationId: Map<string, Accumulator>;
  residual: Map<string, Accumulator>;
} {
  return partitionExpenseAccumulators(accumulators);
}

function accumulatorsToCandidates(
  map: Map<string, Accumulator>,
): RecurringCandidate[] {
  const candidates: RecurringCandidate[] = [];
  for (const acc of map.values()) {
    const monthlyValues = Array.from(acc.monthlyTotals.values());
    const monthlyMax = monthlyValues.length > 0 ? Math.max(...monthlyValues) : 0;
    const monthlyAvg = monthlyValues.length > 0
      ? monthlyValues.reduce((s, v) => s + v, 0) / monthlyValues.length
      : 0;

    candidates.push({
      merchant: acc.merchant,
      category: acc.category,
      monthlyMax: round2(monthlyMax),
      monthlyAvg: round2(monthlyAvg),
      monthsActive: acc.monthlyTotals.size,
      annualTotal: round2(acc.annualTotal),
      sourceAccount: acc.sourceAccount,
      accountCategory: acc.accountCategory,
      transactions: acc.transactions,
    });
  }
  return candidates;
}

/**
 * Run the full accumulate-and-classify pipeline.
 *
 * Pass 1: build monthly totals from `scopedTransactions`.
 * Pass 2: attach all-time transaction details from `allTimeTransactions` (for annual detection).
 * Then classify via `classifyRecurring`.
 */
export function buildRecurringPipeline(config: PipelineConfig): PipelineResult {
  const { scopedTransactions, allTimeTransactions, passThroughIds, includeIncome, accountScope } = config;
  const debts = config.debts ?? loadActiveDebtsFromCsv();

  const expenseAccumulators = new Map<string, Accumulator>();
  const incomeAccumulators = new Map<string, Accumulator>();
  const allMonths = new Set<string>();

  // Pass 1: scoped transactions -> monthly totals
  for (const txn of scopedTransactions) {
    if (passThroughIds?.has(txn.id)) continue;

    const side = classifyTransactionSide(txn);
    if (!side) continue;
    if (side === 'income' && !includeIncome) continue;

    const bucket = accumulationFromTxn(txn, side, debts);
    if (!bucket) continue;

    const { key, category, displayMerchant, obligationId, debtId } = bucket;
    const account = txn.account;
    const accountCategory = isValidAccountName(account)
      ? getAccountConfig(account).category
      : 'personal';
    const absAmount = Math.abs(txn.amount);
    const ym = monthKeyFromIsoDate(txn.date);
    allMonths.add(ym);

    const map = side === 'income' ? incomeAccumulators : expenseAccumulators;
    let acc = map.get(key);
    if (!acc) {
      acc = {
        merchant: displayMerchant,
        category,
        sourceAccount: account,
        accountCategory,
        monthlyTotals: new Map(),
        annualTotal: 0,
        transactions: [],
      };
      if (obligationId !== undefined) acc.obligationId = obligationId;
      if (debtId !== undefined) acc.debtId = debtId;
      map.set(key, acc);
    }

    acc.annualTotal += absAmount;
    acc.monthlyTotals.set(ym, (acc.monthlyTotals.get(ym) ?? 0) + absAmount);
  }

  // Pass 2: all-time transactions -> attach for annual pattern detection
  for (const txn of allTimeTransactions) {
    const side = classifyTransactionSide(txn);
    if (!side) continue;
    if (side === 'income' && !includeIncome) continue;

    const bucket = accumulationFromTxn(txn, side, debts);
    if (!bucket) continue;

    const { key } = bucket;
    const absAmount = Math.abs(txn.amount);
    const map = side === 'income' ? incomeAccumulators : expenseAccumulators;
    const acc = map.get(key);
    if (!acc) continue;
    acc.transactions.push({ date: txn.date, amount: absAmount });
  }

  const monthsCovered = allMonths.size || 1;

  const registry = getObligationRegistry();

  // Declaration-first routing: a declared outgoing obligation always owns
  // its row on Fixed Expenses, emitted exactly once by
  // `buildDeclaredOutgoingRows`. The detector sees only residual accumulators
  // (merchants with no matching declaration), so it cannot emit a duplicate
  // row for the same underlying bill.
  const {
    declaredByObligationId,
    declaredByDebtId,
    residual: residualExpenseAccumulators,
  } = partitionExpenseAccumulators(expenseAccumulators);
  const { declaredByObligationId: declaredRentalById, residual: residualIncomeAccumulators } =
    includeIncome
      ? partitionIncomeAccumulators(incomeAccumulators)
      : { declaredByObligationId: new Map<string, Accumulator>(), residual: new Map<string, Accumulator>() };

  const expenseCandidates = accumulatorsToCandidates(residualExpenseAccumulators);
  const incomeCandidates = includeIncome
    ? accumulatorsToCandidates(residualIncomeAccumulators)
    : [];

  const { monthly: detectedMonthlyExpense, annual: detectedAnnualExpense } =
    classifyRecurring(expenseCandidates, monthsCovered);
  const { monthly: detectedMonthlyIncome, annual: annualIncomeRecurring } = includeIncome
    ? classifyRecurring(incomeCandidates, monthsCovered, new Date(), true)
    : { monthly: [], annual: [] };

  const { monthly: declaredMonthlyExpense, annual: declaredAnnualExpense } =
    buildDeclaredOutgoingRows(registry, declaredByObligationId, accountScope);
  const declaredMonthlyDebtExpense = buildDeclaredDebtExpenseRows(
    debts,
    declaredByDebtId,
    accountScope,
  );
  const declaredMonthlyRentalIncome = includeIncome
    ? buildDeclaredRentalIncomeRows(registry, declaredRentalById, accountScope)
    : [];

  const monthlyIncomeRecurring: RecurringExpense[] = [
    ...declaredMonthlyRentalIncome,
    ...detectedMonthlyIncome,
  ];

  const monthlyExpenseRecurring: RecurringExpense[] = [
    ...declaredMonthlyExpense,
    ...declaredMonthlyDebtExpense,
    ...detectedMonthlyExpense,
  ];
  const annualExpenseRecurring: RecurringExpense[] = [
    ...declaredAnnualExpense,
    ...detectedAnnualExpense,
  ];

  return {
    expenseCandidates,
    incomeCandidates,
    expenseAccumulators,
    incomeAccumulators,
    monthlyExpenseRecurring,
    annualExpenseRecurring,
    monthlyIncomeRecurring,
    annualIncomeRecurring,
    monthsCovered,
  };
}

/**
 * Declaration-first emission: one row per declared outgoing obligation that
 * routes to Fixed Expenses. When an accumulator satisfies the obligation,
 * the row is enriched from observed transactions (monthsActive, billing
 * date, category from the merchant registry). Otherwise the row is
 * synthesised from the obligation alone so the user sees what they have
 * declared before any matching transaction lands.
 *
 * Scope is honoured: when `accountScope` is defined, obligations on other
 * accounts are skipped (prevents cross-account leakage on single-account
 * views like the dashboard).
 */
/**
 * Declaration-first rental income: one row per active `rental-income`
 * obligation on Fixed Expenses (mirrors {@link buildDeclaredOutgoingRows}).
 * Ended lets stay in CSV for history but are omitted here.
 */
function buildDeclaredRentalIncomeRows(
  registry: ObligationRegistry,
  declaredByObligationId: Map<string, Accumulator>,
  accountScope: readonly string[] | undefined,
): RecurringExpense[] {
  const monthly: RecurringExpense[] = [];

  for (const obligation of registry.listByCategory('rental-income')) {
    if (!obligationActiveForProjection(obligation)) continue;
    if (obligation.frequency !== 'monthly') continue;
    if (obligation.account === undefined) continue;
    if (accountScope !== undefined && !accountScope.includes(obligation.account)) continue;

    const accumulator = declaredByObligationId.get(obligation.id) ?? null;
    monthly.push(buildDeclaredRentalIncomeRow(obligation, accumulator));
  }

  return monthly;
}

function buildDeclaredRentalIncomeRow(
  obligation: RentalIncomeObligation,
  accumulator: Accumulator | null,
): RecurringExpense {
  const currency: CurrencyCode = obligation.currency;
  const gbpAmount = currency === 'GBP'
    ? obligation.amount
    : convertAmountSync(obligation.amount, currency, 'GBP');
  const merchantLabel = obligation.displayName ?? obligation.merchant;

  const billingDayOfMonth = resolveRentalBillingDay(accumulator);

  const expense: RecurringExpense = {
    merchant: merchantLabel,
    category: SPECIAL_CATEGORY.property,
    colour: categoryColour(SPECIAL_CATEGORY.property),
    amount: round2(gbpAmount),
    frequency: 'monthly',
    monthsActive: accumulator?.monthlyTotals.size ?? 0,
    annualTotal: round2(gbpAmount * 12),
    logoUrl: getMerchantLogoUrl(merchantLabel),
    sourceAccount: obligation.account ?? '',
    billingDayOfMonth,
    billingMonth: null,
    declaredObligationId: obligation.id,
  };
  if (currency !== 'GBP') {
    expense.nativeAmount = round2(obligation.amount);
    expense.nativeCurrency = currency;
  }
  return expense;
}

function resolveRentalBillingDay(accumulator: Accumulator | null): number | null {
  if (!accumulator || accumulator.transactions.length === 0) return null;
  const mostRecent = accumulator.transactions.reduce((a, b) => (a.date > b.date ? a : b));
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(mostRecent.date);
  if (!match) return null;
  return parseInt(match[3], 10);
}

/**
 * Declaration-first debt expenses: one row per debt whose transactions
 * matched exact `matchAmounts` entries. The heuristic detector never sees
 * these accumulators (partitioned out), so rate changes and multi-amount
 * mortgages surface reliably.
 */
function buildDeclaredDebtExpenseRows(
  debts: readonly DebtMatchable[],
  declaredByDebtId: Map<string, Accumulator>,
  accountScope: readonly string[] | undefined,
): RecurringExpense[] {
  const monthly: RecurringExpense[] = [];

  for (const debt of debts) {
    if (debt.archived) continue;
    if (debt.kind !== 'mortgage') continue;
    if (debt.matchAmounts.length === 0) continue;

    const accumulator = declaredByDebtId.get(debt.id);
    if (accumulator === undefined) continue;

    const sourceAccount = pickDebtSourceAccount(debt, accumulator, accountScope);
    if (sourceAccount === null) continue;

    monthly.push(buildDeclaredDebtExpenseRow(debt, accumulator, sourceAccount));
  }

  return monthly;
}

function pickDebtSourceAccount(
  debt: DebtMatchable,
  accumulator: Accumulator,
  accountScope: readonly string[] | undefined,
): string | null {
  const candidates = debt.sourceAccounts.filter(
    account => accountScope === undefined || accountScope.includes(account),
  );
  if (candidates.length === 0) return null;
  if (candidates.some(account => account === accumulator.sourceAccount)) {
    return accumulator.sourceAccount;
  }
  return candidates[0] ?? null;
}

function buildDeclaredDebtExpenseRow(
  debt: DebtMatchable,
  accumulator: Accumulator,
  sourceAccount: string,
): RecurringExpense {
  const monthlyAmount = debt.matchAmounts[0];
  const category: CategoryName = 'Housing';
  const billingDayOfMonth = resolveRentalBillingDay(accumulator);

  return {
    merchant: debt.name,
    category,
    colour: categoryColour(category),
    amount: round2(monthlyAmount),
    frequency: 'monthly',
    monthsActive: accumulator.monthlyTotals.size,
    annualTotal: round2(monthlyAmount * 12),
    logoUrl: getMerchantLogoUrl(debt.name),
    sourceAccount,
    billingDayOfMonth,
    billingMonth: null,
    declaredDebtId: debt.id,
  };
}

function buildDeclaredOutgoingRows(
  registry: ObligationRegistry,
  declaredByObligationId: Map<string, Accumulator>,
  accountScope: readonly string[] | undefined,
): { monthly: RecurringExpense[]; annual: RecurringExpense[] } {
  const monthly: RecurringExpense[] = [];
  const annual: RecurringExpense[] = [];

  for (const obligation of registry.outgoing) {
    if (!showOnFixedExpenses(obligation)) continue;
    if (obligation.account === undefined) continue;
    if (obligation.frequency !== 'monthly' && obligation.frequency !== 'annual') continue;
    if (accountScope !== undefined && !accountScope.includes(obligation.account)) continue;

    const accumulator = declaredByObligationId.get(obligation.id) ?? null;
    const row = buildDeclaredOutgoingRow(obligation, accumulator);
    if (obligation.frequency === 'monthly') {
      monthly.push(row);
    } else {
      annual.push(row);
    }
  }

  return { monthly, annual };
}

function buildDeclaredOutgoingRow(
  obligation: OutgoingObligation,
  accumulator: Accumulator | null,
): RecurringExpense {
  const currency: CurrencyCode = obligation.currency;
  const gbpAmount = currency === 'GBP'
    ? obligation.amount
    : convertAmountSync(obligation.amount, currency, 'GBP');
  const category = accumulator?.category ?? obligationToCategory(obligation);
  const merchantLabel = obligation.displayName ?? obligation.merchant;

  const { billingDayOfMonth, billingMonth } = resolveBillingPattern(obligation, accumulator);

  const expense: RecurringExpense = {
    merchant: merchantLabel,
    category,
    colour: categoryColour(category),
    amount: round2(gbpAmount),
    frequency: obligation.frequency === 'monthly' ? 'monthly' : 'annual',
    monthsActive: accumulator?.monthlyTotals.size ?? 0,
    annualTotal: round2(obligation.frequency === 'annual' ? gbpAmount : gbpAmount * 12),
    logoUrl: getMerchantLogoUrl(merchantLabel),
    sourceAccount: obligation.account ?? '',
    billingDayOfMonth,
    billingMonth,
    declaredObligationId: obligation.id,
  };
  if (currency !== 'GBP') {
    expense.nativeAmount = round2(obligation.amount);
    expense.nativeCurrency = currency;
  }
  return expense;
}

function resolveBillingPattern(
  obligation: OutgoingObligation,
  accumulator: Accumulator | null,
): { billingDayOfMonth: number | null; billingMonth: number | null } {
  // Prefer observed transactions when available — the most recent one wins.
  if (accumulator && accumulator.transactions.length > 0) {
    const mostRecent = accumulator.transactions.reduce((a, b) => (a.date > b.date ? a : b));
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(mostRecent.date);
    if (match) {
      const month = parseInt(match[2], 10);
      const day = parseInt(match[3], 10);
      return {
        billingDayOfMonth: day,
        billingMonth: obligation.frequency === 'annual' ? month : null,
      };
    }
  }
  // No observed transactions — fall back to the obligation's declared due date.
  const dueDate = 'dueDate' in obligation ? obligation.dueDate : undefined;
  if (dueDate === undefined) return { billingDayOfMonth: null, billingMonth: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!match) return { billingDayOfMonth: null, billingMonth: null };
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  return {
    billingDayOfMonth: day,
    billingMonth: obligation.frequency === 'annual' ? month : null,
  };
}

function obligationToCategory(obligation: OutgoingObligation): CategoryName {
  switch (obligation.category) {
    case 'insurance': return 'Insurance';
    case 'payroll': return 'Payroll';
    // 'fixed-bill' and 'subscription' deliberately fall through to 'Other'.
    // These values are only used when no matching transaction exists yet;
    // with an accumulator present, the registry-derived category wins.
    case 'fixed-bill':
    case 'subscription': return 'Other';
    case 'tax-manual': return 'Other';
  }
}
