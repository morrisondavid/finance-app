/**
 * I/O orchestration for §1.6's runway calculation. Loads from balances /
 * obligations / contracts / invoices / leave / public-holidays / pipeline
 * registries; runs through the pure forecast engine + per-currency
 * household block; returns one bundle.
 *
 * Two consumers:
 *   - [`server/routes/runway.ts`](../../routes/runway.ts) — wraps the
 *     bundle into the API response with optional `?detail=accounts`.
 *   - [`server/domain/warnings/runway-thresholds.ts`](../warnings/runway-thresholds.ts) — applies threshold bands to the
 *     household block + per-currency merged series and emits §1.8
 *     warnings.
 *
 * Pure computation lives in {@link assembleForecastEvents},
 * {@link buildForecast}, {@link mergeAccountSeriesByCurrency},
 * {@link firstNegativeBalanceDate}, {@link runwayMonthsToDate},
 * {@link sumCashAndCreditByCurrency}. Nothing is recomputed here.
 */

import {
  ACCOUNTS,
  type AccountName,
  type CurrencyCode,
  type EntityId,
  type RunwayHouseholdCurrency,
  type UpcomingRecurring,
} from '../../../shared/api-contracts.js';
import { isMandatoryCategory } from '../../../shared/expenses-insight.js';
import type { AccountBalance } from '../../db/repositories/balance.js';
import { getAllAccountBalances } from '../../db/repositories/balance.js';
import { getAccountConfig } from '../accounts/queries.js';
import { sumCashAndCreditByCurrency } from '../accounts/runway-credit.js';
import { loadForecastInputs, type LoadedForecastInputs } from './load-inputs.js';
import {
  assembleForecastEvents,
  upcomingRecurringStableKey,
} from './assemble-forecast-events.js';
import {
  buildForecast,
  type ForecastDailyPoint,
  type ForecastResult,
} from './build-forecast.js';
import {
  firstNegativeBalanceDate,
  mergeAccountSeriesByCurrency,
  mergeHolisticCashPathToGbp,
  runwayMonthsToDate,
} from './runway-metrics.js';
import type { ForecastEvent } from './events.js';

export const RUNWAY_HEADLINE_CURRENCIES: readonly CurrencyCode[] = ['GBP', 'AED'];

export interface AssembleRunwayInput {
  /**
   * Forecast horizon in days. Defaults to 720 (matches the API default).
   * Ignored when {@link forecastInputs} is set (horizon comes from the bundle).
   */
  readonly horizonDays?: number;
  /**
   * Optional entity filter; restricts the calculation to that entity's accounts.
   * Ignored when {@link forecastInputs} is set.
   */
  readonly filterEntityId?: EntityId;
  /**
   * When set, skips {@link loadForecastInputs} — caller must have loaded with the
   * intended horizon and entity filter (e.g. AI snapshot).
   */
  readonly forecastInputs?: LoadedForecastInputs;
}

/** Holistic household runway in GBP (AED converted via static FX table). */
export interface RunwayHolisticGbp {
  readonly firstStressDateFullRecurring: string | null;
  readonly runwayMonthsFullRecurring: number | null;
  readonly firstStressDateMandatoryRecurring: string | null;
  readonly runwayMonthsMandatoryRecurring: number | null;
}

export interface AssembledRunway {
  readonly today: string;
  readonly horizonDays: number;
  /** Per-currency household block (same shape served by `/api/runway`). */
  readonly household: { GBP?: RunwayHouseholdCurrency; AED?: RunwayHouseholdCurrency };
  /** Single cash-out story: merged GBP path from all household accounts. */
  readonly holisticGbp: RunwayHolisticGbp;
  /** Full-recurring stress: forecast result + per-currency merged daily series. */
  readonly fullRecurring: {
    readonly result: ForecastResult;
    readonly mergedByCurrency: ReadonlyMap<CurrencyCode, ForecastDailyPoint[]>;
  };
  /** Mandatory-only stress: same shape. */
  readonly mandatoryRecurring: {
    readonly result: ForecastResult;
    readonly mergedByCurrency: ReadonlyMap<CurrencyCode, ForecastDailyPoint[]>;
  };
}

