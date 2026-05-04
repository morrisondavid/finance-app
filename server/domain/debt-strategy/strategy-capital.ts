/**
 * Capital-aware inputs for §1.9 debt strategy — deployable money, income and
 * outgoings through `strategy_end_date`, bill-cover fields (layman JSON names).
 */

import type { AccountName, CurrencyCode } from '../../../shared/api-contracts.js';
import { shiftIsoDate } from '../../../shared/iso-date.js';
import { convertAmountSync } from '../../config/exchange-rates.js';
import { ACCOUNT_CONFIG_DATA } from '../accounts/data.js';
import { accountDeployableForStrategy } from '../accounts/queries.js';
import type { LoadedForecastInputs } from '../forecast/load-inputs.js';
import { projectStrategyWindowCashflows } from '../forecast/project-income.js';
import type { DebtSummary } from '../../db/repositories/debts.js';
import type { Plan, PlanScope } from './schema.js';
import type { StrategyBucketKey } from './strategy-bucket-key.js';
import { bucketKey } from './strategy-bucket-key.js';
import {
  computeMonthsOfBillCoverAfterPlan,
  isPlanViableAgainstBillCoverFloor,
  meetsBillCoverComfortTarget,
} from './bill-cover.js';

/** Default cap on how far ahead strategy planning looks (matches forecast default). */
export const DEFAULT_STRATEGY_MAX_PLANNING_DAYS = 720;

/** Display currency for holistic cross-bucket totals (matches app convention). */
const HOLISTIC_ROLLUP_CURRENCY: CurrencyCode = 'GBP';

export function resolveStrategyPlanningEndDate(input: {
  readonly today: string;
  readonly maxPlanningDays: number;
}): string {
  const end = shiftIsoDate(input.today, input.maxPlanningDays);
  return end <= input.today ? input.today : end;
}

function planningRangeEndExclusive(strategyEndDate: string): string {
  return shiftIsoDate(strategyEndDate, 1);
}

function scopeForAccountLocal(account: AccountName): PlanScope {
  const cfg = ACCOUNT_CONFIG_DATA[account];
  if (cfg.category === 'business') return cfg.entityId;
  return 'household';
}

/**
 * Sum of deployable account balances (floor each account at 0) per bucket.
 */
export function buildDeployableLiquidityByBucket(
  inputs: LoadedForecastInputs,
): Map<StrategyBucketKey, number> {
  const out = new Map<StrategyBucketKey, number>();
  for (const row of inputs.startingBalances) {
    const cfg = ACCOUNT_CONFIG_DATA[row.account];
    if (cfg === undefined || !accountDeployableForStrategy(cfg)) continue;
    const scope = scopeForAccountLocal(row.account);
    const key = bucketKey(row.currency, scope);
    const add = Math.max(0, row.balance);
    out.set(key, (out.get(key) ?? 0) + add);
  }
  return out;
}

/**
 * Typical monthly fixed bills: all recurring smoothed expense lines (detector),
 * mandatory and non-mandatory, per bucket.
 */
export function buildTypicalMonthlyBillsByBucket(
  inputs: LoadedForecastInputs,
): Map<StrategyBucketKey, number> {
  const out = new Map<StrategyBucketKey, number>();
  for (const item of inputs.pipeline.monthlyExpenseRecurring) {
    const accountStr = item.sourceAccount;
    if (!(accountStr in ACCOUNT_CONFIG_DATA)) continue;
    const cfg = ACCOUNT_CONFIG_DATA[accountStr as AccountName];
    const scope = scopeForAccountLocal(accountStr as AccountName);
    const native = item.nativeAmount;
    const nativeCurrency = item.nativeCurrency as CurrencyCode | undefined;
    const useNative = native !== undefined && nativeCurrency !== undefined;
    const amount = useNative ? Math.abs(native ?? 0) : Math.abs(item.amount);
    const currency: CurrencyCode =
      useNative && nativeCurrency !== undefined ? nativeCurrency : cfg.currency;
    if (amount <= 0) continue;
    const key = bucketKey(currency, scope);
    out.set(key, (out.get(key) ?? 0) + amount);
  }
  return out;
}

