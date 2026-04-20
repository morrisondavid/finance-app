/**
 * Shared accumulation + classification pipeline used by both /overview and /recurring routes.
 * Eliminates ~200 lines of duplication by parameterising the differences:
 *   - which transactions to scope (rolling window vs FY)
 *   - which transactions to attach for all-time annual detection
 *   - whether to include income accumulators
 *   - whether to filter pass-through IDs
 */

import { ACCOUNT_CONFIG } from '../types.js';
import type { AccountName } from '../types.js';
import { categorizeTransaction, categoryColour } from './categorizer.js';
import type { CategoryName } from './categorizer.js';
import { normalizeMerchant } from './merchant-normalizer.js';
import { classifyRecurring } from './recurring-detector.js';
import type { RecurringCandidate, TransactionDetail } from './recurring-detector.js';
import { getMerchantLogoUrl } from './merchant-logos.js';
import type { RecurringExpense } from '../../shared/api-contracts.js';
import { round2, monthKeyFromIsoDate } from './math.js';
import { SPECIAL_CATEGORY } from './category-constants.js';
import { resolveExpenseCategoryWithPayroll, type PayrollEntry } from '../config/payroll.js';
import { convertAmountSync } from '../config/exchange-rates.js';
import type { CurrencyCode } from '../types.js';
import { getDeclaredCommitmentRegistry, type DeclaredCommitmentRegistry } from '../domain/commitments/registry.js';
import {
  matchFixedBillCommitment,
  matchRentalCommitmentByAmount,
} from '../domain/commitments/lookups.js';
import type { DeclaredOutgoing } from '../../shared/api-contracts.js';

export interface RawTransaction {
  id: number;
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
    e.category === SPECIAL_CATEGORY.property || e.category === SPECIAL_CATEGORY.payroll;
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
}