function filterEventsToAccountSet(
  events: readonly ForecastEvent[],
  allowed: ReadonlySet<AccountName>,
): ForecastEvent[] {
  return events.filter(e => allowed.has(e.account));
}

function buildHouseholdCurrencyBlock(
  currency: CurrencyCode,
  full: ForecastResult,
  mandatory: ForecastResult,
  today: string,
  balances: Record<AccountName, AccountBalance>,
): RunwayHouseholdCurrency {
  const mergedFull = mergeAccountSeriesByCurrency(full.accounts, currency);
  const mergedMan = mergeAccountSeriesByCurrency(mandatory.accounts, currency);
  const fFull = firstNegativeBalanceDate(mergedFull);
  const fMan = firstNegativeBalanceDate(mergedMan);
  const cc = sumCashAndCreditByCurrency(currency, balances);
  return {
    currency,
    runwayMonthsFullRecurring: runwayMonthsToDate(today, fFull),
    runwayMonthsMandatoryRecurring: runwayMonthsToDate(today, fMan),
    firstStressDateFullRecurring: fFull,
    firstStressDateMandatoryRecurring: fMan,
    totalCashCurrent: cc.totalCashCurrent,
    totalAvailableCredit: cc.totalAvailableCredit,
  };
}

export function assembleRunway(input: AssembleRunwayInput = {}): AssembledRunway {
  const inputs =
    input.forecastInputs ??
    loadForecastInputs({
      horizonDays: input.horizonDays ?? 720,
      filterEntityId: input.filterEntityId,
    });
  const horizonDays = inputs.horizonDays;
  const { today, allowedAccountSet, startingBalances } = inputs;

  // Re-fetch the full balances map for `buildHouseholdCurrencyBlock`'s
  // cash + available-credit aggregator (it needs every account, not
  // just those in `startingBalances`).
  const allBalances = getAllAccountBalances();

  const commonAssemble = {
    today: inputs.today,
    horizon: inputs.horizon,
    defaultAccountByType: inputs.defaultAccountByType,
    currencyByAccount: inputs.currencyByAccount,
    accountsByEntity: inputs.accountsByEntity,
    obligations: inputs.obligations,
    pipeline: inputs.pipeline,
    upcomingBuckets: inputs.upcomingBuckets,
    unpaidInvoices: inputs.unpaidInvoices,
    contracts: inputs.contracts,
    accrualWindowStartByContractId: inputs.accrualWindowStartByContractId,
    leaveRows: inputs.leaveRows,
    publicHolidayDatesByEntity: inputs.publicHolidayDatesByEntity,
    // Runway is the "lose all contracts" stress scenario — both off.
    includeInvoiceReceipts: false,
    includeAccrual: false,
  };

  const eventsFull = filterEventsToAccountSet(
    assembleForecastEvents({ ...commonAssemble, recurringPredicate: undefined }),
    allowedAccountSet,
  );
  const eventsMan = filterEventsToAccountSet(
    assembleForecastEvents({
      ...commonAssemble,
      recurringPredicate: item => isMandatoryCategory(item.category),
    }),
    allowedAccountSet,
  );

  const forecastFull = buildForecast({
    today,
    horizonDays,
    startingBalances,
    events: eventsFull,
  });
  const forecastMan = buildForecast({
    today,
    horizonDays,
    startingBalances,
    events: eventsMan,
  });

  const household: { GBP?: RunwayHouseholdCurrency; AED?: RunwayHouseholdCurrency } = {};
  const mergedFullByCurrency = new Map<CurrencyCode, ForecastDailyPoint[]>();
  const mergedManByCurrency = new Map<CurrencyCode, ForecastDailyPoint[]>();
  for (const c of RUNWAY_HEADLINE_CURRENCIES) {
    const hasAny = ACCOUNTS.some(n => allowedAccountSet.has(n) && getAccountConfig(n).currency === c);
    if (!hasAny) continue;
    const block = buildHouseholdCurrencyBlock(c, forecastFull, forecastMan, today, allBalances);
    if (c === 'GBP') household.GBP = block;
    if (c === 'AED') household.AED = block;
    mergedFullByCurrency.set(c, mergeAccountSeriesByCurrency(forecastFull.accounts, c));
    mergedManByCurrency.set(c, mergeAccountSeriesByCurrency(forecastMan.accounts, c));
  }

  const holisticFullDaily = mergeHolisticCashPathToGbp(forecastFull.accounts);
  const holisticManDaily = mergeHolisticCashPathToGbp(forecastMan.accounts);
  const hFull = firstNegativeBalanceDate(holisticFullDaily);
  const hMan = firstNegativeBalanceDate(holisticManDaily);
  const holisticGbp: RunwayHolisticGbp = {
    firstStressDateFullRecurring: hFull,
    runwayMonthsFullRecurring: runwayMonthsToDate(today, hFull),
    firstStressDateMandatoryRecurring: hMan,
    runwayMonthsMandatoryRecurring: runwayMonthsToDate(today, hMan),
  };

  return {
    today,
    horizonDays,
    household,
    holisticGbp,
    fullRecurring: { result: forecastFull, mergedByCurrency: mergedFullByCurrency },
    mandatoryRecurring: { result: forecastMan, mergedByCurrency: mergedManByCurrency },
  };
}

