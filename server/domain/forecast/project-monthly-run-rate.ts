/**
 * Canonical "monthly run-rate" primitive.
 *
 * `projectIncomeForWindow` answers "income arriving between dates X
 * and Y" by summing future-payment forecast events whose date lands
 * in that window. That's the right primitive for a calendar of
 * expected receipts (§2.0 future use case), but it's the WRONG
 * primitive for the §1.9 Debt Strategy planner's headroom math:
 * `collectAccrualEvents` emits each contract accrual at
 * `month-end + payment_terms_days`. With 30-60 day payment terms,
 * the event for THIS month's work lands two months out — outside a
 * 30-day income window, so the planner reads zero income even when
 * actively in contract.
 *
 * `projectMonthlyRunRate` is the right primitive: steady-state
 * monthly income from active contracts (working-days × day-rate via
 * §1.4's `calculateWorkload`) plus recurring detected income (rent,
 * dividends, scheduled subscriptions). No payment-terms delay; no
 * arrival-date filtering. Matches the user's mental model:
 *
 *   "I earn £X/day × ~22 working days = ~£Y/month."
 *
 * Already-issued invoice receipts are deliberately NOT included —
 * those are back-pay landing in cash on a specific date, not
 * steady-state monthly income. Use `projectIncomeForWindow` if you
 * want the date-bounded view that includes them.
 */

import { shiftIsoDate } from '../../../shared/iso-date.js';
import {
  type AccountName,
  type CurrencyCode,
  type RecurringExpense,
} from '../../../shared/api-contracts.js';
import { calculateWorkload } from '../contracts/workload.js';
import { holidayDatesForContract } from '../working-days/public-holidays.js';
import { primaryAccountForEntity } from './collect-events.js';
import { ACCOUNT_CONFIG_DATA } from '../accounts/data.js';
import { recurringKey } from '../../utils/recurring-pipeline.js';
import {
  loadForecastInputs,
  type LoadedForecastInputs,
} from './load-inputs.js';
import {
  bucketKey,
  scopeForAccount,
} from './project-income.js';
import type { PlanScope } from '../debt-strategy/schema.js';

/** Default look-ahead window: ~one calendar month of working days. */
export const DEFAULT_RUN_RATE_WINDOW_DAYS = 30;

export interface ProjectMonthlyRunRateInput {
  /** ISO date `YYYY-MM-DD`. Anchors the look-ahead window. */
  readonly today: string;
  /**
   * Pre-loaded forecast inputs (avoids re-running the loader's I/O
   * when the caller already has them). When omitted, this function
   * calls `loadForecastInputs({ today })` itself.
   */
  readonly preLoaded?: LoadedForecastInputs;
  /** Optional bucket narrowing; `undefined` means "all buckets". */
  readonly bucketFilter?: {
    readonly currency?: CurrencyCode;
    readonly scope?: PlanScope;
  };
  /**
   * When set, contract accrual for these ids is omitted (sandbox /
   * what-if). Keys match {@link recurringIncomeStableKey} for recurring rows.
   */
  readonly excludedContractIds?: ReadonlySet<string> | readonly string[];
  readonly excludedRecurringIncomeKeys?: ReadonlySet<string> | readonly string[];
  /**
   * Days the run-rate looks forward over. Default
   * {@link DEFAULT_RUN_RATE_WINDOW_DAYS} (30) — roughly one month of
   * working days for a standard Mon–Fri contract.
   */
  readonly windowDays?: number;
}

/**
 * Stable id for a recurring income row: declared obligation when present,
 * else the same composite as {@link recurringKey} (category, merchant,
 * account, amount band).
 */
export function recurringIncomeStableKey(item: RecurringExpense): string {
  const declared = item.declaredObligationId;
  if (declared !== undefined && declared.length > 0) {
    return `declared:${declared}`;
  }
  return recurringKey(item);
}

export interface SandboxContractIncomeSource {
  readonly contractId: string;
  readonly bucketKey: string;
  /** Monthly accrual for this contract in this bucket (same basis as headroom income). */
  readonly monthlyAccrual: number;
}

