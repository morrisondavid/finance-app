/**
 * Survival mode — discretionary daily burn on top of essentials + confirmed income.
 * Reuses: `assembleForecastEvents`, `buildForecast`, `mergeHolisticCashPathToGbp`,
 * `firstNegativeBalanceDate`, `sumCashAndCreditByCurrency`, `isMandatoryCategory`.
 */

import {
  ACCOUNTS,
  type AccountName,
  type CurrencyCode,
  type ExpectedReceiptRow,
} from '../../../shared/api-contracts.js';
import { isMandatoryCategory } from '../../../shared/expenses-insight.js';
import { shiftIsoDate } from '../../../shared/iso-date.js';
import { convertAmountSync } from '../../config/exchange-rates.js';
import { getAllAccountBalances } from '../../db/repositories/balance.js';
import { getAccountConfig, isCreditCard } from '../accounts/queries.js';
import { sumCashAndCreditByCurrency } from '../accounts/runway-credit.js';
import {
  composeExpectedReceiptsFromLoaded,
  expectedReceiptRowToIncomeEvent,
} from '../contracts/expected-receipts.js';
import {
  assembleForecastEvents,
  pickMonthlyRecurringForForecast,
} from '../forecast/assemble-forecast-events.js';
import {
  buildForecast,
  type ForecastDailyPoint,
} from '../forecast/build-forecast.js';
import type { ForecastEvent } from '../forecast/events.js';
import {
  daysBetweenIsoUtc,
  firstNegativeBalanceDate,
  mergeHolisticCashPathToGbp,
} from '../forecast/runway-metrics.js';
import type { LoadedForecastInputs } from '../forecast/load-inputs.js';
import { loadForecastInputs } from '../forecast/load-inputs.js';
import { round2 } from '../../utils/math.js';
import type { UpcomingRecurring } from '../../../shared/api-contracts.js';

export type SurvivalScope = 'personal' | 'household';

export interface SurvivalEssentialOverride {
  readonly category?: string;
  readonly merchant?: string;
  readonly weeklyAmountGbp?: number;
  readonly monthlyAmountGbp?: number;
}

export interface ComputeSurvivalInput {
  readonly today: string;
  readonly horizonDays: number;
  readonly scope: SurvivalScope;
  readonly dailyDiscretionary?: number;
  readonly targetDate?: string;
  readonly essentialOverrides?: readonly SurvivalEssentialOverride[];
  readonly loaded: LoadedForecastInputs;
}

export interface SurvivalGivenResult {
  readonly dailyDiscretionary: number;
  readonly survivalDateCashOnly: string | null;
  readonly survivalDateCreditIncluded: string | null;
  readonly daysOfSurvival: number | null;
}

export interface ComputeSurvivalResult {
  readonly today: string;
  readonly scope: SurvivalScope;
  readonly essentialsMonthlyGbp: number;
  readonly confirmedFutureIncome: ExpectedReceiptRow[];
  readonly availableCreditGbp: number;
  readonly given?: SurvivalGivenResult;
  readonly solveForTarget?: { targetDate: string; maxDailyDiscretionary: number };
  readonly appliedOverrides: SurvivalEssentialOverride[];
  readonly narrative: string;
}

function accountInScope(account: AccountName, scope: SurvivalScope): boolean {
  if (scope === 'household') return true;
  return getAccountConfig(account).category === 'personal';
}

function filterEventsToScope(events: readonly ForecastEvent[], scope: SurvivalScope): ForecastEvent[] {
  return events.filter(e => accountInScope(e.account, scope));
}

function filterStartingBalances(
  loaded: LoadedForecastInputs,
  scope: SurvivalScope,
): LoadedForecastInputs['startingBalances'] {
  return loaded.startingBalances.filter(b => accountInScope(b.account, scope));
}

function applyEssentialOverrides(
  monthly: UpcomingRecurring[],
  overrides: readonly SurvivalEssentialOverride[],
): UpcomingRecurring[] {
  if (overrides.length === 0) return monthly;
  return monthly.map(item => {
    for (const ov of overrides) {
      const catMatch = ov.category !== undefined && ov.category === item.category;
      const merchMatch = ov.merchant !== undefined &&
        item.merchant.toLowerCase().includes(ov.merchant.toLowerCase());
      if (!catMatch && !merchMatch) continue;
      if (ov.monthlyAmountGbp !== undefined) {
        return { ...item, amount: ov.monthlyAmountGbp };
      }
    }
    return item;
  });
}