export interface CreditCardPaydownHint {
  readonly debt_id: string;
  readonly name: string;
  readonly currency: CurrencyCode;
  readonly scope: PlanScope;
  readonly current_balance: number;
  readonly source_account: AccountName;
}

export function buildCreditCardPaydownHints(
  debts: readonly DebtSummary[],
): readonly CreditCardPaydownHint[] {
  const out: CreditCardPaydownHint[] = [];
  for (const d of debts) {
    if (d.archived || d.currentBalance <= 0) continue;
    const acc = d.sourceAccounts[0];
    if (acc === undefined || !(acc in ACCOUNT_CONFIG_DATA)) continue;
    const cfg = ACCOUNT_CONFIG_DATA[acc];
    if (cfg.type !== 'credit-card') continue;
    const scope: PlanScope = cfg.category === 'business' ? cfg.entityId : 'household';
    out.push({
      debt_id: d.id,
      name: d.name,
      currency: cfg.currency,
      scope,
      current_balance: d.currentBalance,
      source_account: acc,
    });
  }
  return out;
}

export interface StrategyCapitalBucketSnapshot {
  readonly key: StrategyBucketKey;
  readonly currency: CurrencyCode;
  readonly scope: PlanScope;
  readonly strategy_end_date: string;
  readonly deployable_money_now: number;
  readonly money_expected_in_period: number;
  readonly fixed_bills_in_period: number;
  readonly surplus_in_period: number;
  readonly money_for_debt_strategy: number;
  readonly typical_monthly_bills: number;
  readonly monthly_standing_order_drain: number;
  readonly money_available_after_plan: number;
  readonly months_of_bill_cover_after_plan: number | null;
  readonly bill_cover_viable: boolean;
  readonly bill_cover_meets_comfort_target: boolean;
}

export interface HolisticStrategyCapitalRollup {
  readonly display_currency: CurrencyCode;
  readonly total_deployable_money: number;
  readonly total_typical_monthly_bills: number;
  readonly two_month_bill_reserve: number;
  readonly usable_for_debt_paydown: number;
  /** Same pooled basis as lump sums and routes — holistic deployable after 2× bills (GBP). */
  readonly holistic_money_for_debt_gbp: number;
  readonly holistic_money_for_debt_aed: number;
  /**
   * Legacy FX sum of per–currency-and-scope `money_for_debt_strategy` rows (deployable + period surplus);
   * diverges from usable when period surplus is negative. For diagnostics only.
   */
  readonly holistic_per_scope_row_sum_gbp: number;
  readonly holistic_per_scope_row_sum_aed: number;
}

export interface RecommendedLumpSumAllocation {
  readonly debt_id: string;
  readonly name: string;
  readonly currency: CurrencyCode;
  readonly recommended_lump_sum: number;
}

export function sumMoneyForDebtStrategyHolisticInCurrency(
  rows: readonly Pick<StrategyCapitalBucketSnapshot, 'currency' | 'money_for_debt_strategy'>[],
  targetCurrency: CurrencyCode,
): number {
  let total = 0;
  for (const r of rows) {
    total += convertAmountSync(r.money_for_debt_strategy, r.currency, targetCurrency);
  }
  return Math.round(total * 100) / 100;
}

export function buildHolisticStrategyRollup(
  byBucketRows: readonly StrategyCapitalBucketSnapshot[],
): HolisticStrategyCapitalRollup {
  const display = HOLISTIC_ROLLUP_CURRENCY;
  let totalDeployable = 0;
  let totalTypical = 0;
  for (const r of byBucketRows) {
    totalDeployable += convertAmountSync(r.deployable_money_now, r.currency, display);
    totalTypical += convertAmountSync(r.typical_monthly_bills, r.currency, display);
  }
  totalDeployable = Math.round(totalDeployable * 100) / 100;
  totalTypical = Math.round(totalTypical * 100) / 100;
  const twoMonth = Math.round(totalTypical * 2 * 100) / 100;
  const usable = Math.round(Math.max(0, totalDeployable - twoMonth) * 100) / 100;
  const rowSumGbp = sumMoneyForDebtStrategyHolisticInCurrency(byBucketRows, 'GBP');
  const rowSumAed = sumMoneyForDebtStrategyHolisticInCurrency(byBucketRows, 'AED');
  const usableGbp = usable;
  return {
    display_currency: display,
    total_deployable_money: totalDeployable,
    total_typical_monthly_bills: totalTypical,
    two_month_bill_reserve: twoMonth,
    usable_for_debt_paydown: usable,
    holistic_money_for_debt_gbp: usableGbp,
    holistic_money_for_debt_aed: Math.round(convertAmountSync(usableGbp, 'GBP', 'AED') * 100) / 100,
    holistic_per_scope_row_sum_gbp: rowSumGbp,
    holistic_per_scope_row_sum_aed: rowSumAed,
  };
}