export interface SandboxRecurringIncomeSource {
  readonly key: string;
  readonly bucketKey: string;
  readonly monthlyAmount: number;
  readonly merchant: string;
  readonly sourceAccount: string;
  readonly category: string;
  readonly declaredObligationId: string | null;
}

export interface MonthlyRunRateBucketBreakdown {
  /** Sum of `calculateWorkload(...).subtotal` across active contracts in this bucket. */
  readonly contractAccrual: number;
  /** Sum of `monthlyIncomeRecurring` items routed to this bucket. */
  readonly recurringIncome: number;
  readonly total: number;
  /** Stable-sorted list of contract ids that contributed (handy for UI / debugging). */
  readonly contributingContractIds: readonly string[];
}

export interface ProjectedMonthlyRunRate {
  readonly today: string;
  readonly windowDays: number;
  readonly byBucket: ReadonlyMap<string, MonthlyRunRateBucketBreakdown>;
  /**
   * All contract + recurring lines that count toward run-rate income when
   * not excluded — used by the debt-strategy sandbox toggles. Present even
   * when exclusions are applied; amounts are the full per-source figures.
   */
  readonly sandboxIncomeSources: {
    readonly contracts: readonly SandboxContractIncomeSource[];
    readonly recurring: readonly SandboxRecurringIncomeSource[];
  };
}

interface MutableBucket {
  contractAccrual: number;
  recurringIncome: number;
  contributingContractIds: string[];
}

function getOrCreateBucket(
  buckets: Map<string, MutableBucket>,
  key: string,
): MutableBucket {
  let b = buckets.get(key);
  if (b === undefined) {
    b = { contractAccrual: 0, recurringIncome: 0, contributingContractIds: [] };
    buckets.set(key, b);
  }
  return b;
}

function isAccountName(value: string): value is AccountName {
  return value in ACCOUNT_CONFIG_DATA;
}

function passesBucketFilter(
  currency: CurrencyCode,
  scope: PlanScope,
  bucketFilter: ProjectMonthlyRunRateInput['bucketFilter'],
): boolean {
  if (bucketFilter === undefined) return true;
  if (bucketFilter.currency !== undefined && bucketFilter.currency !== currency) return false;
  if (bucketFilter.scope !== undefined && bucketFilter.scope !== scope) return false;
  return true;
}

function toIdSet(ids: ProjectMonthlyRunRateInput['excludedContractIds']): ReadonlySet<string> {
  if (ids === undefined) return new Set();
  return ids instanceof Set ? ids : new Set(ids);
}

function toKeySet(keys: ProjectMonthlyRunRateInput['excludedRecurringIncomeKeys']): ReadonlySet<string> {
  if (keys === undefined) return new Set();
  return keys instanceof Set ? keys : new Set(keys);
}