function buildMandatoryEvents(
  loaded: LoadedForecastInputs,
  overrides: readonly SurvivalEssentialOverride[],
): ForecastEvent[] {
  const monthlyBase = pickMonthlyRecurringForForecast(
    loaded.today,
    loaded.pipeline,
    loaded.upcomingBuckets,
  );
  const monthlyMandatory = applyEssentialOverrides(
    monthlyBase.filter(item => isMandatoryCategory(item.category)),
    overrides,
  );
  const annualMandatory = loaded.upcomingBuckets.thisYear.filter(
    item => isMandatoryCategory(item.category),
  );

  return assembleForecastEvents({
    today: loaded.today,
    horizon: loaded.horizon,
    defaultAccountByType: loaded.defaultAccountByType,
    currencyByAccount: loaded.currencyByAccount,
    accountsByEntity: loaded.accountsByEntity,
    obligations: loaded.obligations,
    pipeline: loaded.pipeline,
    upcomingBuckets: {
      ...loaded.upcomingBuckets,
      thisMonth: monthlyMandatory,
      thisYear: annualMandatory,
    },
    unpaidInvoices: loaded.unpaidInvoices,
    contracts: loaded.contracts,
    accrualWindowStartByContractId: loaded.accrualWindowStartByContractId,
    leaveRows: loaded.leaveRows,
    publicHolidayDatesByEntity: loaded.publicHolidayDatesByEntity,
    includeInvoiceReceipts: true,
    includeAccrual: true,
    projectAccrualToContractEnd: true,
    recurringPredicate: item => isMandatoryCategory(item.category),
  });
}

function sumAvailableCreditGbp(scope: SurvivalScope): number {
  const balances = getAllAccountBalances();
  let total = 0;
  for (const c of ['GBP', 'AED'] as const satisfies readonly CurrencyCode[]) {
    const cc = sumCashAndCreditByCurrency(c, balances);
    if (scope === 'personal') {
      // Personal credit cards only (entityId null on personal accounts)
      for (const name of ACCOUNTS) {
        const cfg = getAccountConfig(name);
        if (cfg.currency !== c || cfg.category !== 'personal') continue;
        const row = balances[name];
        if (row && isCreditCard(name)) {
          total += convertAmountSync(row.currentBalance, c, 'GBP');
        }
      }
    } else {
      total += convertAmountSync(cc.totalAvailableCredit, c, 'GBP');
    }
  }
  return round2(total);
}

function estimateEssentialsMonthlyGbp(events: readonly ForecastEvent[], today: string): number {
  const windowEnd = shiftIsoDate(today, 30);
  let sum = 0;
  for (const e of events) {
    if (e.amount >= 0) continue;
    if (e.date < today || e.date > windowEnd) continue;
    sum += convertAmountSync(Math.abs(e.amount), e.currency, 'GBP');
  }
  return round2(sum);
}

function applyDailyDiscretionaryBurn(
  daily: readonly ForecastDailyPoint[],
  today: string,
  dailyBurnGbp: number,
): ForecastDailyPoint[] {
  let burnAcc = 0;
  return daily.map(pt => {
    if (pt.date >= today) {
      burnAcc = round2(burnAcc + dailyBurnGbp);
    }
    return { date: pt.date, balance: round2(pt.balance - burnAcc) };
  });
}

function firstBalanceBelow(daily: readonly ForecastDailyPoint[], threshold: number): string | null {
  for (const pt of daily) {
    if (pt.balance < threshold) return pt.date;
  }
  return null;
}

function buildHolisticSeries(
  loaded: LoadedForecastInputs,
  scope: SurvivalScope,
  overrides: readonly SurvivalEssentialOverride[],
): ForecastDailyPoint[] {
  const mandatoryEvents = filterEventsToScope(buildMandatoryEvents(loaded, overrides), scope);
  const incomeReceipts = composeExpectedReceiptsFromLoaded(loaded, {
    projectToContractEnd: true,
  });

  const incomeEvents: ForecastEvent[] = incomeReceipts.receipts.map(expectedReceiptRowToIncomeEvent);

  const allEvents = [...mandatoryEvents, ...filterEventsToScope(incomeEvents, scope)];
  const forecast = buildForecast({
    today: loaded.today,
    horizonDays: loaded.horizonDays,
    startingBalances: filterStartingBalances(loaded, scope),
    events: allEvents,
  });
  return mergeHolisticCashPathToGbp(forecast.accounts);
}