function debtSummaryCurrency(d: DebtSummary): CurrencyCode {
  const acc = d.sourceAccounts[0];
  if (acc === undefined || !(acc in ACCOUNT_CONFIG_DATA)) return 'GBP';
  return ACCOUNT_CONFIG_DATA[acc as AccountName].currency;
}

export function buildRecommendedLumpSumAllocations(input: {
  readonly debts: readonly DebtSummary[];
  readonly allPlans: readonly Plan[];
  readonly usablePaydownGbp: number;
}): readonly RecommendedLumpSumAllocation[] {
  const liveTargetIds = new Set<string>();
  for (const p of input.allPlans) {
    if (p.status === 'active' || p.status === 'paused') {
      if (p.target_id !== null) liveTargetIds.add(p.target_id);
    }
  }
  const candidates = input.debts
    .filter(
      d =>
        d.kind === 'consumer' &&
        !d.archived &&
        d.currentBalance > 0 &&
        !liveTargetIds.has(d.id),
    )
    .sort((a, b) => (b.interestRate ?? 0) - (a.interestRate ?? 0));

  let remainingGbp = Math.max(0, input.usablePaydownGbp);
  const out: RecommendedLumpSumAllocation[] = [];
  for (const d of candidates) {
    if (remainingGbp <= 0) break;
    const cur = debtSummaryCurrency(d);
    const balanceGbp = convertAmountSync(d.currentBalance, cur, 'GBP');
    const allocGbp = Math.min(balanceGbp, remainingGbp);
    if (allocGbp <= 0) continue;
    const allocNative = convertAmountSync(allocGbp, 'GBP', cur);
    const rounded = Math.round(allocNative * 100) / 100;
    if (rounded <= 0) continue;
    out.push({
      debt_id: d.id,
      name: d.name,
      currency: cur,
      recommended_lump_sum: rounded,
    });
    remainingGbp -= allocGbp;
  }
  return out;
}

export interface AssembledStrategyCapitalSnapshot {
  readonly today: string;
  readonly strategy_end_date: string;
  readonly planning_range_end_exclusive: string;
  readonly by_bucket: readonly StrategyCapitalBucketSnapshot[];
  readonly holistic: HolisticStrategyCapitalRollup;
  readonly recommended_lump_sum_allocations: readonly RecommendedLumpSumAllocation[];
}

function activeMonthlyAllocationSumForBucket(
  activePlans: readonly Plan[],
  currency: CurrencyCode,
  scope: PlanScope,
): number {
  return activePlans
    .filter(p => p.status === 'active' && p.currency === currency && p.scope === scope)
    .reduce((s, p) => s + p.monthly_allocation, 0);
}