/** Registry category + payroll config override + rental display (same loop as Pass 1 / Pass 2). */
function rowForAccumulation(txn: RawTransaction, side: 'expense' | 'income'): AccumulationRow | null {
  const merchant = normalizeMerchant(txn.description);
  const absAmount = Math.abs(txn.amount);
  const account = txn.account;

  let category = categorizeTransaction(txn.description);
  let payrollHit: PayrollEntry | null = null;
  if (side === 'expense') {
    const resolved = resolveExpenseCategoryWithPayroll(
      txn.description,
      merchant,
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
  if (payrollHit) {
    displayMerchant = payrollHit.displayName ?? payrollHit.merchant;
    keyAmount = 0;
  }

  const isPropertyIncome = side === 'income' && category === SPECIAL_CATEGORY.property;
  if (isPropertyIncome) {
    const prop = matchRentalCommitmentByAmount(getDeclaredCommitmentRegistry(), merchant, account, absAmount);
    if (prop) {
      displayMerchant = prop.displayName ?? prop.merchant;
      keyAmount = 0;
    }
  }

  if (side === 'expense' && matchFixedBillCommitment(getDeclaredCommitmentRegistry(), merchant, account)) {
    keyAmount = 0;
  }

  return { category, displayMerchant, keyAmount };
}

export interface AccumulationBucket {
  key: string;
  category: CategoryName;
  displayMerchant: string;
  keyAmount: number;
}

/** Same bucketing as Pass 1 / Pass 2; use for tooling that must stay aligned with the pipeline. */
export function accumulationFromTxn(
  txn: RawTransaction,
  side: 'expense' | 'income',
): AccumulationBucket | null {
  const row = rowForAccumulation(txn, side);
  if (!row) return null;
  return {
    key: accKey(row.category, row.displayMerchant, txn.account, row.keyAmount),
    category: row.category,
    displayMerchant: row.displayMerchant,
    keyAmount: row.keyAmount,
  };
}

export function accumulatorKeyForTxn(txn: RawTransaction, side: 'expense' | 'income'): string | null {
  return accumulationFromTxn(txn, side)?.key ?? null;
}

/**
 * Return a matching registry outgoing whose declaration should relax the
 * detector's gates for this accumulator. Scope: expenses only (income has
 * its own rental-income relaxation in {@link classifyRecurring}), outgoings
 * with a monthly or annual cadence, and we exclude `tax-manual` — tax
 * obligations live on the Obligations tab, never on Fixed Expenses, even
 * when declared with a yearly cadence.
 */
function declaredOutgoingFor(
  registry: DeclaredCommitmentRegistry,
  merchant: string,
  account: string,
): DeclaredOutgoing | null {
  const hit = registry.matchByMerchantAccount(merchant, account);
  if (hit === null) return null;
  if (hit.category === 'rental-income') return null;
  if (hit.category === 'tax-manual') return null;
  if (hit.cadence !== 'monthly' && hit.cadence !== 'annual') return null;
  return hit;
}

function accumulatorsToCandidates(
  map: Map<string, Accumulator>,
  side: 'expense' | 'income',
): RecurringCandidate[] {
  const registry = getDeclaredCommitmentRegistry();
  const candidates: RecurringCandidate[] = [];
  for (const acc of map.values()) {
    const monthlyValues = Array.from(acc.monthlyTotals.values());
    const monthlyMax = monthlyValues.length > 0 ? Math.max(...monthlyValues) : 0;
    const monthlyAvg = monthlyValues.length > 0
      ? monthlyValues.reduce((s, v) => s + v, 0) / monthlyValues.length
      : 0;

    const declared = side === 'expense'
      ? declaredOutgoingFor(registry, acc.merchant, acc.sourceAccount)
      : null;

    const candidate: RecurringCandidate = {
      merchant: acc.merchant,
      category: acc.category,
      monthlyMax: round2(monthlyMax),
      monthlyAvg: round2(monthlyAvg),
      monthsActive: acc.monthlyTotals.size,
      annualTotal: round2(acc.annualTotal),
      sourceAccount: acc.sourceAccount,
      accountCategory: acc.accountCategory,
      transactions: acc.transactions,
    };
    if (declared !== null) {
      candidate.declaredCadence = declared.cadence === 'monthly' ? 'monthly' : 'annual';
      candidate.declaredCommitmentId = declared.id;
    }
    candidates.push(candidate);
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
  const { scopedTransactions, allTimeTransactions, passThroughIds, includeIncome } = config;

  const expenseAccumulators = new Map<string, Accumulator>();
  const incomeAccumulators = new Map<string, Accumulator>();
  const allMonths = new Set<string>();

  // Pass 1: scoped transactions -> monthly totals
  for (const txn of scopedTransactions) {
    if (passThroughIds?.has(txn.id)) continue;

    const side = classifyTransactionSide(txn);
    if (!side) continue;
    if (side === 'income' && !includeIncome) continue;

    const bucket = accumulationFromTxn(txn, side);
    if (!bucket) continue;

    const { key, category, displayMerchant } = bucket;
    const account = txn.account;
    const accountCategory = ACCOUNT_CONFIG[account as AccountName]?.category ?? 'personal';
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

    const bucket = accumulationFromTxn(txn, side);
    if (!bucket) continue;

    const { key } = bucket;
    const absAmount = Math.abs(txn.amount);
    const map = side === 'income' ? incomeAccumulators : expenseAccumulators;
    const acc = map.get(key);
    if (!acc) continue;
    acc.transactions.push({ date: txn.date, amount: absAmount });
  }

  const monthsCovered = allMonths.size || 1;

  const expenseCandidates = accumulatorsToCandidates(expenseAccumulators, 'expense');
  const incomeCandidates = includeIncome
    ? accumulatorsToCandidates(incomeAccumulators, 'income')
    : [];

  const { monthly: monthlyExpenseRecurring, annual: annualExpenseRecurring } =
    classifyRecurring(expenseCandidates, monthsCovered);
  const { monthly: monthlyIncomeRecurring, annual: annualIncomeRecurring } = includeIncome
    ? classifyRecurring(incomeCandidates, monthsCovered, new Date(), true)
    : { monthly: [], annual: [] };

  const registry = getDeclaredCommitmentRegistry();
  const rentals = registry.listByCategory('rental-income');
  for (const e of monthlyIncomeRecurring) {
    if (e.category === SPECIAL_CATEGORY.property) {
      const prop = rentals.find(p => (p.displayName ?? p.merchant) === e.merchant);
      if (prop) e.amount = round2(prop.amount);
    }
  }

  applyDeclaredOutgoingOverrides(monthlyExpenseRecurring, registry);
  applyDeclaredOutgoingOverrides(annualExpenseRecurring, registry);
  synthesiseMissingDeclaredOutgoings(monthlyExpenseRecurring, annualExpenseRecurring, registry);

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
 * Stamp the declared-commitment amount / currency onto every matching
 * recurring expense (both monthly and annual lists). Non-GBP commitments
 * are converted to GBP for `amount` and keep their native figure on
 * `nativeAmount` / `nativeCurrency` so the UI can render "£882 (AED 4,200)".
 *
 * Also sets `declaredCommitmentId` in case the detector produced a row via
 * the heuristic path (no declaredCadence) that happens to coincide with a
 * declared commitment — Upcoming Payments dedup keys off that id.
 */
function applyDeclaredOutgoingOverrides(
  list: RecurringExpense[],
  registry: DeclaredCommitmentRegistry,
): void {
  for (const e of list) {
    const commitment = declaredOutgoingFor(registry, e.merchant, e.sourceAccount);
    if (commitment === null) continue;
    stampFromCommitment(e, commitment);
  }
}

function stampFromCommitment(e: RecurringExpense, commitment: DeclaredOutgoing): void {
  const currency: CurrencyCode = commitment.currency;
  const gbpAmount = currency === 'GBP'
    ? commitment.amount
    : convertAmountSync(commitment.amount, currency, 'GBP');
  e.amount = round2(gbpAmount);
  if (currency !== 'GBP') {
    e.nativeAmount = round2(commitment.amount);
    e.nativeCurrency = currency;
  } else {
    delete e.nativeAmount;
    delete e.nativeCurrency;
  }
  e.declaredCommitmentId = commitment.id;
}

/**
 * Emit synthetic recurring rows for every declared outgoing (monthly or
 * annual) that the detector did not produce a row for — typically because
 * the user has declared a bill but no matching transaction has landed yet,
 * or the account/merchant pair never matched during accumulation.
 *
 * This is the "one source of truth" side of the declaration-as-truth
 * contract: a declared commitment is always surfaced on Fixed Expenses,
 * with or without transaction evidence.
 */
function synthesiseMissingDeclaredOutgoings(
  monthly: RecurringExpense[],
  annual: RecurringExpense[],
  registry: DeclaredCommitmentRegistry,
): void {
  const existingIds = new Set<string>();
  for (const e of monthly) if (e.declaredCommitmentId) existingIds.add(e.declaredCommitmentId);
  for (const e of annual) if (e.declaredCommitmentId) existingIds.add(e.declaredCommitmentId);

  for (const commitment of registry.outgoing) {
    if (commitment.category === 'tax-manual') continue;
    if (commitment.account === undefined) continue;
    if (commitment.cadence !== 'monthly' && commitment.cadence !== 'annual') continue;
    if (existingIds.has(commitment.id)) continue;

    const row = buildSyntheticRecurring(commitment);
    if (commitment.cadence === 'monthly') {
      monthly.push(row);
    } else {
      annual.push(row);
    }
  }
}

function buildSyntheticRecurring(commitment: DeclaredOutgoing): RecurringExpense {
  const currency: CurrencyCode = commitment.currency;
  const gbpAmount = currency === 'GBP'
    ? commitment.amount
    : convertAmountSync(commitment.amount, currency, 'GBP');
  const category = commitmentToCategory(commitment);
  const merchantLabel = commitment.displayName ?? commitment.merchant;
  const dueDate = 'dueDate' in commitment ? commitment.dueDate : undefined;

  const { billingDayOfMonth, billingMonth } = dueDate !== undefined
    ? parseDueDate(dueDate, commitment.cadence)
    : { billingDayOfMonth: null, billingMonth: null };

  const expense: RecurringExpense = {
    merchant: merchantLabel,
    category,
    colour: categoryColour(category),
    amount: round2(gbpAmount),
    frequency: commitment.cadence === 'monthly' ? 'monthly' : 'annual',
    monthsActive: 0,
    annualTotal: round2(commitment.cadence === 'annual' ? gbpAmount : gbpAmount * 12),
    logoUrl: getMerchantLogoUrl(merchantLabel),
    // For no-transaction synthesised rows, `sourceAccount` is the declared
    // payment account so the row groups with its sibling transactions once
    // they start arriving and UI pills render correctly.
    sourceAccount: commitment.account ?? '',
    billingDayOfMonth,
    billingMonth,
    declaredCommitmentId: commitment.id,
  };
  if (currency !== 'GBP') {
    expense.nativeAmount = round2(commitment.amount);
    expense.nativeCurrency = currency;
  }
  return expense;
}

function parseDueDate(
  dueDate: string,
  cadence: 'monthly' | 'quarterly' | 'annual' | 'one-off',
): { billingDayOfMonth: number | null; billingMonth: number | null } {
  // Accept strict YYYY-MM-DD (insurance/tax-manual variants); anything else
  // falls back to null so the UI skips the "next due" prediction.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!match) return { billingDayOfMonth: null, billingMonth: null };
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  return {
    billingDayOfMonth: day,
    billingMonth: cadence === 'annual' ? month : null,
  };
}

function commitmentToCategory(commitment: DeclaredOutgoing): CategoryName {
  switch (commitment.category) {
    case 'insurance': return 'Insurance';
    case 'payroll': return 'Payroll';
    // 'fixed-bill' and 'subscription' deliberately fall through to 'Other'.
    // The synthesised row is only used until the first real transaction
    // arrives; once one does, the detector path populates the category from
    // `categorizeTransaction(description)` via the merchant registry.
    case 'fixed-bill':
    case 'subscription': return 'Other';
    case 'tax-manual': return 'Other';
  }
}