function survivalFromDailyBurn(
  baseSeries: readonly ForecastDailyPoint[],
  today: string,
  dailyBurnGbp: number,
  availableCreditGbp: number,
): SurvivalGivenResult {
  const burned = applyDailyDiscretionaryBurn(baseSeries, today, dailyBurnGbp);
  const survivalDateCashOnly = firstNegativeBalanceDate(burned);
  const survivalDateCreditIncluded = firstBalanceBelow(burned, -availableCreditGbp);
  const daysOfSurvival = survivalDateCashOnly === null
    ? null
    : daysBetweenIsoUtc(today, survivalDateCashOnly);
  return {
    dailyDiscretionary: dailyBurnGbp,
    survivalDateCashOnly,
    survivalDateCreditIncluded,
    daysOfSurvival,
  };
}

function binarySearchMaxDailyForTarget(
  baseSeries: readonly ForecastDailyPoint[],
  today: string,
  targetDate: string,
  availableCreditGbp: number,
  ceiling: number,
): number {
  let lo = 0;
  let hi = ceiling;
  for (let i = 0; i < 30; i++) {
    const mid = round2((lo + hi) / 2);
    const result = survivalFromDailyBurn(baseSeries, today, mid, availableCreditGbp);
    const stress = result.survivalDateCashOnly;
    if (stress !== null && stress >= targetDate) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (Math.abs(hi - lo) < 0.01) break;
  }
  return round2(lo);
}

export function computeSurvival(input: ComputeSurvivalInput): ComputeSurvivalResult {
  const { loaded, today, scope, essentialOverrides = [] } = input;
  const baseSeries = buildHolisticSeries(loaded, scope, essentialOverrides);
  const mandatoryOnly = filterEventsToScope(buildMandatoryEvents(loaded, essentialOverrides), scope);
  const essentialsMonthlyGbp = estimateEssentialsMonthlyGbp(mandatoryOnly, today);
  const availableCreditGbp = sumAvailableCreditGbp(scope);

  const receipts = composeExpectedReceiptsFromLoaded(loaded, {
    projectToContractEnd: true,
  }).receipts.filter(r => accountInScope(r.account, scope));

  let given: SurvivalGivenResult | undefined;
  let solveForTarget: ComputeSurvivalResult['solveForTarget'];

  const dailyCeiling = 500;

  if (input.targetDate !== undefined) {
    const maxD = binarySearchMaxDailyForTarget(
      baseSeries,
      today,
      input.targetDate,
      availableCreditGbp,
      dailyCeiling,
    );
    solveForTarget = { targetDate: input.targetDate, maxDailyDiscretionary: maxD };
    given = survivalFromDailyBurn(baseSeries, today, maxD, availableCreditGbp);
  } else if (input.dailyDiscretionary !== undefined) {
    given = survivalFromDailyBurn(
      baseSeries,
      today,
      input.dailyDiscretionary,
      availableCreditGbp,
    );
  }

  const narrativeParts: string[] = [];
  if (given !== undefined) {
    narrativeParts.push(
      `At £${given.dailyDiscretionary}/day discretionary, cash lasts until ${given.survivalDateCashOnly ?? 'horizon'}.`,
    );
    if (given.survivalDateCreditIncluded !== null) {
      narrativeParts.push(`Including credit: until ${given.survivalDateCreditIncluded}.`);
    }
  } else if (solveForTarget !== undefined) {
    narrativeParts.push(
      `To last until ${solveForTarget.targetDate}, keep discretionary spend under £${solveForTarget.maxDailyDiscretionary}/day.`,
    );
  }

  return {
    today,
    scope,
    essentialsMonthlyGbp,
    confirmedFutureIncome: receipts,
    availableCreditGbp,
    ...(given !== undefined ? { given } : {}),
    ...(solveForTarget !== undefined ? { solveForTarget } : {}),
    appliedOverrides: [...essentialOverrides],
    narrative: narrativeParts.join(' '),
  };
}

export interface BuildSurvivalOpts {
  readonly horizonDays?: number;
  readonly scope?: SurvivalScope;
  readonly dailyDiscretionary?: number;
  readonly targetDate?: string;
  readonly essentialOverrides?: readonly SurvivalEssentialOverride[];
  readonly forecastInputs?: LoadedForecastInputs;
}

export function buildSurvival(opts: BuildSurvivalOpts = {}): ComputeSurvivalResult {
  const loaded =
    opts.forecastInputs ??
    loadForecastInputs({ horizonDays: opts.horizonDays ?? 720 });
  return computeSurvival({
    today: loaded.today,
    horizonDays: loaded.horizonDays,
    scope: opts.scope ?? 'personal',
    dailyDiscretionary: opts.dailyDiscretionary,
    targetDate: opts.targetDate,
    essentialOverrides: opts.essentialOverrides,
    loaded,
  });
}