export interface RunwayScenarioInput {
  readonly horizonDays?: number;
  readonly filterEntityId?: EntityId;
  readonly excludedContractIds: readonly string[];
  readonly excludedRecurringIncomeKeys: readonly string[];
}

export interface RunwayScenarioHolisticGbp {
  readonly firstStressDate: string | null;
  readonly runwayMonths: number | null;
}

/**
 * What-if holistic GBP stress date: contract accrual on (unless contract id
 * excluded); recurring rows filtered by the same stable keys as the debt
 * sandbox; cash path merged to GBP.
 */
export function assembleRunwayScenario(
  input: RunwayScenarioInput,
): RunwayScenarioHolisticGbp {
  const horizonDays = input.horizonDays ?? 720;
  const forecastInputs = loadForecastInputs({
    horizonDays,
    filterEntityId: input.filterEntityId,
  });
  const { today, allowedAccountSet, startingBalances } = forecastInputs;

  const excludedC = new Set(input.excludedContractIds);
  const excludedR = new Set(input.excludedRecurringIncomeKeys);
  const recurringPred = (item: UpcomingRecurring) =>
    !excludedR.has(upcomingRecurringStableKey(item));

  const commonAssemble = {
    today: forecastInputs.today,
    horizon: forecastInputs.horizon,
    defaultAccountByType: forecastInputs.defaultAccountByType,
    currencyByAccount: forecastInputs.currencyByAccount,
    accountsByEntity: forecastInputs.accountsByEntity,
    obligations: forecastInputs.obligations,
    pipeline: forecastInputs.pipeline,
    upcomingBuckets: forecastInputs.upcomingBuckets,
    unpaidInvoices: forecastInputs.unpaidInvoices,
    contracts: forecastInputs.contracts,
    accrualWindowStartByContractId: forecastInputs.accrualWindowStartByContractId,
    leaveRows: forecastInputs.leaveRows,
    publicHolidayDatesByEntity: forecastInputs.publicHolidayDatesByEntity,
    includeInvoiceReceipts: false,
    includeAccrual: true,
    includeDetectedIncomeRecurring: true,
    recurringPredicate: recurringPred,
  };

  let eventsFull = assembleForecastEvents({
    ...commonAssemble,
  });
  eventsFull = filterEventsToAccountSet(eventsFull, allowedAccountSet);
  eventsFull = eventsFull.filter(
    e =>
      e.source !== 'accrual' ||
      e.contractId === undefined ||
      !excludedC.has(e.contractId),
  );

  const forecastFull = buildForecast({
    today,
    horizonDays,
    startingBalances,
    events: eventsFull,
  });
  const holisticDaily = mergeHolisticCashPathToGbp(forecastFull.accounts);
  const stress = firstNegativeBalanceDate(holisticDaily);
  return {
    firstStressDate: stress,
    runwayMonths: runwayMonthsToDate(today, stress),
  };
}