export function projectMonthlyRunRate(
  input: ProjectMonthlyRunRateInput,
): ProjectedMonthlyRunRate {
  const inputs = input.preLoaded ?? loadForecastInputs({ today: input.today });
  const windowDays = input.windowDays ?? DEFAULT_RUN_RATE_WINDOW_DAYS;
  const today = input.today;
  const windowEndAbsolute = shiftIsoDate(today, windowDays);
  const excludedContracts = toIdSet(input.excludedContractIds);
  const excludedRecurring = toKeySet(input.excludedRecurringIncomeKeys);

  const buckets = new Map<string, MutableBucket>();
  const contractManifest = new Map<string, { bucketKey: string; accrual: number }>();
  const recurringManifest = new Map<
    string,
    {
      stableKey: string;
      bucketKey: string;
      amount: number;
      merchant: string;
      sourceAccount: string;
      category: string;
      declaredObligationId: string | null;
    }
  >();

  // 1. Active contracts: workdays × day-rate over the window.
  for (const contract of inputs.contracts) {
    if (contract.end_date < today) continue;

    const windowEnd =
      contract.end_date < windowEndAbsolute
        ? contract.end_date
        : windowEndAbsolute;
    if (windowEnd < today) continue;

    const account = primaryAccountForEntity(contract.issuing_entity_id, inputs.accountsByEntity);
    if (account === null) continue;
    const currency = inputs.currencyByAccount.get(account);
    if (currency === undefined) continue;

    const publicHolidayDates = holidayDatesForContract(contract, today, windowEnd);
    const workload = calculateWorkload({
      contract,
      leaveRows: inputs.leaveRows,
      start: today,
      end: windowEnd,
      publicHolidayDates,
    });
    if (workload.subtotal <= 0) continue;

    const scope = scopeForAccount(account);
    if (!passesBucketFilter(currency, scope, input.bucketFilter)) continue;

    const bk = bucketKey(currency, scope);
    const prevM = contractManifest.get(contract.id);
    if (prevM === undefined) {
      contractManifest.set(contract.id, { bucketKey: bk, accrual: workload.subtotal });
    } else {
      prevM.accrual += workload.subtotal;
    }

    if (excludedContracts.has(contract.id)) continue;

    const bucket = getOrCreateBucket(buckets, bk);
    bucket.contractAccrual += workload.subtotal;
    bucket.contributingContractIds.push(contract.id);
  }

  // 2. Recurring detected income (rent, dividends, ad-hoc subscriptions).
  for (const item of inputs.pipeline.monthlyIncomeRecurring) {
    const accountStr = item.sourceAccount;
    if (!isAccountName(accountStr)) continue;
    const cfg = ACCOUNT_CONFIG_DATA[accountStr];
    if (cfg === undefined) continue;
    const scope = scopeForAccount(accountStr);

    // Use native amount/currency where available so AED stays AED.
    const native = item.nativeAmount;
    const nativeCurrency = item.nativeCurrency as CurrencyCode | undefined;
    const useNative = native !== undefined && nativeCurrency !== undefined;
    const amount = useNative ? Math.abs(native ?? 0) : Math.abs(item.amount);
    const currency: CurrencyCode = useNative && nativeCurrency !== undefined ? nativeCurrency : cfg.currency;

    if (amount <= 0) continue;
    if (!passesBucketFilter(currency, scope, input.bucketFilter)) continue;

    const bk = bucketKey(currency, scope);
    const stableKey = recurringIncomeStableKey(item);
    const manifestKey = `${stableKey}\0${bk}`;
    const declared =
      item.declaredObligationId !== undefined && item.declaredObligationId.length > 0
        ? item.declaredObligationId
        : null;
    const prevR = recurringManifest.get(manifestKey);
    if (prevR === undefined) {
      recurringManifest.set(manifestKey, {
        stableKey,
        bucketKey: bk,
        amount,
        merchant: item.merchant,
        sourceAccount: item.sourceAccount,
        category: item.category,
        declaredObligationId: declared,
      });
    } else {
      prevR.amount += amount;
    }

    if (excludedRecurring.has(stableKey)) continue;

    const bucket = getOrCreateBucket(buckets, bk);
    bucket.recurringIncome += amount;
  }

  // 3. Freeze + total per bucket.
  const out = new Map<string, MonthlyRunRateBucketBreakdown>();
  for (const [k, b] of buckets) {
    const sortedContracts = [...new Set(b.contributingContractIds)].sort();
    out.set(k, {
      contractAccrual: Math.round(b.contractAccrual * 100) / 100,
      recurringIncome: Math.round(b.recurringIncome * 100) / 100,
      total: Math.round((b.contractAccrual + b.recurringIncome) * 100) / 100,
      contributingContractIds: sortedContracts,
    });
  }

  const contracts = [...contractManifest.entries()]
    .map(([contractId, v]) => ({
      contractId,
      bucketKey: v.bucketKey,
      monthlyAccrual: Math.round(v.accrual * 100) / 100,
    }))
    .sort((a, b) => a.contractId.localeCompare(b.contractId));

  const recurring = [...recurringManifest.values()]
    .map(row => ({
      key: row.stableKey,
      bucketKey: row.bucketKey,
      monthlyAmount: Math.round(row.amount * 100) / 100,
      merchant: row.merchant,
      sourceAccount: row.sourceAccount,
      category: row.category,
      declaredObligationId: row.declaredObligationId,
    }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.bucketKey.localeCompare(b.bucketKey));

  return {
    today,
    windowDays,
    byBucket: out,
    sandboxIncomeSources: { contracts, recurring },
  };
}