export function assembleStrategyCapitalSnapshot(input: {
  readonly inputs: LoadedForecastInputs;
  readonly activePlans: readonly Plan[];
  readonly debts: readonly DebtSummary[];
  readonly allPlans: readonly Plan[];
  readonly maxPlanningDays?: number;
}): AssembledStrategyCapitalSnapshot {
  const { inputs, activePlans, debts, allPlans } = input;
  const maxPlanningDays = input.maxPlanningDays ?? DEFAULT_STRATEGY_MAX_PLANNING_DAYS;
  const today = inputs.today;
  const strategyEndDate = resolveStrategyPlanningEndDate({ today, maxPlanningDays });
  const rangeEndExc = planningRangeEndExclusive(strategyEndDate);

  const cashflows = projectStrategyWindowCashflows({
    from: today,
    to: rangeEndExc,
    preLoaded: inputs,
  });

  const deployable = buildDeployableLiquidityByBucket(inputs);
  const typicalBills = buildTypicalMonthlyBillsByBucket(inputs);

  const CANONICAL: readonly StrategyBucketKey[] = [
    bucketKey('GBP', 'household'),
    bucketKey('GBP', 'autonize-it-ltd'),
    bucketKey('AED', 'autonize-it-fzco'),
  ];

  const allKeys = new Set<StrategyBucketKey>([
    ...CANONICAL,
    ...cashflows.incomeByBucket.keys(),
    ...cashflows.outflowTotalByBucket.keys(),
    ...deployable.keys(),
    ...typicalBills.keys(),
  ]);

  const by_bucket: StrategyCapitalBucketSnapshot[] = [];

  for (const key of allKeys) {
    const sep = key.indexOf('::');
    const currency = key.slice(0, sep) as CurrencyCode;
    const scope = key.slice(sep + 2) as PlanScope;

    const deployableMoneyNow = Math.round((deployable.get(key) ?? 0) * 100) / 100;
    const moneyExpected = Math.round((cashflows.incomeByBucket.get(key) ?? 0) * 100) / 100;
    const fixedBillsPeriod = Math.round((cashflows.outflowTotalByBucket.get(key) ?? 0) * 100) / 100;
    const surplus = Math.round((moneyExpected - fixedBillsPeriod) * 100) / 100;
    const moneyForDebtRaw = deployableMoneyNow + surplus;
    const moneyForDebt = Math.round(Math.max(0, moneyForDebtRaw) * 100) / 100;
    const typicalMonthly = Math.round((typicalBills.get(key) ?? 0) * 100) / 100;

    const monthlyDrain =
      Math.round(activeMonthlyAllocationSumForBucket(activePlans, currency, scope) * 100) / 100;
    const moneyAvailableAfterPlan =
      Math.round(Math.max(0, deployableMoneyNow - monthlyDrain) * 100) / 100;

    const monthsCover = computeMonthsOfBillCoverAfterPlan(
      moneyAvailableAfterPlan,
      typicalMonthly,
    );
    const bill_cover_viable = isPlanViableAgainstBillCoverFloor(monthsCover, 2);
    const bill_cover_meets_comfort_target = meetsBillCoverComfortTarget(monthsCover, 3);

    by_bucket.push({
      key,
      currency,
      scope,
      strategy_end_date: strategyEndDate,
      deployable_money_now: deployableMoneyNow,
      money_expected_in_period: moneyExpected,
      fixed_bills_in_period: fixedBillsPeriod,
      surplus_in_period: surplus,
      money_for_debt_strategy: moneyForDebt,
      typical_monthly_bills: typicalMonthly,
      monthly_standing_order_drain: monthlyDrain,
      money_available_after_plan: moneyAvailableAfterPlan,
      months_of_bill_cover_after_plan: monthsCover,
      bill_cover_viable,
      bill_cover_meets_comfort_target,
    });
  }

  by_bucket.sort((a, b) => a.key.localeCompare(b.key));

  const holistic = buildHolisticStrategyRollup(by_bucket);
  const recommended_lump_sum_allocations = buildRecommendedLumpSumAllocations({
    debts,
    allPlans,
    usablePaydownGbp: holistic.usable_for_debt_paydown,
  });

  return {
    today,
    strategy_end_date: strategyEndDate,
    planning_range_end_exclusive: rangeEndExc,
    by_bucket,
    holistic,
    recommended_lump_sum_allocations,
  };
}

/** Approximate whole months between today and strategy end (≥ 1). */
export function approxStrategyPeriodMonths(todayIso: string, strategyEndIso: string): number {
  const s = Date.parse(`${todayIso}T12:00:00Z`);
  const e = Date.parse(`${strategyEndIso}T12:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 1;
  if (e <= s) return 1;
  const days = (e - s) / (1000 * 60 * 60 * 24);
  return Math.max(1, Math.ceil(days / 30.4375));
}
